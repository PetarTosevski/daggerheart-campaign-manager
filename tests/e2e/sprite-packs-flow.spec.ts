import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Sprite packs P10 (.omc/plans/sprite-packs.yaml): the whole sprite-packs flow in two browsers, at desktop (1440x900)
// and tablet (1024x768). The GM uploads a pack added to Dungeon (cut and labelled in the browser, P8), switches a new
// map to Sprites (P6) and generates a dungeon with "Let Claude choose" (the e2e backend has no ANTHROPIC_API_KEY, so
// the keyword picker chooses and the sprite fallback draws it, P7), edits it by hand (a texture stroke and the
// uploaded sprite, P9), sets it live and adds the party and the running encounter. At night the player carries a
// torch and moves; the GM places a brazier sprite (lit) beside the Dire Wolf and the player sees the lit area and the
// Wolf; the GM puts it out and lights it again; a thick stone pillar sprite placed between them hides the Wolf (P3,
// P5: sight from the manifest). The GM switches the map to Classic and back and the player's view stays the same (D1).

const PLAYER = "e2e-player@example.test";
const SHEET = path.join(__dirname, "../fixtures/sprite-uploads/props-4x4.png");
/** Fog canvas pixels per square (vision-layer.tsx FOG_PX) and the player's padding (FOG_PAD_SQUARES, Q1). */
const FOG_PX = 12;
const PAD = 24;
/** The fog's colour for a square the character has never seen (and for the padding around the map). */
const UNSEEN = [4, 6, 9, 255];
/** Medium map. */
const W = 30;
const H = 20;

/** Advances the campaign clock `n` days (Witherwild campaign time). */
async function advance(client: ConvexHttpClient, campaignId: Id<"campaigns">, n: number) {
  for (let i = 0; i < n; i++) await client.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: crypto.randomUUID() });
}

/** RGBA of the player's fog canvas at a point in stage squares (padding included). */
async function fogPixel(page: Page, sx: number, sy: number): Promise<number[]> {
  return page.getByTestId("combat-fog").evaluate(
    (el, [x, y]) => {
      const canvas = el as HTMLCanvasElement;
      return Array.from(canvas.getContext("2d")!.getImageData(Math.floor(x!), Math.floor(y!), 1, 1).data);
    },
    [sx * FOG_PX, sy * FOG_PX],
  );
}

/** The centre of square (x, y) on the GM's stage; the stage scrolled into view first (the tool column is tall). */
async function squareCentre(stage: Locator, x: number, y: number) {
  await stage.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const box = (await stage.boundingBox())!;
  const step = box.width / W;
  return { x: box.x + (x + 0.5) * step, y: box.y + (y + 0.5) * step };
}

/** Screen pixels per map square at the current zoom (48 px squares × the zoom shown in the toolbar). */
async function squarePx(page: Page): Promise<number> {
  const text = (await page.getByTestId("combat-zoom").textContent()) ?? "100%";
  return 48 * (Number.parseInt(text, 10) / 100);
}

