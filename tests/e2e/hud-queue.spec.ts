import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-hud H5.1 (docs/tasks/TASK-HUD-H5.1.md; GMDesktop 'Requests', CmpPromptsGM): with the HUD on, everything
// that waits on the GM lands in one "Waiting on you" queue. Plan combat-hud H9.2 (TASK-HUD-H9.2.md; GMDesktop / GMTablet
// `.wchip`, user answer Q10a): the queue is closed behind the bottom-left "Waiting on you" button with its count; a new
// request pulses the count and toasts "Moss: out of range · Waiting on you"; the button opens the queue above it.
// Resolutions with Undo open from the dock's Log (right, above the dock); Areas opens bottom right. Live, two browsers:
// the player's out-of-range attack and card land in the queue; the player withdraws the card (it disappears), the GM
// allows the attack (it resolves, the player's wait ends, the hit shows in Log's Resolutions and Undo undoes it). A
// Brute's hit opens 'Reactions' with Resolve now.

const OUT = "test-results/visual/HUD-H9.2";

const BRUTE = {
  name: "Brute",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 10,
  thresholds: { major: 5, severe: 10 },
  hp: 5,
  stress: 3,
  attack: { modifier: 20, name: "Club", range: "Melee", damage: "1d4+2 phy" },
  experiences: [],
  features: [],
};

/** A plain attack roll: no modifier, Experience, advantage or option. */
const ROLL = { modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [] };

function queueOf(gm: Page) {
  return gm.getByTestId("hud-queue");
}

/** Moss (the player's) attacks and uses Vicious Entangle (Far) on the Sniper (Very Far): both wait on the GM. */
async function outOfRangeUses(s: HudScene) {
  const { playerClient, campaignId, mapId, enemies } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  const attack = await playerClient.mutation(api.combatActions.attack, {
    campaignId,
    characterId: moss.characterId,
    mapId,
    targetTokenIds: [enemies.sniper.tokenId],
    slot: "primary",
    ...ROLL,
    idempotencyKey: crypto.randomUUID(),
  });
  expect(attack.status).toBe("pending");
  const card = await playerClient.mutation(api.combatCards.useCard, {
    campaignId,
    characterId: moss.characterId,
    mapId,
    cardId: s.farCardId,
    spell: "main",
    targetTokenIds: [enemies.sniper.tokenId],
    choices: [],
    idempotencyKey: crypto.randomUUID(),
  });
  expect(card.status).toBe("pending");
}

/** The GM's "Waiting on you" button (bottom-left, H9.2). */
function waitingButton(gm: Page) {
  return gm.getByRole("button", { name: /^Waiting on you/ });
}

/** The dock (H9.0), where Log and Areas are. */
function dock(gm: Page) {
  return gm.getByRole("toolbar", { name: "Map controls" });
}

/** Opens the queue from "Waiting on you" (closed by default, Q10a). */
async function openQueue(gm: Page) {
  const button = waitingButton(gm);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(queueOf(gm)).toBeVisible();
}

