import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-hud H7.3 (docs/tasks/TASK-HUD-H7.3.md; PlayerPhone 'Picking a target' and 'You're hit', 390 × 844): on a
// phone the picking panel (the player's pickers and the GM's purple one), the result panel and the hit window are
// bottom sheets: full width on the bottom edge, a handle, 44 px rows and controls, and a footer of 44-48 px buttons
// (Cancel + the primary; the hit window's stacked Mark Armor over Take n HP). They stand over an open side panel (the
// full-screen sheet, the GM's stat block), so a picker opened beside one stays usable. axe on each sheet.

const OUT = "test-results/visual/HUD-H7.3";
const PHONE = { width: 390, height: 844 };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pickPanel = (page: Page) => page.getByTestId("hud-pick");
const pickRow = (page: Page, tokenId: string) => pickPanel(page).locator(`[data-testid="hud-pick-row"][data-token="${tokenId}"]`);
const enemyToken = (page: Page, name: string) => page.getByRole("region", { name: "Battle map" }).getByRole("button", { name: new RegExp(`^Open the ${escape(name)}’s stat block`) });

/** A bottom sheet: the full phone width, its bottom on the screen's bottom edge, its top below the party strip. */
async function expectBottomSheet(sheet: Locator) {
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(PHONE.width);
  expect(Math.abs(box.y + box.height - PHONE.height)).toBeLessThanOrEqual(1);
  expect(box.y).toBeGreaterThanOrEqual(100);
}

/** Every visible button in `scope` is at least `min` px high (HANDOFF "Phone": 44-48 px buttons). */
async function expectTall(scope: Locator, min = 44) {
  const heights = await scope.locator("button:visible").evaluateAll((els) => els.map((el) => [el.textContent?.trim() || el.getAttribute("aria-label"), el.getBoundingClientRect().height] as const));
  expect(heights.length).toBeGreaterThan(0);
  for (const [name, h] of heights) expect(h, `${name} is ${h} px high`).toBeGreaterThanOrEqual(min);
}

/** The element at the centre of `target` belongs to `owner` (nothing stacks over it). */
async function expectOnTop(target: Locator, owner: Locator) {
  const box = (await target.boundingBox())!;
  const ownerHandle = await owner.elementHandle();
  const top = await target.page().evaluate(
    ([x, y, el]) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && el !== null && (el as Element).contains(hit);
    },
    [box.x + box.width / 2, box.y + box.height / 2, ownerHandle] as const,
  );
  expect(top).toBe(true);
}

async function openRingAttack(page: Page) {
  const ring = page.getByRole("toolbar", { name: "Your actions (Moss)" });
  const token = page.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Moss \(your character\): actions/ });
  const attack = ring.getByRole("button", { name: "Attack" });
  // The token toggles the ring, which may still be open from an earlier pick: toggle until Attack shows.
  await expect(async () => {
    if (!(await attack.isVisible())) await token.click();
    await expect(attack).toBeEnabled({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await attack.click();
  await expect(pickPanel(page)).toBeVisible();
}

test("phone: the player's picker is a bottom sheet with Cancel + the primary; it stays on top of the full-screen sheet; the result is a bottom sheet", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client, campaignId, enemies } = s;
  try {
    // The Bandit steps next to Moss, within any weapon's reach.
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: enemies.bandit.tokenId, x: 6, y: 10 });
    await player.setViewportSize(PHONE);
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    // The app's floating Lorekeeper pill hides on the combat map at phone width (user answer 2026-11-02); the nav keeps
    // the Lorekeeper (hud-tablet.spec shows it still covers the bottom right at 1024).
    const pill = player.getByRole("button", { name: "Ask the Lorekeeper" });
    await expect(pill).toBeHidden();

    await openRingAttack(player);
    const panel = pickPanel(player);
    await expectBottomSheet(panel);
    // The header's ✕ gives way to the footer's Cancel; rows are 44 px, the footer's buttons 48 px.
    await expect(panel.getByRole("button", { name: /^Cancel .+/ })).toBeHidden();
    const cancel = panel.getByTestId("hud-pick-cancel");
    await expect(cancel).toBeVisible();
    await expect(cancel).toHaveText("Cancel");
    await pickRow(player, enemies.bandit.tokenId).click();
    await expect(pickRow(player, enemies.bandit.tokenId)).toHaveAttribute("data-state", "picked");
    const go = panel.getByTestId("hud-pick-go");
    await expect(go).toBeEnabled();
    await expectTall(panel);
    for (const b of [cancel, go]) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.width).toBeGreaterThan(PHONE.width / 2 - 40);
    }
    // Cancel and the primary side by side on one row, both on screen and not covered.
    const [c, g] = [(await cancel.boundingBox())!, (await go.boundingBox())!];
    expect(Math.abs(c.y - g.y)).toBeLessThanOrEqual(1);
    expect(c.x).toBeLessThan(g.x);
    expect(g.y + g.height).toBeLessThanOrEqual(PHONE.height);
    await expectOnTop(go, panel);
    await expectOnTop(cancel, panel);
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=hud-pick]" });
    await player.screenshot({ path: `${OUT}/player-picking-390.png`, animations: "disabled" });

    // Moss's sheet opens from the party banner (the phone's whole width): the picker still stands on top and answers.
    await player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Moss's sheet" }).click();
    await expect(player.getByTestId("combat-hud")).toHaveClass(/hud-sh-open/);
    await expect(panel).toBeVisible();
    await expectBottomSheet(panel);
    await expectOnTop(go, panel);
    await expectOnTop(cancel, panel);
    await player.screenshot({ path: `${OUT}/player-picking-over-sheet-390.png`, animations: "disabled" });

    // Cancel ends the session.
    await cancel.click();
    await expect(panel).toHaveCount(0);
    await player.locator(".hud-panel-x").click();
    await expect(player.getByTestId("combat-hud")).not.toHaveClass(/hud-sh-open/);

    // The attack resolves; its result is a bottom sheet with 44 px controls.
    await openRingAttack(player);
    await pickRow(player, enemies.bandit.tokenId).click();
    await panel.getByTestId("hud-pick-go").click();
    await expect(panel).toHaveCount(0);
    const result = player.getByTestId("hud-result");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expectBottomSheet(player.locator(".hud-res-spot"));
    // With the pill hidden the sheet keeps only the board's 16 px of bottom room.
    const lastRow = (await result.getByTestId("hud-result-row").last().boundingBox())!;
    expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(PHONE.height - 16);
    await expectTall(result);
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=hud-result]" });
    await player.screenshot({ path: `${OUT}/player-result-390.png`, animations: "disabled" });
    await result.getByRole("button", { name: /^Close the result of / }).click();
    await expect(result).toHaveCount(0);
  } finally {
    await s.close();
  }
});