/** Drags from the middle of `locator` by (dx, dy) screen pixels with real pointer moves. */
async function dragBy(page: Page, locator: Locator, dx: number, dy: number) {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** The built-in folders of a map's sprite and texture refs (`dungeon/urn` -> `dungeon`). */
function folders(map: { objects: { sprite?: { builtin: string } | { uploaded: string } }[]; areas: { texture?: { builtin: string } | { uploaded: string } }[] }) {
  const refs = [...map.objects.map((o) => o.sprite), ...map.areas.map((a) => a.texture)];
  return [...new Set(refs.flatMap((r) => (r && "builtin" in r ? [r.builtin.split("/")[0]!] : [])))].sort();
}

/** Square indices of the rectangle [x0, x1] × [y0, y1] on the map. */
function rect(x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * W + x);
  return out;
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("upload a pack, generate a Sprites dungeon, edit, go live; night, a torch, a brazier sprite, a pillar sprite, Classic and back", async ({ page, browser }) => {
      test.setTimeout(420_000);
      // One generation per test: the test GM's combatMapGenerate bucket (10 per hour) is shared with other specs.
      const { client, campaignId, url } = await openCombatMap(page);
      const tools = page.getByRole("complementary", { name: "Map tools" });

      // ---- The table: the GM's PC Liriel, the player's PC Ash, a running encounter (a Bear and a Dire Wolf) and a
      // prepared blank map (the campaign's first, so the live one for now).
      await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Liriel"), idempotencyKey: crypto.randomUUID() });
      const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Cell block", idempotencyKey: crypto.randomUUID() });
      for (const adversaryId of ["bear", "dire-wolf"]) {
        await client.mutation(api.encounters.addAdversary, {
          campaignId,
          encounterId,
          source: { kind: "srd", adversaryId },
          count: 1,
          summoned: false,
          idempotencyKey: crypto.randomUUID(),
        });
      }
      await client.mutation(api.encounters.start, { campaignId, encounterId });
      await client.mutation(api.combatMaps.create, { campaignId, size: "small", name: "Prep sketch", idempotencyKey: crypto.randomUUID() });

      // ---- P8: a pack added to Dungeon; the 4 × 4 sheet is cut in the browser, cut 1 labelled "Rune stone".
      await page.goto(url);
      await tools.getByRole("link", { name: "Sprite packs" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Sprite packs" })).toBeVisible();
      const form = page.getByRole("region", { name: "New pack" });
      await form.getByLabel("Pack name").fill("Deep halls");
      await form.getByLabel("Setting").selectOption({ label: "Add to Dungeon" });
      await form.getByRole("button", { name: "Create pack" }).click();
      const pack = page.getByRole("region", { name: "Deep halls", exact: true });
      await expect(pack.getByLabel("Setting")).toHaveValue("dungeon");
      const upload = pack.getByRole("region", { name: "Add sprites to Deep halls" });
      await upload.getByTestId(/^sprite-file-/).setInputFiles(SHEET);
      const cuts = upload.getByRole("list", { name: "Cut sprites" });
      await expect(cuts.getByRole("listitem")).toHaveCount(16);
      await upload.getByRole("button", { name: "Select none" }).click();
      await cuts.getByRole("listitem", { name: "Cut 1: Sprite 1" }).getByLabel("Upload").check();
      await cuts.getByRole("listitem", { name: "Cut 1: Sprite 1" }).getByLabel("Name").fill("Rune stone");
      const rune = cuts.getByRole("listitem", { name: "Cut 1: Rune stone" });
      await rune.getByLabel("Sight").selectOption({ label: "Blocks sight" });
      await upload.getByRole("button", { name: "Upload selected (1)" }).click();
      await expect(rune.getByText("Uploaded")).toBeVisible();
      const runeId = (await client.query(api.spritePacks.packs, { campaignId }))[0]!.sprites[0]!._id;
      // It is offered in the Setting picker under Dungeon (Q3).
      const settings = await client.query(api.combatMapStyle.settings, { campaignId });
      expect(settings.packs.map((p) => [p.name, p.extends?.id ?? null])).toEqual([["Deep halls", "dungeon"]]);

      // ---- P6 + P7: a new blank Medium map, switched to Sprites in the header, generated with "Let Claude choose".
      await page.getByRole("link", { name: "← Combat Map" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
      const maps = tools.getByRole("list", { name: "Campaign maps" });
      const mode = tools.getByRole("group", { name: "Map mode" });
      await expect(maps.getByRole("listitem")).toHaveCount(1);
      await tools.getByRole("button", { name: "＋ New map" }).click();
      await tools.getByRole("group", { name: "New map" }).getByRole("button", { name: "Medium 30×20" }).click();
      await expect(maps.getByRole("listitem")).toHaveCount(2);
      const styleSwitch = page.getByRole("group", { name: "Map style" });
      await expect(styleSwitch.getByRole("button", { name: "Classic" })).toHaveAttribute("aria-pressed", "true");
      await styleSwitch.getByRole("button", { name: "Sprites" }).click();
      await expect(styleSwitch.getByRole("button", { name: "Sprites" })).toHaveAttribute("aria-pressed", "true");
      const canvas = page.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas");
      await expect(canvas).toHaveAttribute("data-style", "sprites");
      await mode.getByRole("button", { name: /Edit map/ }).click();
      const scene = tools.getByRole("region", { name: "Scene" });
      await expect(scene.getByLabel("Setting")).toHaveValue("");
      await scene.getByLabel("Describe the battlefield").fill("A damp dungeon with prison cells");
      await scene.getByRole("button", { name: "✦ Generate map" }).click();
      await expect(scene.getByRole("status")).toHaveText(/^Drawn from keywords in your description\./);
      const generated = maps.getByRole("listitem").filter({ hasText: "Generated" });
      await expect(generated).toHaveCount(1);
      await expect(scene.getByLabel("Setting").locator("option[value='']")).toHaveText("Let Claude choose (chose: Dungeon)");
      const mapId = (await client.query(api.combatMaps.list, { campaignId })).find((r) => r.source === "generated")!._id as Id<"combatMaps">;
      const get = async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))!;
      const layout = await get();
      expect(layout).toMatchObject({ style: "sprites", setting: { builtin: "dungeon" }, settingPicked: false });
      expect(folders(layout)).toContain("dungeon");
      expect(folders(layout).every((f) => f === "dungeon" || f === "common")).toBe(true);
      expect(layout.objects.length).toBeGreaterThan(0);
      await expect(canvas).toHaveAttribute("data-style", "sprites");

      // The fallback scatters rooms, pillars and wall torches at random (a fresh seed per generation). For vision
      // checks that do not depend on the seed: an open flagstone hall across rows 5..15 (a texture stroke, which also
      // paints its stone terrain over the walls, P9) and no generated objects.
      await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: rect(1, 5, W - 2, 15), paint: { layer: "texture", texture: { builtin: "dungeon/dungeon-flagstones" } } });
      for (const o of layout.objects) await client.mutation(api.combatMapEdit.removeObject, { campaignId, objectId: o._id });

      // ---- P9: edit by hand. A cracked-stone stroke from (6, 7) to (10, 7) and the uploaded Rune stone at (2, 6).
      const card = tools.getByRole("region", { name: "Edit by hand" });
      const stage = page.getByTestId("combat-stage");
      await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Terrain/ }).click();
      await card.getByRole("group", { name: "Textures · This setting" }).getByRole("button", { name: "Cracked stone", exact: true }).click();
      await card.getByRole("button", { name: "Brush 3 × 3 squares" }).click();
      const from = await squareCentre(stage, 6, 7);
      const to = await squareCentre(stage, 10, 7);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 6 });
      await page.mouse.up();
      await expect
        .poll(async () => (await get()).texturePalette)
        .toEqual([{ builtin: "dungeon/dungeon-flagstones" }, { builtin: "dungeon/cracked-stone" }]);
      await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
      await card.getByRole("group", { name: "Sprites · Your sprites" }).getByRole("button", { name: "Rune stone" }).click();
      const runeAt = await squareCentre(stage, 2, 6);
      await page.mouse.click(runeAt.x, runeAt.y);
      await expect(card.getByRole("group", { name: "Selected object: Rune stone" })).toBeVisible();
      await expect.poll(async () => (await get()).objects.map((o) => ({ kind: o.kind, sprite: o.sprite }))).toEqual([{ kind: "pillar", sprite: { uploaded: runeId } }]);

      // ---- Set it live (R2), then the party and the encounter's adversaries (C6).
      await generated.getByRole("button", { name: "Set live" }).click();
      await expect(generated.getByText("LIVE", { exact: true })).toBeVisible();

      const context = await browser.newContext({ viewport });
      const player = await context.newPage();
      try {
        const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
        await signInAsTestGm(player, PLAYER);
        await expect(player).toHaveURL("/");
        const playerClient = await convexAs(player);
        await playerClient.mutation(api.members.joinByCode, { code });
        await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });

        await mode.getByRole("button", { name: /Play/ }).click();
        const combatants = tools.getByRole("region", { name: "Combatants" });
        await combatants.getByRole("button", { name: "＋ Party (2)" }).click();
        await expect(combatants.getByRole("button", { name: "＋ Party (0)" })).toBeDisabled();
        const queue = combatants.getByRole("group", { name: "From the Adversaries tab" });
        await queue.getByRole("button", { name: "Place all" }).click();
        await expect(queue).toHaveCount(0);
        await expect(combatants.getByTestId("combat-token-count")).toHaveText("2 party · 2 enemies");
        const board = page.getByRole("region", { name: "Battle map" });
        await expect(board.getByTestId("combat-token")).toHaveCount(4);

        // Ash at (3, 10), the Bear 10 squares east of (4, 10) (the torch's dim band), the Dire Wolf 16 squares east
        // (dark), Liriel in a corner of the hall.
        const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
        const id = (name: RegExp) => tokens.find((t) => name.test(t.name))!._id;
        await client.mutation(api.combatTokens.move, { campaignId, tokenId: id(/^Ash$/), x: 3, y: 10 });
        await client.mutation(api.combatTokens.move, { campaignId, tokenId: id(/^Bear/), x: 14, y: 10 });
        await client.mutation(api.combatTokens.move, { campaignId, tokenId: id(/^Dire Wolf/), x: 20, y: 10 });
        await client.mutation(api.combatTokens.move, { campaignId, tokenId: id(/^Liriel$/), x: 1, y: 15 });

        // ---- Night: DAY 1 → NIGHT 2 (Moonrise), R8.
        await advance(client, campaignId, 8);

        // ---- The player: the live Sprites map; a torch for Ash, dragged one square east (facing east, R5).
        await player.goto(url);
        await expect(player.getByTestId("combat-light-pill")).toContainText("Moonrise");
        const playerCanvas = player.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas");
        await expect(playerCanvas).toHaveAttribute("data-style", "sprites");
        await expect(player.getByRole("group", { name: "Map style" })).toHaveCount(0);
        // D10: the player's sprite sources hold only the uploaded sprite the live map uses, without its label.
        const sources = await playerClient.query(api.combatMapStyle.spriteSources, { campaignId, mapId });
        expect(sources.view).toBe("player");
        expect(sources.sprites.map((s) => ({ id: s._id, named: "name" in s, url: typeof s.url }))).toEqual([{ id: runeId, named: false, url: "string" }]);

        const yourView = player.getByRole("region", { name: "Your view" });
        const torch = yourView.getByRole("group", { name: "Light you carry" }).getByRole("button", { name: "Torch", exact: true });
        await torch.click();
        await expect(torch).toHaveAttribute("aria-pressed", "true");
        const playerBoard = player.getByRole("region", { name: "Battle map" });
        const ash = playerBoard.getByRole("button", { name: /^Ash, Party.*your character/ });
        await expect(ash).toHaveAttribute("data-square", "3,10");
        await dragBy(player, ash, await squarePx(player), 0);
        await expect(ash).toHaveAttribute("data-square", "4,10");
        await expect(ash).toHaveAttribute("data-face", "0");
        await expect(board.getByRole("button", { name: /^Ash, Party/ })).toHaveAttribute("data-square", "4,10");

        // The Bear in the dim band and the Wolf in the dark are hidden (R10); the fog is clear in front of Ash.
        await expect(playerBoard.getByRole("button", { name: /^Liriel, Party/ })).toBeVisible();
        await expect(playerBoard.getByRole("button", { name: /^Bear/ })).toHaveCount(0);
        await expect(playerBoard.getByRole("button", { name: /^Dire Wolf/ })).toHaveCount(0);
        await expect.poll(async () => (await fogPixel(player, PAD + 6.5, PAD + 10.5))[3]).toBeLessThan(10);
        const dim = (await fogPixel(player, PAD + 14.5, PAD + 10.5))[3]!;
        expect(dim).toBeGreaterThan(100);
        expect(dim).toBeLessThan(200);
        expect(await fogPixel(player, PAD + 20.5, PAD + 10.5)).toEqual(UNSEEN);

        // ---- The GM places an iron brazier sprite beside the Wolf (lit, a torch's reach, Q1 / D2): the player sees
        // the lit area and the Wolf in it.
        await mode.getByRole("button", { name: /Edit map/ }).click();
        await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
        await card.getByLabel("Search sprites").fill("brazier");
        await card.getByRole("group", { name: "Sprites · Common" }).getByRole("button", { name: "Iron brazier (lit)" }).click();
        const fireAt = await squareCentre(stage, 22, 10);
        await page.mouse.click(fireAt.x, fireAt.y);
        await expect(card.getByRole("group", { name: "Selected object: Iron brazier (lit)" })).toBeVisible();
        await expect(playerBoard.getByRole("button", { name: "Dire Wolf, Enemy" })).toBeVisible();
        await expect.poll(async () => (await fogPixel(player, PAD + 20.5, PAD + 10.5))[3]).toBeLessThan(10);
        expect((await fogPixel(player, PAD + 24.5, PAD + 10.5))[3]).toBeLessThan(10);

        // ---- In Play the GM puts the brazier out (the Wolf goes) and lights it again (the Wolf is back).
        await mode.getByRole("button", { name: /Play/ }).click();
        await board.getByRole("button", { name: "Put out the brazier" }).click();
        await expect(playerBoard.getByRole("button", { name: /^Dire Wolf/ })).toHaveCount(0);
        await board.getByRole("button", { name: "Light the brazier" }).click();
        await expect(playerBoard.getByRole("button", { name: "Dire Wolf, Enemy" })).toBeVisible();

        // ---- A thick stone pillar sprite (2 × 2, blocks sight by its manifest, D3) between Ash and the Wolf hides it.
        await mode.getByRole("button", { name: /Edit map/ }).click();
        await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
        await card.getByLabel("Search sprites").fill("pillar");
        await card.getByRole("group", { name: "Sprites · This setting" }).getByRole("button", { name: "Thick stone pillar" }).click();
        const pillarAt = await squareCentre(stage, 17, 10);
        await page.mouse.click(pillarAt.x, pillarAt.y);
        const pillar = card.getByRole("group", { name: "Selected object: Thick stone pillar" });
        await expect(pillar).toBeVisible();
        await expect(pillar.getByRole("button", { name: "Blocks sight" })).toHaveAttribute("aria-pressed", "true");
        await expect(playerBoard.getByRole("button", { name: /^Dire Wolf/ })).toHaveCount(0);
        await expect(playerBoard.getByRole("button", { name: /^Liriel, Party/ })).toBeVisible();
        await mode.getByRole("button", { name: /Play/ }).click();

        // ---- Classic and back (D1, P3): the player's view is the same in both styles; only the drawing changes.
        const view = async () => {
          const v = await playerClient.query(api.combatVision.playerView, { campaignId });
          expect(v.state).toBe("ok");
          return JSON.stringify(v);
        };
        const fogSamples = async () => Promise.all([6.5, 14.5, 17.5, 20.5, 24.5].map(async (x) => (await fogPixel(player, PAD + x, PAD + 10.5))[3]));
        const before = await view();
        const fogBefore = await fogSamples();
        await styleSwitch.getByRole("button", { name: "Classic" }).click();
        await expect(canvas).toHaveAttribute("data-style", "classic");
        await expect(playerCanvas).toHaveAttribute("data-style", "classic");
        await expect.poll(async () => (await get()).style).toBe("classic");
        expect(await view()).toBe(before);
        expect(await fogSamples()).toEqual(fogBefore);
        await expect(playerBoard.getByRole("button", { name: /^Dire Wolf/ })).toHaveCount(0);
        await styleSwitch.getByRole("button", { name: "Sprites" }).click();
        await expect(playerCanvas).toHaveAttribute("data-style", "sprites");
        await expect.poll(async () => (await get()).style).toBe("sprites");
        expect(await view()).toBe(before);
        expect(await fogSamples()).toEqual(fogBefore);
        await expect(playerBoard.getByRole("button", { name: /^Dire Wolf/ })).toHaveCount(0);
        // Nothing was rewritten by the switches (D1): the hand edits are all still there.
        const after = await get();
        expect(after.objects.map((o) => o.sprite)).toEqual([
          { uploaded: runeId },
          { builtin: "common/iron-brazier-lit" },
          { builtin: "dungeon/thick-stone-pillar" },
        ]);
        expect(after.texturePalette).toHaveLength(2);
        expect(after).toMatchObject({ setting: { builtin: "dungeon" }, settingPicked: false });
        expect(H).toBe(after.h);

        await expect(page.locator(".cm-root").getByRole("alert")).toHaveCount(0);
        await expect(player.locator(".cm-root").getByRole("alert")).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  });
}
