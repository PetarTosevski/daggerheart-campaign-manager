import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// D9 C6: tokens (.omc/plans/d9-combat-map.yaml). The GM adds the party and the running encounter's adversary, drags
// the adversary (it faces the way it moved), turns it with the knob, marks 2 HP (the tracker shows 2); a player drags
// their own PC and cannot drag another PC's token, and sees the adversary without stats.

const PLAYER = "e2e-player@example.test";

/** Screen pixels per map square at the current zoom (48 px squares × the zoom shown in the toolbar). */
async function squarePx(page: Page): Promise<number> {
  const text = (await page.getByTestId("combat-zoom").textContent()) ?? "100%";
  return 48 * (Number.parseInt(text, 10) / 100);
}

async function centre(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags from the middle of `locator` by (dx, dy) screen pixels with real pointer moves. */
async function dragBy(page: Page, locator: Locator, dx: number, dy: number) {
  const from = await centre(locator);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

test("the GM places the party and an encounter, moves, turns and marks an adversary; a player drags only their own PC", async ({ page, browser }) => {
  const { client, campaignId, url } = await openCombatMap(page);
  await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Ford", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Liriel"), idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Ambush", idempotencyKey: crypto.randomUUID() });
  const {
    instanceIds: [bearId],
  } = await client.mutation(api.encounters.addAdversary, {
    campaignId,
    encounterId,
    source: { kind: "srd", adversaryId: "bear" },
    count: 1,
    summoned: false,
    idempotencyKey: crypto.randomUUID(),
  });
  await client.mutation(api.encounters.start, { campaignId, encounterId });

  // The player joins and makes their character.
  const context = await browser.newContext();
  const player = await context.newPage();
  try {
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    const { characterId: ashId } = await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });

    // ---- GM: the Combatants card.
    await page.goto(url);
    const tools = page.getByRole("complementary", { name: "Map tools" });
    const combatants = tools.getByRole("region", { name: "Combatants" });
    await expect(combatants.getByRole("button", { name: "＋ Session encounter" })).toBeDisabled();
    await expect(combatants.getByRole("button", { name: "＋ Session encounter" })).toHaveAttribute("title", "No planned session with an encounter");
    await combatants.getByRole("button", { name: "＋ Party (2)" }).click();
    await expect(combatants.getByRole("button", { name: "＋ Party (0)" })).toBeDisabled();
    const queue = combatants.getByRole("group", { name: "From the Adversaries tab" });
    await queue.getByRole("button", { name: /Bear/ }).click();
    await expect(queue).toHaveCount(0);
    await expect(combatants.getByTestId("combat-token-count")).toHaveText("2 party · 1 enemy");

    const board = page.getByRole("region", { name: "Battle map" });
    const bear = board.getByRole("button", { name: /^Bear, Enemy/ });
    await expect(board.getByTestId("combat-token")).toHaveCount(3);
    await expect(bear).toHaveAttribute("data-face", "180");

    // Drag the bear two squares up: it snaps to the grid and faces north (-90 degrees).
    const step = await squarePx(page);
    const [bx, by] = (await bear.getAttribute("data-square"))!.split(",").map(Number) as [number, number];
    await dragBy(page, bear, 0, -2 * step);
    await expect(bear).toHaveAttribute("data-square", `${bx},${by - 2}`);
    await expect(bear).toHaveAttribute("data-face", "-90");
    await expect(bear).toHaveAttribute("aria-pressed", "true");

    // Turn it with the gold knob: drag the knob to the right of the token, so it faces east.
    const knob = bear.getByTestId("combat-turn-knob");
    const from = await centre(knob);
    const mid = await centre(bear);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(mid.x + 60, mid.y - 30, { steps: 4 });
    await page.mouse.move(mid.x + 80, mid.y + 2, { steps: 4 });
    await page.mouse.up();
    await expect(bear).toHaveAttribute("data-face", "0");

    // Mark 2 HP in the token panel: the tracker shows 2.
    const panel = tools.getByRole("region", { name: "Selected token" });
    await expect(panel.getByText(/Difficulty 14/)).toBeVisible();
    await panel.getByRole("group", { name: "Hit Point" }).getByRole("button", { name: "Hit Point 2", exact: true }).click();
    await expect(panel.getByText("Hit Points · 2 / 7 marked")).toBeVisible();
    await expect
      .poll(async () => (await client.query(api.encounters.get, { campaignId, encounterId }))?.instances.find((i) => i._id === bearId)?.hp)
      .toBe(2);

    // Range circles with R, and "Hide all circles".
    await page.keyboard.press("r");
    await expect(board.getByTestId("combat-rings")).toHaveCount(1);
    await panel.getByRole("button", { name: "◎ Hide all circles" }).click();
    await expect(board.getByTestId("combat-rings")).toHaveCount(0);

    // ---- The player: their own token moves, another PC's does not, no adversary is sent to them.
    await player.goto(url);
    const playerBoard = player.getByRole("region", { name: "Battle map" });
    const mine = playerBoard.getByRole("button", { name: /^Ash, Party.*your character/ });
    const theirs = playerBoard.getByRole("button", { name: /^Liriel, Party/ });
    await expect(mine).toBeVisible();
    await expect(theirs).toBeVisible();
    // C8: by day the Bear stands in Ash's cone, so the player sees it, with no stats (R4).
    await expect(playerBoard.getByRole("button", { name: "Bear, Enemy" })).toBeVisible();
    const playerStep = await squarePx(player);

    const [mx, my] = (await mine.getAttribute("data-square"))!.split(",").map(Number) as [number, number];
    await dragBy(player, mine, playerStep, 0);
    await expect(mine).toHaveAttribute("data-square", `${mx + 1},${my}`);
    await expect(mine).toHaveAttribute("data-face", "0");
    // The GM's map follows.
    await expect(board.getByRole("button", { name: /^Ash, Party/ })).toHaveAttribute("data-square", `${mx + 1},${my}`);
    // Keyboard (user 2026-10-21): with nothing focused, ArrowDown moves the player's own token one square and turns it south;
    // E turns it a step clockwise.
    await player.keyboard.press("Escape");
    await player.locator("body").click({ position: { x: 5, y: 5 } });
    await player.keyboard.press("ArrowDown");
    await expect(mine).toHaveAttribute("data-square", `${mx + 1},${my + 1}`);
    await expect(board.getByRole("button", { name: /^Ash, Party/ })).toHaveAttribute("data-square", `${mx + 1},${my + 1}`);
    const faceBefore = Number(await mine.getAttribute("data-face"));
    await player.keyboard.press("e");
    await expect.poll(async () => Number(await mine.getAttribute("data-face"))).not.toBe(faceBefore);

    const before = await theirs.getAttribute("data-square");
    await dragBy(player, theirs, 0, playerStep * 2);
    await expect(theirs).toHaveAttribute("aria-pressed", "true");
    await expect(theirs).toHaveAttribute("data-square", before!);
    await expect(playerBoard.getByRole("alert")).toHaveCount(0);
    // The selected token's card: no turn buttons on another PC's token.
    const playerPanel = player.getByRole("region", { name: "Selected token" });
    await expect(playerPanel.getByRole("button", { name: "Turn left" })).toHaveCount(0);
    await expect(playerPanel.getByRole("button", { name: "◎ Range circles" })).toBeVisible();
    // Conditions: another PC's are read-only; the player switches their own, which lands on the character sheet.
    await expect(playerPanel.getByRole("group", { name: "Conditions" }).getByRole("button", { name: "Vulnerable" })).toBeDisabled();
    await mine.click();
    const vulnerable = playerPanel.getByRole("group", { name: "Conditions" }).getByRole("button", { name: "Vulnerable" });
    await vulnerable.click();
    await expect(vulnerable).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await playerClient.query(api.characters.get, { characterId: ashId }))?.sheet.conditions).toEqual(["vulnerable"]);
  } finally {
    await context.close();
  }
});
