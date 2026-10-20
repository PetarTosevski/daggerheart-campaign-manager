import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { blocksSight } from "../../src/lib/domain/combat-map/sight";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// D9 C9: the whole combat map flow in two browsers (.omc/plans/d9-combat-map.yaml), at desktop (1440x900) and
// tablet (1024x768). The GM generates a map (the e2e backend has no ANTHROPIC_API_KEY, so the keyword fallback draws
// it), edits it by hand, sets it live, adds the party and the running encounter's adversaries; at night the player
// gives their PC a torch and moves it; the Bear in the torch's dim band is hidden from the player (R10) until the GM
// reveals it; the Dire Wolf in the dark appears once the GM places a campfire in edit mode (lit, R9) and goes again
// when the fire is put out.

const PLAYER = "e2e-player@example.test";
/** Fog canvas pixels per square (vision-layer.tsx FOG_PX) and the player's padding (FOG_PAD_SQUARES, Q1). */
const FOG_PX = 12;
const PAD = 24;
/** The fog's colour for a square the character has never seen (and for the padding around the map). */
const UNSEEN = [4, 6, 9, 255];

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
async function squareCentre(stage: Locator, w: number, x: number, y: number) {
  await stage.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const box = (await stage.boundingBox())!;
  const step = box.width / w;
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

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("generate, edit, go live, place the party and an encounter; night, a torch, a reveal and a campfire", async ({ page, browser }) => {
      test.setTimeout(300_000);
      // One generation per test: the test GM's bucket (combatMapGenerate, 10 per hour, Q5) is shared with
      // combat-map-generate.spec.ts (4 generations).
      const { client, campaignId, url } = await openCombatMap(page);

      // ---- The table: the GM's PC Liriel, the player's PC Ash, and a running encounter (a Bear and a Dire Wolf).
      await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Liriel"), idempotencyKey: crypto.randomUUID() });
      const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Dune ambush", idempotencyKey: crypto.randomUUID() });
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
      // A prepared blank map: the campaign's first map, so it is the live one for now.
      await client.mutation(api.combatMaps.create, { campaignId, size: "small", name: "Prep sketch", idempotencyKey: crypto.randomUUID() });

      const context = await browser.newContext({ viewport });
      const player = await context.newPage();
      try {
        const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
        await signInAsTestGm(player, PLAYER);
        await expect(player).toHaveURL("/");
        const playerClient = await convexAs(player);
        await playerClient.mutation(api.members.joinByCode, { code });
        await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });

        // ---- GM: a new blank Medium map, filled by Generate from a description (keyword fallback, C4).
        await page.goto(url);
        const tools = page.getByRole("complementary", { name: "Map tools" });
        const maps = tools.getByRole("list", { name: "Campaign maps" });
        const mode = tools.getByRole("group", { name: "Map mode" });
        await expect(maps.getByRole("listitem")).toHaveCount(1);
        await tools.getByRole("button", { name: "＋ New map" }).click();
        await tools.getByRole("group", { name: "New map" }).getByRole("button", { name: "Medium 30×20" }).click();
        await expect(maps.getByRole("listitem")).toHaveCount(2);
        await mode.getByRole("button", { name: /Edit map/ }).click();
        await expect(mode.getByRole("button", { name: /Edit map/ })).toHaveAttribute("aria-pressed", "true");
        const scene = tools.getByRole("region", { name: "Scene" });
        await scene.getByLabel("Describe the battlefield").fill("A windswept desert dune under the stars");
        await scene.getByRole("button", { name: "✦ Generate map" }).click();
        await expect(scene.getByRole("status")).toHaveText(/^Drawn from keywords in your description\./);
        const generated = maps.getByRole("listitem").filter({ hasText: "Generated" });
        await expect(generated).toHaveCount(1);
        await expect(page.locator(".cm-headline")).toContainText("30 × 20 squares");
        await expect(page.getByTestId("combat-map-canvas")).toBeVisible();
        const rows = await client.query(api.combatMaps.list, { campaignId });
        const { _id: mapId, name: mapName } = rows.find((r) => r.source === "generated")!;
        const W = 30;

        // The fallback scatters trees at random (a fresh seed per generation). Clear the sight blockers so the
        // vision checks below do not depend on the seed; the bushes and rocks stay (cover only, R7).
        const layout = (await client.query(api.combatMaps.get, { campaignId, mapId }))!;
        expect(layout.base).toBe("sand");
        for (const o of layout.objects) if (blocksSight(o)) await client.mutation(api.combatMapEdit.removeObject, { campaignId, objectId: o._id });

        // ---- Edit by hand (C5): a 3-square stone floor stroke from (6, 15) to (10, 15).
        const card = tools.getByRole("region", { name: "Edit by hand" });
        const stage = page.getByTestId("combat-stage");
        await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Terrain/ }).click();
        await card.getByRole("button", { name: "stone", exact: true }).click();
        await card.getByRole("button", { name: "Brush 3 × 3 squares" }).click();
        const from = await squareCentre(stage, W, 6, 15);
        const to = await squareCentre(stage, W, 10, 15);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await page.mouse.up();
        await expect(card.getByRole("button", { name: "Undo all painting" })).toBeVisible();
        await expect.poll(async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))?.cells.length ?? 0).toBeGreaterThan(0);

        // ---- Set it live (R2): the badge moves from the prepared map to the generated one.
        await generated.getByRole("button", { name: "Set live" }).click();
        await expect(generated.getByText("LIVE", { exact: true })).toBeVisible();
        await expect(maps.getByRole("listitem").filter({ hasText: "Prep sketch" }).getByText("LIVE", { exact: true })).toHaveCount(0);

        // ---- Combatants (C6): the party and the encounter's adversaries from the Adversaries tab queue.
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

        // The scene, set through the API: Ash at (3, 10), the Bear 10 squares east of (4, 10) (the torch's dim
        // band), the Dire Wolf 16 squares east (dark), Liriel far behind in a corner.
        const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
        const id = (name: RegExp) => tokens.find((t) => name.test(t.name))!._id;
        await client.mutation(api.combatTokens.move, { campaignId, tokenId: id(/^Ash$/), x: 3, y: 10 });
        await client.mutation(api.combatTokens.move, { campaignId, tokenId: id(/^Bear/), x: 14, y: 10 });
        await client.mutation(api.combatTokens.move, { campaignId, tokenId: id(/^Dire Wolf/), x: 20, y: 10 });
        await client.mutation(api.combatTokens.move, { campaignId, tokenId: id(/^Liriel$/), x: 1, y: 18 });

        // ---- Night: DAY 1 → NIGHT 2 (Moonrise), R8.
        await advance(client, campaignId, 8);

        // ---- The player: the live map; they pick a torch for Ash and drag Ash one square east (facing east, R5).
        await player.goto(url);
        await expect(player.getByTestId("combat-light-pill")).toContainText("Moonrise");
        await expect(player.locator(".cm-headline")).toHaveText(mapName);
        const yourView = player.getByRole("region", { name: "Your view" });
        const torch = yourView.getByRole("group", { name: "Light you carry" }).getByRole("button", { name: "Torch", exact: true });
        await torch.click();
        await expect(torch).toHaveAttribute("aria-pressed", "true");
        await expect(yourView.getByTestId("combat-light-rule")).toHaveText(/your torch lights clearly to Close and dimly to Far/);
        const playerBoard = player.getByRole("region", { name: "Battle map" });
        const ash = playerBoard.getByRole("button", { name: /^Ash, Party.*your character/ });
        await expect(ash).toHaveAttribute("data-square", "3,10");
        await dragBy(player, ash, await squarePx(player), 0);
        await expect(ash).toHaveAttribute("data-square", "4,10");
        await expect(ash).toHaveAttribute("data-face", "0");
        await expect(board.getByRole("button", { name: /^Ash, Party/ })).toHaveAttribute("data-square", "4,10");

        // Another PC is always shown (Q4); the Bear in the dim band and the Wolf in the dark are not (R10).
        await expect(playerBoard.getByRole("button", { name: /^Liriel, Party/ })).toBeVisible();
        await expect(playerBoard.getByRole("button", { name: /^Bear/ })).toHaveCount(0);
        await expect(playerBoard.getByRole("button", { name: /^Dire Wolf/ })).toHaveCount(0);
        // The server never sent them (tokens are filtered on the server, Q1).
        const view = await playerClient.query(api.combatVision.playerView, { campaignId });
        expect(view.state).toBe("ok");
        if (view.state === "ok") {
          expect(view.pcs.map((t) => t.name).sort()).toEqual(["Ash", "Liriel"]);
          expect(view.others).toEqual([]);
        }
        // The fog: clear in front of Ash, the dim band at the Bear, never-seen dark at the Wolf.
        const fog = player.getByTestId("combat-fog");
        await expect(fog).toBeVisible();
        await expect.poll(async () => (await fogPixel(player, PAD + 6.5, PAD + 10.5))[3]).toBeLessThan(10);
        const dim = (await fogPixel(player, PAD + 14.5, PAD + 10.5))[3]!;
        expect(dim).toBeGreaterThan(100);
        expect(dim).toBeLessThan(200);
        expect(await fogPixel(player, PAD + 20.5, PAD + 10.5)).toEqual(UNSEEN);

        // ---- The GM sees everything (R12) and reveals the Bear to Ash after a roll (R10): it appears, live.
        await expect(board.getByTestId("combat-token")).toHaveCount(4);
        await board.getByRole("button", { name: /^Bear, Enemy/ }).click();
        const reveal = tools.getByRole("region", { name: "Light and reveal" }).getByRole("group", { name: "Reveal to" });
        await reveal.getByRole("button", { name: "Ash" }).click();
        await expect(reveal.getByRole("button", { name: "👁 Ash" })).toHaveAttribute("aria-pressed", "true");
        const bear = playerBoard.getByRole("button", { name: /^Bear, Enemy, revealed to you/ });
        await expect(bear).toBeVisible();
        await expect(bear).toHaveClass(/revealed/);
        await expect(playerBoard.getByRole("button", { name: /^Dire Wolf/ })).toHaveCount(0);

        // ---- The GM places a campfire beside the Wolf in edit mode (lit, R9): the player sees the lit area
        // around it, and the Wolf in it.
        const ashCharacterId = tokens.find((t) => t.name === "Ash")!.characterId!;
        const exploredCount = async () =>
          (await playerClient.query(api.combatVision.explored, { campaignId, characterId: ashCharacterId }))?.bits.replace(/A/g, "").length ?? 0;
        const exploredBefore = await exploredCount();
        await mode.getByRole("button", { name: /Edit map/ }).click();
        await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
        await card.getByRole("button", { name: "Campfire", exact: true }).click();
        const fireAt = await squareCentre(stage, W, 22, 10);
        await page.mouse.click(fireAt.x, fireAt.y);
        await expect(card.getByRole("group", { name: "Selected object: Campfire" })).toBeVisible();
        await expect(playerBoard.getByRole("button", { name: "Dire Wolf, Enemy" })).toBeVisible();
        await expect.poll(async () => (await fogPixel(player, PAD + 20.5, PAD + 10.5))[3]).toBeLessThan(10);
        expect((await fogPixel(player, PAD + 24.5, PAD + 10.5))[3]).toBeLessThan(10);
        // The lit area reaches the player's explored row (markExplored, throttled to one write per 1.5 s). Waited
        // for: a view that changes before the write is never stored (the client sends only what it sees at that
        // moment; dcm-bxp.55).
        await expect.poll(exploredCount, { timeout: 15_000 }).toBeGreaterThan(exploredBefore);

        // ---- Back in Play the GM puts the fire out (the Wolf goes; its square stays faintly explored, R11) and
        // lights it again (the Wolf is back).
        await mode.getByRole("button", { name: /Play/ }).click();
        await board.getByRole("button", { name: "Put out the campfire" }).click();
        await expect(playerBoard.getByRole("button", { name: /^Dire Wolf/ })).toHaveCount(0);
        await expect.poll(async () => (await fogPixel(player, PAD + 20.5, PAD + 10.5))[3]).toBeGreaterThan(10);
        expect(await fogPixel(player, PAD + 20.5, PAD + 10.5)).not.toEqual(UNSEEN);
        await board.getByRole("button", { name: "Light the campfire" }).click();
        await expect(playerBoard.getByRole("button", { name: "Dire Wolf, Enemy" })).toBeVisible();

        await expect(page.locator(".cm-root").getByRole("alert")).toHaveCount(0);
        await expect(player.locator(".cm-root").getByRole("alert")).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  });
}