test("live: out-of-range uses pulse 'Waiting on you' and toast; the queue opens above it; a withdrawn one disappears, an allowed one resolves with Undo in Log", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, enemies } = s;
  try {
    for (const page of [gm, player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByTestId("combat-hud")).toBeVisible();
    }
    // Closed by default: the button with a grey 0, bottom-left (left 16, bottom 16, 56 px), the queue hidden.
    const button = waitingButton(gm);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(gm.getByTestId("hud-wait-count")).toHaveText("0");
    await expect(gm.getByTestId("hud-wait-count")).toHaveClass(/hud-wn0/);
    await expect(queueOf(gm)).toBeHidden();
    await expect(gm.getByTestId("hud-resolutions")).toHaveCount(0);
    await expect(player.getByTestId("hud-waiting")).toHaveCount(0);
    const hud = (await gm.getByTestId("combat-hud").boundingBox())!;
    const bb = (await button.boundingBox())!;
    expect(Math.round(bb.x - hud.x)).toBe(16);
    expect(Math.round(hud.y + hud.height - (bb.y + bb.height))).toBe(16);
    expect(Math.round(bb.height)).toBe(56);

    // Two requests arrive: the count turns purple and a short toast names each (Q10a); the queue stays closed.
    await outOfRangeUses(s);
    await expect(gm.getByTestId("hud-wait-count")).toHaveText("2", { timeout: 30_000 });
    await expect(gm.getByTestId("hud-wait-count")).not.toHaveClass(/hud-wn0/);
    const notices = gm.getByRole("status", { name: "Notices" });
    await expect(notices).toContainText("Moss: out of range");
    await expect(notices).toContainText("Waiting on you");
    await expect(queueOf(gm)).toBeHidden();
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-waiting]" });
    await gm.screenshot({ path: `${OUT}/closed-toast-1440.png`, animations: "disabled" });

    // The button opens the queue above it (bottom 72), clear of the banners and of the dock.
    await openQueue(gm);
    const queue = queueOf(gm);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(queue.getByRole("heading", { name: /Waiting on you/ })).toBeVisible();
    await expect(gm.getByTestId("hud-queue-count")).toHaveText("2");
    const cards = queue.getByTestId("hud-queue-range");
    await expect(cards).toHaveCount(2, { timeout: 30_000 });
    await expect(cards.nth(0)).toContainText("Out of range: your call");
    await expect(cards.nth(0)).toContainText(`Moss · Attack on ${enemies.sniper.name} (Very Far)`);
    await expect(cards.nth(1)).toContainText("Moss · Vicious Entangle");
    await expect(cards.nth(0)).toContainText("Nothing is rolled or paid until you decide.");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-waiting]" });
    const column = gm.getByTestId("hud-queue-column");
    const box = (await column.boundingBox())!;
    expect(Math.round(box.x - hud.x)).toBe(16);
    expect(Math.round(hud.y + hud.height - (box.y + box.height))).toBe(72);
    expect(Math.round(box.width)).toBe(330);
    const bannerBottoms = await gm.locator("[data-testid^=hud-banner-]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
    expect(box.y).toBeGreaterThanOrEqual(Math.max(...bannerBottoms));
    const db = (await dock(gm).boundingBox())!;
    // Clear of the dock: left of it or above it (the dock is wider than the board's, so at 1440 the queue sits above its left end).
    expect(box.x + box.width <= db.x || box.y + box.height <= db.y + 0.5).toBe(true);
    await gm.screenshot({ path: `${OUT}/queue-open-1440.png`, animations: "disabled" });

    // Escape closes it and the focus goes back to the button.
    await gm.keyboard.press("Escape");
    await expect(queue).toBeHidden();
    await expect(button).toBeFocused();
    await openQueue(gm);

    // The player withdraws the card: it disappears from the GM's queue, live.
    const waits = player.getByTestId("hud-pick-wait");
    await expect(waits).toHaveCount(2, { timeout: 30_000 });
    await player.getByRole("button", { name: "Withdraw Vicious Entangle" }).click();
    await expect(cards).toHaveCount(1, { timeout: 30_000 });
    await expect(gm.getByTestId("hud-wait-count")).toHaveText("1");
    await expect(queue).not.toContainText("Vicious Entangle");

    // The GM allows the attack: it resolves; the player's wait ends.
    await queue.getByRole("button", { name: "Allow: Moss · Attack" }).click();
    await expect(cards).toHaveCount(0);
    await expect(gm.getByTestId("hud-queue-result")).toHaveText("Allowed: Moss · Attack.", { timeout: 30_000 });
    await expect(waits).toHaveCount(0, { timeout: 30_000 });
    await expect(gm.getByTestId("hud-wait-count")).toHaveText("0");

    // Log (the dock) opens Resolutions with Undo above the dock on the right (right 16, bottom 80, 360 px) and closes
    // the queue (one GM panel at a time). Resolutions show once.
    await dock(gm).getByRole("button", { name: "Log" }).click();
    await expect(queue).toBeHidden();
    await expect(gm.getByTestId("hud-resolutions")).toHaveCount(1);
    const resolutions = gm.getByTestId("hud-resolution");
    await expect(resolutions).toHaveCount(1, { timeout: 30_000 });
    await expect(resolutions.first()).toContainText("Moss");
    const lb = (await gm.getByTestId("hud-log").boundingBox())!;
    expect(Math.round(hud.x + hud.width - (lb.x + lb.width))).toBe(16);
    expect(Math.round(hud.y + hud.height - (lb.y + lb.height))).toBe(80);
    expect(Math.round(lb.width)).toBe(360);
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-log]" });
    await gm.screenshot({ path: `${OUT}/log-1440.png`, animations: "disabled" });
    await resolutions.first().getByRole("button", { name: /^Undo: / }).click();
    await expect(resolutions.first()).toHaveClass(/hud-res-undone/, { timeout: 30_000 });
    await expect(resolutions.first()).toContainText("undone");
  } finally {
    await s.close();
  }
});

