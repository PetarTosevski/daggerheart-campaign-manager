import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// D9 C8: fog of war and the player view on screen (.omc/plans/d9-combat-map.yaml), in two browsers. At night with a
// torch an enemy in the dim band is hidden for the player; the GM reveals it and it appears live (dashed outline);
// the GM moves another enemy behind a wall and it disappears; daytime shows the first again. Also: the player's fog
// covers the padding exactly like unexplored fog (Q1, even looking straight at the edge), explored areas are synced,
// a player switches a wall torch they can see, the GM previews the PC's view and brushes fog.

const PLAYER = "e2e-player@example.test";
/** Fog canvas pixels per square (vision-layer.tsx FOG_PX) and the player's padding (FOG_PAD_SQUARES). */
const FOG_PX = 12;
const PAD = 24;
const MAP_W = 30;

/** Advances the campaign clock `n` days (Witherwild campaign time). */
async function advance(client: ConvexHttpClient, campaignId: Id<"campaigns">, n: number) {
  for (let i = 0; i < n; i++) await client.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: crypto.randomUUID() });
}

/** RGBA of the fog canvas at a point in stage squares (padding included). */
async function fogPixel(page: Page, sx: number, sy: number): Promise<number[]> {
  return page.getByTestId("combat-fog").evaluate(
    (el, [x, y]) => {
      const canvas = el as HTMLCanvasElement;
      return Array.from(canvas.getContext("2d")!.getImageData(Math.floor(x!), Math.floor(y!), 1, 1).data);
    },
    [sx * FOG_PX, sy * FOG_PX],
  );
}

/** The centre of square (x, y) on screen; the stage scrolled into view first (the GM's tool column is tall). */
async function squareCentre(stage: Locator, w: number, x: number, y: number) {
  await stage.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const box = (await stage.boundingBox())!;
  const step = box.width / w;
  return { x: box.x + (x + 0.5) * step, y: box.y + (y + 0.5) * step };
}

