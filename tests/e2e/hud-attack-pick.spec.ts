import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-hud H3.2 (docs/tasks/TASK-HUD-H3.2.md): with the HUD on, a weapon attack is the picking panel's weapon
// variant (CmpPicking 'Weapon attack'): weapon tiles, roll chips with Hope pills, one primary "Attack the <target> with
// <weapon>". A hit on a Minion offers more Minions as panel rows (CmpPromptsPlayer 'Your hit can defeat 2 more
// Minions'); a forced attack (Beguiled, HF p.75) is a red prompt that opens the panel with the target locked
// (CmpPromptsPlayer 'Forced attack'). Players see Hit / Miss / Defeated and their own damage, never enemy numbers.

test.use({ actionTimeout: 30_000 });

/** A Minion (1) any roll hits (Difficulty 1), as tests/e2e/combat-actions-flow.spec.ts seeds it (CB p.201). */
const RAT = {
  name: "Rat",
  tier: 1,
  type: "Minion" as const,
  description: "A sewer rat.",
  motives: "Gnaw",
  difficulty: 1,
  thresholds: { major: 1, severe: 100 },
  hp: 1,
  stress: 1,
  attack: { modifier: 0, name: "Bite", range: "Melee", damage: "1d4 phy" },
  experiences: [],
  features: [{ name: "Minion (1)", kind: "passive" as const, text: "This adversary is defeated when they take any damage. For every 1 damage a PC deals to this adversary, defeat an additional Minion within range the attack would succeed against." }],
};

const panelOf = (page: Page) => page.getByTestId("hud-pick");
const rowOf = (page: Page, tokenId: string) => panelOf(page).locator(`[data-testid="hud-pick-row"][data-token="${tokenId}"]`);

/** Two Rats beside Moss (Melee, in front of him): the first is attacked, the second is the Minion offer. */
async function seedRats(s: HudScene) {
  const { client, campaignId } = s;
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: RAT, idempotencyKey: crypto.randomUUID() });
  const add = async () =>
    (await client.mutation(api.encounters.addAdversary, { campaignId, encounterId: s.encounterId, source: { kind: "custom", customId }, count: 1, summoned: true, idempotencyKey: crypto.randomUUID() })).instanceIds[0]!;
  const rats: Id<"encounterAdversaries">[] = [await add(), await add()];
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId: s.mapId, instanceIds: rats, idempotencyKey: crypto.randomUUID() });
  const tokens = await client.query(api.combatTokensReads.list, { campaignId, mapId: s.mapId });
  const out = [];
  for (const [i, instanceId] of rats.entries()) {
    const t = tokens.find((x) => x.instanceId === instanceId)!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: t._id, x: 6, y: 10 + i });
    out.push({ instanceId, tokenId: t._id, name: t.name });
  }
  return out;
}

