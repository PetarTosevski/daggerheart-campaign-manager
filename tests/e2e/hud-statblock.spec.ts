import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-hud H5.2 (docs/tasks/TASK-HUD-H5.2.md; GMDesktop 'Adversary acting'): with the HUD on, an enemy token on
// the GM's map opens its stat block as the right panel (parchment: motives, Difficulty / Thresholds / Attack, HP /
// Stress the GM marks, weapon and Experience, conditions, features with kind, Fear cost and Use, Spotlight and Attack).
// Spotlight counts the adversary's spotlight and gives the GM the scene spotlight (combatSpotlight.gmTake). Attack opens
// the purple picking panel "Acting for the …" (purple rings); every Fear spend asks FearConfirm first (answer 6a).

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const enemyToken = (page: Page, name: string) => page.getByRole("region", { name: "Battle map" }).getByRole("button", { name: new RegExp(`^Open the ${escape(name)}’s stat block`) });

async function instanceOf(s: HudScene, tokenId: string) {
  const tokens = await s.client.query(api.combatTokensReads.list, { campaignId: s.campaignId, mapId: s.mapId });
  const instanceId = tokens.find((t) => t._id === tokenId)!.instanceId!;
  const view = await s.client.query(api.encounters.get, { campaignId: s.campaignId, encounterId: s.encounterId });
  return view!.instances.find((i) => i._id === instanceId)!;
}

test("the GM: an enemy token opens its stat block; marks, conditions, Spotlight; Esc closes; tokens swap it", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, client, campaignId } = s;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    const hud = gm.getByTestId("combat-hud");
    await expect(hud).toBeVisible();
    const ltName = s.enemies.lieutenant.name;
    const lt = enemyToken(gm, ltName);
    // From the keyboard: at 1440 the GM's spotlight panel hangs top middle over the Lieutenant (user 2026-11-04).
    await lt.focus();
    await gm.keyboard.press("Enter");
    await expect(hud).toHaveClass(new RegExp(`hud-sh-open hud-sh-${s.enemies.lieutenant.tokenId}`));
    const block = gm.getByRole("complementary", { name: `${ltName}’s stat block` });
    await expect(block.getByTestId("hud-statblock-body")).toBeVisible();
    await expect(block.getByRole("heading", { level: 2 })).toBeFocused();
    await block.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((a) => a.finished));
    });
    const box = (await block.boundingBox())!;
    expect(Math.round(box.width)).toBe(400);
    expect(Math.round(box.x + box.width)).toBe(1440);
    await expect(block).toContainText("Tier 1 Leader");
    await expect(block).toContainText("Bully, command, profit, reinforce");
    await expect(block.getByTestId("hud-statblock-body")).toContainText("13Difficulty");
    await expect(block.getByTestId("hud-statblock-weapon")).toHaveText("JavelinClose · 1d8+3 phyLocal Knowledge +2");
    await expect(block.getByRole("button", { name: "Use Coup de Grace" })).toBeVisible();
    await expect(block.getByRole("img", { name: "1 Fear" })).toBeVisible();
    await expectNoSeriousA11yViolations(gm);

    // HP / Stress: intents on the encounter instance; the token's ring follows.
    await block.getByRole("button", { name: "Mark 1 Hit Point" }).click();
    await expect(block.getByRole("img", { name: /^1 of 6 Hit Points marked$/ })).toBeVisible();
    await expect.poll(async () => (await instanceOf(s, s.enemies.lieutenant.tokenId)).hp).toBe(1);
    await expect(lt).toHaveAccessibleName(/1 of 6 Hit Points marked/);
    await block.getByRole("button", { name: "Mark 1 Stress" }).click();
    await expect.poll(async () => (await instanceOf(s, s.enemies.lieutenant.tokenId)).stress).toBe(1);

    // Conditions: add Vulnerable, then remove it.
    await block.getByRole("combobox", { name: "Add a condition" }).selectOption("vulnerable");
    await expect(block.getByRole("button", { name: "Remove Vulnerable" })).toBeVisible();
    await expect.poll(async () => (await instanceOf(s, s.enemies.lieutenant.tokenId)).conditions).toEqual(["vulnerable"]);
    await block.getByRole("button", { name: "Remove Vulnerable" }).click();
    await expect.poll(async () => (await instanceOf(s, s.enemies.lieutenant.tokenId)).conditions).toEqual([]);

    // The GM turn's first spotlight is free: no Fear question; the scene spotlight goes to the GM.
    const spot = block.getByTestId("hud-statblock-spotlight");
    await expect(spot).toHaveText("Spotlight");
    await spot.click();
    await expect(gm.getByTestId("hud-fear-confirm")).toHaveCount(0);
    await expect.poll(async () => (await instanceOf(s, s.enemies.lieutenant.tokenId)).spotlights).toBe(1);
    await expect.poll(async () => (await client.query(api.combatSpotlight.state, { campaignId })).holder).toEqual({ kind: "gm" });

    // The Sniper's spotlight is the turn's second: "Spotlight · 1 Fear" asks first; Cancel spends nothing.
    await client.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: crypto.randomUUID() });
    await enemyToken(gm, s.enemies.sniper.name).click();
    const sniper = gm.getByRole("complementary", { name: `${s.enemies.sniper.name}’s stat block` });
    await expect(hud).toHaveClass(new RegExp(`hud-sh-${s.enemies.sniper.tokenId}`));
    const sniperSpot = sniper.getByTestId("hud-statblock-spotlight");
    await expect(sniperSpot).toHaveText("Spotlight · 1 Fear");
    await sniperSpot.click();
    const confirm = gm.getByTestId("hud-fear-confirm");
    await expect(confirm).toContainText("Spend 1 Fear?");
    await expect(confirm).toContainText(`1 to spotlight the ${s.enemies.sniper.name}`);
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    expect(await client.query(api.campaigns.fear, { campaignId })).toBe(3);
    await sniperSpot.click();
    await confirm.getByRole("button", { name: "Spend 1 Fear" }).click();
    await expect.poll(() => client.query(api.campaigns.fear, { campaignId })).toBe(2);
    await expect.poll(async () => (await instanceOf(s, s.enemies.sniper.tokenId)).spotlights).toBe(1);

    // Esc closes.
    await sniper.getByRole("heading", { level: 2 }).focus();
    await gm.keyboard.press("Escape");
    await expect(hud).not.toHaveClass(/hud-sh-open/);
    // From the keyboard: Enter on the token opens it, Esc closes it and focus goes back to the token.
    await lt.focus();
    await gm.keyboard.press("Enter");
    await expect(block.getByRole("heading", { level: 2 })).toBeFocused();
    await gm.keyboard.press("Escape");
    await expect(hud).not.toHaveClass(/hud-sh-open/);
    await expect(lt).toBeFocused();
  } finally {
    await s.close();
  }
});