test("Reactions: an adversary's hit waits on the player; Resolve now settles it", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, client, campaignId } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE, idempotencyKey: crypto.randomUUID() });
    const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId: s.encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
    const instanceId = instanceIds[0]! as Id<"encounterAdversaries">;
    await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId: s.mapId, instanceIds: [instanceId], idempotencyKey: crypto.randomUUID() });
    const token = (await client.query(api.combatTokensReads.list, { campaignId, mapId: s.mapId })).find((t) => t.instanceId === instanceId)!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: token._id, x: 6, y: 10 });

    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();

    let res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [moss.characterId], idempotencyKey: crypto.randomUUID() });
    if (res.status === "confirmFear") {
      res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [moss.characterId], spendFear: res.fear, idempotencyKey: crypto.randomUUID() });
    }
    expect(res.status).toBe("resolved");

    await expect(gm.getByTestId("hud-wait-count")).toHaveText("1", { timeout: 30_000 });
    await openQueue(gm);
    const card = queueOf(gm).getByTestId("hud-queue-reactions");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("Reactions");
    await expect(card).toContainText("After Brute’s attack");
    await expect(card).toContainText("Waiting on Moss");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-queue-column]" });
    await card.screenshot({ path: `${OUT}/reactions-card.png`, animations: "disabled" });

    await card.getByRole("button", { name: /^Resolve now/ }).click();
    await expect(card).toHaveCount(0);
    await expect(gm.getByTestId("hud-queue-result")).toContainText("Resolved", { timeout: 30_000 });
    // The Brute's attack is in Resolutions (Log) with Undo.
    await dock(gm).getByRole("button", { name: "Log" }).click();
    await expect(gm.getByTestId("hud-resolution").first()).toContainText("Brute", { timeout: 30_000 });
    await expect.poll(async () => (await client.query(api.adversaryActionsReads.windows, { campaignId })).length).toBe(0);
  } finally {
    await s.close();
  }
});

test("Areas opens bottom right above the dock; its ✕ gives the focus back to the dock's Areas; tablet places all three", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm } = s;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    const hud = (await gm.getByTestId("combat-hud").boundingBox())!;
    const areasButton = dock(gm).getByRole("button", { name: "Areas" });
    await areasButton.click();
    const panel = gm.getByRole("dialog", { name: "Areas" });
    await expect(panel).toBeVisible();
    const ab = (await panel.boundingBox())!;
    expect(Math.round(hud.x + hud.width - (ab.x + ab.width))).toBe(182);
    expect(Math.round(hud.y + hud.height - (ab.y + ab.height))).toBe(80);
    await expectNoSeriousA11yViolations(gm, { include: "#hud-areas" });
    await gm.screenshot({ path: `${OUT}/areas-1440.png`, animations: "disabled" });
    await panel.getByRole("button", { name: "Close Areas" }).click();
    await expect(panel).toHaveCount(0);
    await expect(areasButton).toBeFocused();
    await expect(areasButton).toHaveAttribute("aria-pressed", "false");

    // Tablet (GMTablet): the button 52 px at left 12 / bottom 12, label hidden (still its name); the queue above it at
    // bottom 74, 300 px; Log at right 12 / bottom 74, 330 px; Areas at right 12 / bottom 74.
    await gm.setViewportSize({ width: 1024, height: 768 });
    const tab = (await gm.getByTestId("combat-hud").boundingBox())!;
    const button = waitingButton(gm);
    await expect(button.locator(".hud-wchip-l")).toHaveCSS("position", "absolute");
    const bb = (await button.boundingBox())!;
    expect(Math.round(bb.height)).toBe(52);
    expect(Math.round(bb.x - tab.x)).toBe(12);
    expect(Math.round(tab.y + tab.height - (bb.y + bb.height))).toBe(12);
    await openQueue(gm);
    const qb = (await gm.getByTestId("hud-queue-column").boundingBox())!;
    expect(Math.round(qb.width)).toBe(300);
    expect(Math.round(tab.y + tab.height - (qb.y + qb.height))).toBe(74);
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-waiting]" });
    await gm.screenshot({ path: `${OUT}/queue-open-1024.png`, animations: "disabled" });
    await dock(gm).getByRole("button", { name: "Log" }).click();
    const lb = (await gm.getByTestId("hud-log").boundingBox())!;
    expect(Math.round(lb.width)).toBe(330);
    expect(Math.round(tab.x + tab.width - (lb.x + lb.width))).toBe(12);
    expect(Math.round(tab.y + tab.height - (lb.y + lb.height))).toBe(74);
    await expect(gm.getByTestId("hud-resolutions")).toBeVisible();
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-log]" });
    await gm.screenshot({ path: `${OUT}/log-1024.png`, animations: "disabled" });
    await dock(gm).getByRole("button", { name: "Areas" }).click();
    const tb = (await gm.getByRole("dialog", { name: "Areas" }).boundingBox())!;
    expect(Math.round(tab.x + tab.width - (tb.x + tb.width))).toBe(12);
    expect(Math.round(tab.y + tab.height - (tb.y + tb.height))).toBe(74);
    await gm.screenshot({ path: `${OUT}/areas-1024.png`, animations: "disabled" });
  } finally {
    await s.close();
  }
});
