import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { signInAsTestGm } from "../fixtures";
import { VIEWPORTS, bardDraft, convexAs, openCombatMap, visual } from "./helpers";

// Shots for the MV-M1 task doc (E2E_VISUAL=1), at 1440 and 390: difficult terrain hatched in Classic and Sprites (the
// GM's view: every difficult square; the player's: only what Ash has seen), doors closed and swung open in both
// styles, a player's "Blocked", the GM's warning and the token card's movement-roll note. No design board exists for
// movement (plan rule "Visual acceptance").

const PLAYER = "e2e-player@example.test";
const W = 30;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
}

function rect(x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * W + x);
  return out;
}

test("MV-M1 difficult hatch, doors, Blocked, the GM's warning and the movement-roll note", { tag: "@visual" }, async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Village ford", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "town-street-and-market" } });

  // A ford of water and swamp, rubble, a garden plot, a cottage, a fence with a gate, and a walled room with a door.
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: rect(0, 12, 29, 13), paint: "water" });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: rect(20, 14, 26, 15), paint: "swamp" });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: [...rect(2, 2, 10, 2), ...rect(2, 3, 2, 8), ...rect(10, 3, 10, 4), ...rect(10, 6, 10, 8), ...rect(3, 8, 9, 8)], paint: "wall" });
  const sprite = (key: string, x: number, y: number) =>
    client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, sprite: { builtin: `town-street-and-market/${key}` }, x, y });
  await sprite("thatched-cottage", 16.5, 4.5);
  await sprite("vegetable-garden-plot", 16.5, 17.5);
  await sprite("wooden-fence-section", 21.5, 9.5);
  await sprite("wooden-fence-section", 27.5, 9.5);
  const { objectId: gateId } = await sprite("wooden-fence-gate", 24.5, 9.5);
  await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "rubble", x: 7.5, y: 16.5 });
  const { objectId: doorId } = await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "door", x: 10.5, y: 5.5 });

  // The player and Ash, beside the garden plot.
  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  const player = await context.newPage();
  try {
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    const ash = (await client.query(api.combatTokens.list, { campaignId, mapId })).find((t) => t.name === "Ash")!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 14, y: 17 });
    await client.mutation(api.combatTokens.turn, { campaignId, tokenId: ash._id, angle: 0 });

    // ---- The GM's view: every difficult square hatched, doors closed, then open; Classic and Sprites.
    const { shoot } = visual(page, "MV-M1");
    const board = page.getByRole("region", { name: "Battle map" });
    for (const style of ["classic", "sprites"] as const) {
      await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style });
      await page.goto(url);
      await expect(page.getByTestId("combat-map-canvas")).toHaveAttribute("data-style", style);
      await expect(board.getByTestId("combat-difficult-hatch")).toHaveCount(1);
      await settle(page);
      await shoot(board, `gm-hatch-doors-closed-${style}`);
      await client.mutation(api.combatVision.toggleDoor, { campaignId, objectId: doorId, open: true });
      await client.mutation(api.combatVision.toggleDoor, { campaignId, objectId: gateId, open: true });
      await settle(page);
      await shoot(board, `gm-doors-open-${style}`);
      await client.mutation(api.combatVision.toggleDoor, { campaignId, objectId: doorId, open: false });
      await client.mutation(api.combatVision.toggleDoor, { campaignId, objectId: gateId, open: false });
    }

    // ---- The player (Sprites): the hatch only where Ash has looked, "Blocked" at the fence, the card's note.
    await player.goto(url);
    const playerBoard = player.getByRole("region", { name: "Battle map" });
    const mine = playerBoard.getByRole("button", { name: /^Ash, Party.*your character/ });
    await expect(mine).toHaveAttribute("data-square", "14,17", { timeout: 30_000 });
    await player.locator("body").click({ position: { x: 2, y: 2 } });
    await player.keyboard.press("d");
    await expect(mine).toHaveAttribute("data-square", "15,17");
    await expect.poll(async () => (await playerClient.query(api.combatTokens.party, { campaignId, mapId })).find((t) => t._id === ash._id)?.x).toBe(15);
    const card = player.getByRole("region", { name: "Selected token" });
    await expect(card.getByTestId("combat-difficult-note")).toBeVisible();
    await settle(player);
    const playerShots = visual(player, "MV-M1");
    await playerShots.shoot(playerBoard, "player-hatch-seen-only");
    await playerShots.shoot(card, "player-card-difficult-note");

    // "Blocked": Ash north of the fence steps into it (re-triggered per viewport: the notice fades after 4 s).
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 21, y: 8 });
    await expect(mine).toHaveAttribute("data-square", "21,8");
    const notice = playerBoard.getByTestId("combat-move-notice");
    for (const viewport of VIEWPORTS) {
      await player.setViewportSize(viewport);
      await player.locator("body").click({ position: { x: 2, y: 2 } });
      await player.keyboard.press("s");
      await expect(notice).toHaveText("Blocked");
      await mine.scrollIntoViewIfNeeded();
      await playerBoard.screenshot({ path: `test-results/visual/MV-M1/player-blocked-${viewport.width}.png`, animations: "disabled" });
    }
    await player.setViewportSize(VIEWPORTS[0]);

    // ---- The GM's warning: Ash walked through the room's wall.
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 11, y: 3 });
    await page.goto(url);
    const gmAsh = board.getByRole("button", { name: /^Ash, Party/ });
    await expect(gmAsh).toHaveAttribute("data-square", "11,3");
    const gmNotice = board.getByTestId("combat-move-notice");
    for (const viewport of VIEWPORTS) {
      await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 11, y: 3 });
      await expect(gmAsh).toHaveAttribute("data-square", "11,3");
      await page.setViewportSize(viewport);
      const before = Number(await gmNotice.getAttribute("data-seq"));
      await gmAsh.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(gmAsh).toHaveAttribute("data-square", "10,3");
      await expect.poll(async () => Number(await gmNotice.getAttribute("data-seq"))).toBeGreaterThan(before);
      await expect(gmNotice).toHaveAttribute("data-kind", "warning");
      await board.screenshot({ path: `test-results/visual/MV-M1/gm-warning-${viewport.width}.png`, animations: "disabled" });
      await expect.poll(async () => (await client.query(api.combatTokens.list, { campaignId, mapId })).find((t) => t._id === ash._id)?.x).toBe(10);
    }
    await page.setViewportSize(VIEWPORTS[0]);
  } finally {
    await context.close();
  }
});