test("the GM: Attack opens the purple picker 'Acting for the …'; an Experience asks FearConfirm; the attack resolves", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, client, campaignId } = s;
  try {
    await client.mutation(api.fear.set, { campaignId, value: 4, idempotencyKey: crypto.randomUUID() });
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    const ltName = s.enemies.lieutenant.name;
    // From the keyboard: at 1440 the GM's spotlight panel hangs top middle over the Lieutenant (user 2026-11-04).
    await enemyToken(gm, ltName).focus();
    await gm.keyboard.press("Enter");
    const block = gm.getByRole("complementary", { name: `${ltName}’s stat block` });
    await block.getByTestId("hud-statblock-attack").click();

    const panel = gm.getByTestId("hud-pick");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/hud-pk-gm/);
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(`Acting for the ${ltName}`);
    await expect(panel.getByTestId("hud-pick-rule")).toHaveText("Javelin · Close · 1d8+3 phy · +2");
    // The PCs from the Lieutenant (14, 10): Brannoc (8, 9) and Vex (7, 6) in Close; Moss (5, 10) and Oriel (6, 13) out of range.
    const rows = panel.getByTestId("hud-pick-row");
    await expect(rows).toHaveCount(4);
    const moss = panel.locator('[data-testid="hud-pick-row"][data-reach="out"]').filter({ hasText: "Moss" });
    await expect(moss).toContainText("Out of range");
    await expect(panel).not.toContainText("GM approves");
    const rings = gm.getByTestId("hud-pick-ring");
    await expect(rings.first()).toHaveClass(/hud-tg-gm/);

    // Pick Brannoc; the footer says what it spends; Local Knowledge adds an Experience Fear.
    await panel.getByTestId("hud-pick-row").filter({ hasText: "Brannoc" }).click();
    await expect(panel.getByTestId("hud-pick-go")).toHaveText("Attack Brannoc");
    await expect(panel.getByTestId("hud-pick-pay")).toHaveText("Momentum on a hit");
    await panel.getByRole("switch", { name: /Use Local Knowledge \+2/ }).click();
    await expect(panel.getByTestId("hud-pick-pay")).toHaveText("Experience: 1 Fear · Momentum on a hit");
    await panel.getByRole("group", { name: "Roll" }).getByRole("button", { name: "Advantage", exact: true }).click();
    await expect(panel.getByRole("group", { name: "Roll" }).getByRole("button", { name: "Advantage", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expectNoSeriousA11yViolations(gm);

    await panel.getByTestId("hud-pick-go").click();
    const confirm = gm.getByTestId("hud-fear-confirm");
    // The GM turn's first spotlight is free: only the Experience costs.
    await expect(confirm).toContainText("Spend 1 Fear?");
    await expect(confirm).toContainText("1 for Local Knowledge");
    await expect(confirm).not.toContainText("spotlight");
    await confirm.getByRole("button", { name: "Spend 1 Fear" }).click();
    await expect(panel).toHaveCount(0);
    await expect(block.getByTestId("tracker-action-result")).toContainText(`${ltName} attacks`);
    // 4 − 1 for the Experience, + 1 back when Momentum hit.
    expect([3, 4]).toContain(await client.query(api.campaigns.fear, { campaignId }));
    await expect.poll(async () => (await client.query(api.combatSpotlight.state, { campaignId })).holder).toEqual({ kind: "gm" });
  } finally {
    await s.close();
  }
});