test("fog of war: dim-band reveal, a wall, daytime, lights, explored areas, the GM's preview and fog brush", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Night road", idempotencyKey: crypto.randomUUID() });

  const context = await browser.newContext();
  const player = await context.newPage();
  try {
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });

    // ---- The scene: Ash at (4, 10) facing east with a torch; a wall at x = 7, rows 5..9; a wall torch in front of
    // Ash; the Bandit in the torch's dim band (9 squares east); the Wolf close by in clear light.
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    const { tokenId: banditId } = await client.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Bandit", hp: 3, side: "enemy", idempotencyKey: crypto.randomUUID() });
    const { tokenId: wolfId } = await client.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Wolf", hp: 4, side: "enemy", idempotencyKey: crypto.randomUUID() });
    const ash = (await client.query(api.combatTokens.list, { campaignId, mapId })).find((t) => t.name === "Ash")!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 4, y: 10 });
    await client.mutation(api.combatTokens.turn, { campaignId, tokenId: ash._id, angle: 0 });
    await client.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: ash._id, light: "torch" });
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: banditId, x: 14, y: 10 });
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: wolfId, x: 8, y: 10 });
    await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: [5, 6, 7, 8, 9].map((y) => y * MAP_W + 7), paint: "block" });
    const { objectId: torchId } = await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "walltorch", x: 7.5, y: 11.5 });
    // Night: DAY 1 → NIGHT 2 (Moonrise).
    await advance(client, campaignId, 8);

    // ---- The player at night.
    await player.goto(url);
    await expect(player.getByTestId("combat-light-pill")).toContainText("Moonrise");
    await expect(player.getByTestId("combat-light-pill")).toContainText("Night: light sources matter");
    const yourView = player.getByRole("region", { name: "Your view" });
    await expect(yourView.getByTestId("combat-cone-text")).toContainText("70° vision cone (Instinct +0)");
    await expect(yourView.getByTestId("combat-light-rule")).toHaveText(/your torch lights clearly to Close and dimly to Far/);
    await expect(yourView.getByRole("group", { name: "Light you carry" }).getByRole("button", { name: "Torch", exact: true })).toHaveAttribute("aria-pressed", "true");
    const playerBoard = player.getByRole("region", { name: "Battle map" });
    await expect(playerBoard.getByRole("button", { name: /^Ash, Party/ })).toBeVisible();
    await expect(playerBoard.getByRole("button", { name: /^Wolf, Enemy/ })).toBeVisible();
    await expect(playerBoard.getByRole("button", { name: /^Bandit/ })).toHaveCount(0);
    // The player's header line never shows the map's size (Q1).
    await expect(player.locator(".cm-headline")).toHaveText("Night road");
    await expect(player.getByTestId("combat-cone")).toHaveCount(1);

    // Hidden edges (Q1): the padding is exactly unexplored fog; so is an unexplored square of the map.
    const fog = player.getByTestId("combat-fog");
    await expect(fog).toBeVisible();
    const unseen = [4, 6, 9, 255];
    await expect.poll(() => fogPixel(player, PAD + 28.5, PAD + 1.5)).toEqual(unseen);
    expect(await fogPixel(player, 2, 2)).toEqual(unseen);
    expect(await fogPixel(player, PAD - 0.3, PAD + 10.5)).toEqual(unseen);
    // Clear light in front of Ash (no fog); the Bandit's square is in the dim band (faint terrain, the board's 150).
    expect((await fogPixel(player, PAD + 6.5, PAD + 10.5))[3]).toBeLessThan(10);
    const dim = (await fogPixel(player, PAD + 15, PAD + 10.5))[3]!;
    expect(dim).toBeGreaterThan(100);
    expect(dim).toBeLessThan(200);
    // Fit frames the explored squares, not the padded area: closer than fitting the whole padded stage.
    const vp = await playerBoard.getByTestId("combat-viewport").boundingBox();
    const paddedFit = Math.min((vp!.width - 8) / ((MAP_W + 2 * PAD) * 48), (vp!.height - 8) / ((20 + 2 * PAD) * 48));
    await playerBoard.getByRole("button", { name: "Fit" }).click();
    await expect.poll(async () => Number.parseInt((await playerBoard.getByTestId("combat-zoom").textContent()) ?? "0", 10)).toBeGreaterThan(Math.round(paddedFit * 100) + 5);

    // Explored areas reach the server (throttled markExplored), merged with what Ash sees.
    await expect
      .poll(async () => (await playerClient.query(api.combatVision.explored, { campaignId, characterId: ash.characterId! }))?.bits.replace(/A/g, "").length ?? 0)
      .toBeGreaterThan(10);

    // The player puts out the wall torch they can see (R9, C7's toggleLight), with an optimistic switch.
    const torchSwitch = playerBoard.getByRole("button", { name: "Put out the wall torch" });
    await torchSwitch.click();
    await expect(playerBoard.getByRole("button", { name: "Light the wall torch" })).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))?.objects.find((o) => o._id === torchId)?.lit).toBe(false);

    // ---- The GM reveals the Bandit to Ash: it appears for the player, live, with the dashed outline.
    await page.goto(url);
    const tools = page.getByRole("complementary", { name: "Map tools" });
    const board = page.getByRole("region", { name: "Battle map" });
    await board.getByRole("button", { name: /^Bandit, Enemy/ }).click();
    const reveal = tools.getByRole("region", { name: "Light and reveal" }).getByRole("group", { name: "Reveal to" });
    await reveal.getByRole("button", { name: "Ash" }).click();
    await expect(reveal.getByRole("button", { name: "👁 Ash" })).toHaveAttribute("aria-pressed", "true");
    const bandit = playerBoard.getByRole("button", { name: "Bandit, Enemy, revealed to you" });
    await expect(bandit).toBeVisible();
    await expect(bandit).toHaveClass(/revealed/);

    // ---- The GM moves the Wolf behind the wall: it disappears for the player.
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: wolfId, x: 9, y: 7 });
    await expect(playerBoard.getByRole("button", { name: /^Wolf/ })).toHaveCount(0);

    // ---- The GM previews Ash's view (R12): the fog and cone on the GM's page; the Wolf is ghosted there.
    await page.getByRole("button", { name: /Player view/ }).click();
    await page.getByRole("menu", { name: "Open the player view as" }).getByRole("menuitemradio", { name: "Ash" }).click();
    await expect(page.getByRole("button", { name: /Viewing as Ash/ })).toBeVisible();
    await expect(page.getByTestId("combat-fog")).toBeVisible();
    await expect(page.getByTestId("combat-cone")).toHaveCount(1);
    await expect(board.getByRole("button", { name: /^Wolf, Enemy/ })).toHaveCSS("opacity", "0.28");
    await tools.getByRole("group", { name: "See the map as" }).getByRole("button", { name: "GM (everything)" }).click();
    await expect(page.getByTestId("combat-fog")).toBeHidden();

    // ---- The GM takes the reveal back, then day comes (NIGHT 7, Nautical Dawn = day, R8): the Bandit shows again,
    // unmarked; the Wolf stays behind the wall.
    await board.getByRole("button", { name: /^Bandit, Enemy/ }).click();
    await reveal.getByRole("button", { name: "👁 Ash" }).click();
    await expect(playerBoard.getByRole("button", { name: /^Bandit/ })).toHaveCount(0);
    await advance(client, campaignId, 5);
    await expect(player.getByTestId("combat-light-pill")).toContainText("Nautical Dawn");
    await expect(yourView.getByTestId("combat-light-rule")).toHaveText(/^Daylight/);
    await expect(playerBoard.getByRole("button", { name: "Bandit, Enemy" })).toBeVisible();
    await expect(playerBoard.getByRole("button", { name: /^Wolf/ })).toHaveCount(0);
    // By day Ash's cone reaches the map's east edge: just past it the padding is still exactly unexplored fog.
    await expect.poll(() => fogPixel(player, PAD + 20.5, PAD + 10.5)).toEqual([0, 0, 0, 0]);
    expect(await fogPixel(player, PAD + MAP_W + 0.2, PAD + 10.5)).toEqual(unseen);
    expect(await fogPixel(player, PAD + MAP_W + 3, PAD + 10.5)).toEqual(unseen);

    // ---- The GM's fog brush (R12): Hide over the Bandit hides it from the player; Erase brings it back.
    const vision = tools.getByRole("region", { name: "Vision and fog" });
    await vision.getByRole("group", { name: "Fog brush" }).getByRole("button", { name: "Hide" }).click();
    await vision.getByRole("group", { name: "Brush size" }).getByRole("button", { name: "Brush 3" }).click();
    const stage = board.getByTestId("combat-stage");
    const at = await squareCentre(stage, MAP_W, 14, 10);
    await page.mouse.click(at.x, at.y);
    await expect(board.getByTestId("combat-fog-marks-hide")).toBeVisible();
    await expect(playerBoard.getByRole("button", { name: /^Bandit/ })).toHaveCount(0);
    await vision.getByRole("group", { name: "Fog brush" }).getByRole("button", { name: "Erase" }).click();
    const again = await squareCentre(stage, MAP_W, 14, 10);
    await page.mouse.click(again.x, again.y);
    await expect(board.getByTestId("combat-fog-marks-hide")).toHaveCount(0);
    await expect(playerBoard.getByRole("button", { name: "Bandit, Enemy" })).toBeVisible();
    await expect(page.locator(".cm-root").getByRole("alert")).toHaveCount(0);
    await expect(player.locator(".cm-root").getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