test("a weapon attack through the panel: tiles, chips, one primary; a Minion hit offers more Minions as rows", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client, campaignId } = s;
  try {
    const [rat1, rat2] = await seedRats(s);
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();

    // The action ring's Attack (H3.4): a click on Moss opens the ring.
    await player
      .getByRole("region", { name: "Battle map" })
      .getByRole("button", { name: /^Moss \(your character\): actions/ })
      .click();
    const open = player.getByRole("toolbar", { name: "Your actions (Moss)" }).getByRole("button", { name: "Attack" });
    await expect(open).toBeEnabled({ timeout: 30_000 });
    await open.click();
    const panel = panelOf(player);
    await expect(panel).toBeVisible();
    const tile = panel.getByTestId("hud-attack-weapon").first();
    await expect(tile).toHaveAttribute("aria-pressed", "true");
    const weaponName = (await tile.locator("b").textContent())!;
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(weaponName);
    await expect(panel.getByTestId("hud-pick-go")).toHaveText(`Attack with ${weaponName}`);

    // Roll chips: an Experience costs a Hope (footer); off again before the attack.
    const chips = panel.getByTestId("hud-attack-chips");
    const exp = chips.locator(".hud-atk-chip").first();
    await exp.click();
    await expect(exp).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByTestId("hud-pick-pay")).toHaveText("Spends 1 Hope");
    await exp.click();
    await expect(chips.getByRole("group", { name: "Advantage" })).toBeVisible();

    // Pick the first Rat: the primary names target and weapon.
    await rowOf(player, rat1!.tokenId).click();
    await expect(panel.getByTestId("hud-pick-go")).toHaveText(`Attack the ${rat1!.name} with ${weaponName}`);
    await expectNoSeriousA11yViolations(player);
    await panel.getByTestId("hud-pick-go").click();
    await expect(panel).toHaveCount(0);
    // H4.1: the result panel replaced the interim line.
    const result = player.getByTestId("hud-result");
    await expect(result.getByTestId("hud-result-row").filter({ hasText: rat1!.name })).toContainText("Defeated");
    await expect(result).not.toContainText("Difficulty");

    // The Minion offer: a prompt, then the panel with the second Rat as a row.
    const offer = player.getByTestId("hud-attack-minions");
    await expect(offer).toContainText(/Your hit can defeat \d+ more Minions?/);
    await offer.getByRole("button", { name: "Pick Minions" }).click();
    await expect(panel).toBeVisible();
    await rowOf(player, rat2!.tokenId).click();
    await expect(panel.getByTestId("hud-pick-go")).toHaveText("Defeat 1");
    await expectNoSeriousA11yViolations(player);
    await panel.getByTestId("hud-pick-go").click();
    await expect(panel).toHaveCount(0);
    await expect(offer).toHaveCount(0);
    await expect
      .poll(async () => {
        const rows = await client.query(api.encounters.get, { campaignId, encounterId: s.encounterId });
        return (rows?.instances ?? []).filter((i) => i._id === rat1!.instanceId || i._id === rat2!.instanceId).map((i) => i.defeated);
      })
      .toEqual([true, true]);
  } finally {
    await s.close();
  }
});

test("a forced attack: the red prompt opens the panel with the target locked, and the attack answers it", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client, campaignId, enemies } = s;
  try {
    const moss = s.pcs.find((p) => p.name === "Moss")!;
    // The Lieutenant (Far: out of the weapon's reach) is the GM's pick: no range sanction is asked.
    execFileSync(
      process.execPath,
      ["scripts/convex-e2e.mjs", "run", "combatRequests:seedForcedAttackForE2e", JSON.stringify({ characterId: moss.characterId, targetTokenIds: [enemies.lieutenant.tokenId], instanceLabel: "Gobstalker", feature: "Beguile" })],
      { stdio: "pipe" },
    );
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    const card = player.getByTestId("hud-attack-forced");
    await expect(card).toContainText("Forced attack", { timeout: 30_000 });
    await expect(card).toContainText("Beguile · you must attack");
    await expect(card).toContainText(`Target: ${enemies.lieutenant.name}`);
    await expectNoSeriousA11yViolations(player);

    const go = card.getByRole("button", { name: `Attack ${enemies.lieutenant.name}` });
    await expect(go).toBeEnabled({ timeout: 30_000 });
    await go.click();
    const panel = panelOf(player);
    await expect(panel.getByTestId("hud-pick-rule")).toHaveText("Gobstalker’s Beguile: the target is locked");
    const row = rowOf(player, enemies.lieutenant.tokenId);
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await expect(row).toHaveAttribute("aria-disabled", "true");
    await expect(panel.getByTestId("hud-pick-row")).toHaveCount(1);
    await expect(panel.getByTestId("hud-pick-pay")).not.toContainText("GM approves");
    await panel.getByTestId("hud-pick-go").click();

    await expect(panel).toHaveCount(0);
    await expect(player.getByTestId("hud-result-row").filter({ hasText: enemies.lieutenant.name })).toContainText(/Hit|Miss|Defeated/);
    await expect(card).toHaveCount(0);
    expect(await client.query(api.combatRequestsReads.forcedAttacks, { campaignId })).toEqual([]);
  } finally {
    await s.close();
  }
});