test("phone: the GM's purple picker is a bottom sheet over the stat block, with Cancel + the primary", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm } = s;
  try {
    await gm.setViewportSize(PHONE);
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    const ltName = s.enemies.lieutenant.name;
    // At 390 the Lieutenant stands off the visible map (the map pans); the token button still answers a click.
    await enemyToken(gm, ltName).dispatchEvent("click");
    const block = gm.getByRole("complementary", { name: `${ltName}’s stat block` });
    // The block's Attack sits at its bottom (the Lorekeeper pill is hidden at this width); a dispatched click keeps the
    // step independent of the map's pan.
    await block.getByTestId("hud-statblock-attack").dispatchEvent("click");

    const panel = pickPanel(gm);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/hud-pk-gm/);
    await expectBottomSheet(panel);
    await panel.getByTestId("hud-pick-row").filter({ hasText: "Brannoc" }).click();
    await expect(panel.getByTestId("hud-pick-go")).toHaveText("Attack Brannoc");
    await expectTall(panel);
    // Over the stat block (which takes the phone's whole width): the footer is the picker's, not the block's.
    await expectOnTop(panel.getByTestId("hud-pick-go"), panel);
    await expectOnTop(panel.getByTestId("hud-pick-cancel"), panel);
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-pick]" });
    await gm.screenshot({ path: `${OUT}/gm-picking-390.png`, animations: "disabled" });

    await panel.getByTestId("hud-pick-cancel").click();
    await expect(panel).toHaveCount(0);
  } finally {
    await s.close();
  }
});

/** A Bandit that always hits (ATK +20) for 11-14 physical damage (as hud-hit.spec.ts). */
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
  attack: { modifier: 20, name: "Club", range: "Melee", damage: "1d4+10 phy" },
  experiences: [],
  features: [],
};

async function addBrute(s: HudScene) {
  const { client, campaignId } = s;
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE, idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await client.mutation(api.encounters.addAdversary, {
    campaignId,
    encounterId: s.encounterId,
    source: { kind: "custom", customId },
    count: 1,
    summoned: false,
    idempotencyKey: crypto.randomUUID(),
  });
  const instanceId = instanceIds[0]!;
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId: s.mapId, instanceIds: [instanceId], idempotencyKey: crypto.randomUUID() });
  const token = (await client.query(api.combatTokensReads.list, { campaignId, mapId: s.mapId })).find((t) => t.instanceId === instanceId)!;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: token._id, x: 6, y: 10 });
  return instanceId;
}

async function bruteHits(gm: ConvexHttpClient, campaignId: Id<"campaigns">, instanceId: Id<"encounterAdversaries">, target: Id<"characters">) {
  let res = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [target], idempotencyKey: crypto.randomUUID() });
  if (res.status === "confirmFear") {
    res = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [target], spendFear: res.fear, idempotencyKey: crypto.randomUUID() });
  }
  if (res.status !== "resolved") throw new Error(`attack not resolved: ${res.status}`);
  expect(res.targets[0]!.hit).toBe(true);
}

test("phone: You're hit is a bottom sheet, Mark Armor over Take n HP at 48 px, on top of an open picker", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client, campaignId } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    const instanceId = await addBrute(s);
    await player.setViewportSize(PHONE);
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    // A picker is open when the hit lands: the hit window stands over it.
    await openRingAttack(player);

    await bruteHits(client, campaignId, instanceId, moss.characterId);
    const win = player.getByRole("dialog", { name: "You were hit" });
    await expect(win).toBeVisible({ timeout: 30_000 });
    await expectBottomSheet(player.getByTestId("hud-hit"));
    const mark = win.getByRole("button", { name: /^Mark Armor · take / });
    const take = win.getByRole("button", { name: /^Take \d HP$/ });
    for (const b of [mark, take]) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.width).toBeGreaterThan(PHONE.width - 40);
    }
    // The board's `.bs-f.col`: the primary on top, the other under it.
    expect((await mark.boundingBox())!.y).toBeLessThan((await take.boundingBox())!.y);
    await expectTall(win);
    await expectOnTop(mark, win);
    await expectOnTop(take, win);
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=hud-hit-window]" });
    await player.screenshot({ path: `${OUT}/youre-hit-390.png`, animations: "disabled" });

    await mark.click();
    await expect(win).toHaveCount(0, { timeout: 30_000 });
    // The picker under it is still there and still answers.
    await expect(pickPanel(player)).toBeVisible();
    await pickPanel(player).getByTestId("hud-pick-cancel").click();
    await expect(pickPanel(player)).toHaveCount(0);
  } finally {
    await s.close();
  }
});
