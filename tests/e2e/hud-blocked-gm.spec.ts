import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H6.3 (docs/tasks/TASK-HUD-H6.3.md; CmpBlocked GM rows on GMDesktop): with the HUD on, the GM's
// controls say why they are blocked in the refusal table's words.
// - NOT_ENOUGH_FEAR: a Fear cost the GM can't pay is aria-disabled with "This needs 1 Fear. You have 0." beside it.
// - ADVERSARY_NOT_SPOTLIT: an adversary whose own spotlight the GM can't pay says "Spotlight the … first." at Attack.
// - REQUEST_NOT_OPEN: an answer to a request someone already answered toasts "Already answered" and the card drops out.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const enemyToken = (page: Page, name: string) => page.getByRole("region", { name: "Battle map" }).getByRole("button", { name: new RegExp(`^Open the ${escape(name)}’s stat block`) });

/** A plain attack roll: no modifier, Experience, advantage or option. */
const ROLL = { modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [] };

test("NOT_ENOUGH_FEAR and ADVERSARY_NOT_SPOTLIT: the stat block's Fear costs and Attack say why they are blocked", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, client, campaignId, enemies } = s;
  try {
    // The Bandit takes the GM turn's first (free) spotlight; every other spotlight now costs 1 Fear, and the GM has none.
    const tokens = await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId });
    const banditInstance = tokens.find((t) => t._id === enemies.bandit.tokenId)!.instanceId!;
    await client.mutation(api.encounterTracking.spotlight, { campaignId, instanceId: banditInstance, idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.fear.set, { campaignId, value: 0, idempotencyKey: crypto.randomUUID() });

    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    const ltName = enemies.lieutenant.name;
    // From the keyboard: at 1440 the GM's spotlight panel hangs top middle over the Lieutenant (user 2026-11-04).
    await enemyToken(gm, ltName).focus();
    await gm.keyboard.press("Enter");
    const block = gm.getByRole("complementary", { name: `${ltName}’s stat block` });
    await expect(block.getByTestId("hud-statblock-body")).toBeVisible();

    // NOT_ENOUGH_FEAR: Spotlight · 1 Fear stays focusable, says why and asks nothing.
    const spot = block.getByTestId("hud-statblock-spotlight");
    await expect(spot).toHaveText("Spotlight · 1 Fear");
    await expect(spot).toHaveAttribute("aria-disabled", "true");
    await expect(spot).toHaveAccessibleDescription("This needs 1 Fear. You have 0.");
    await expect(block.getByTestId("hud-statblock-spot-why")).toHaveText("This needs 1 Fear. You have 0.");
    await spot.focus();
    await expect(spot).toBeFocused();
    await spot.click({ force: true });
    await expect(gm.getByTestId("hud-fear-confirm")).toHaveCount(0);

    // ADVERSARY_NOT_SPOTLIT: Attack (and the action features) wait for a spotlight the GM can't pay.
    const attack = block.getByTestId("hud-statblock-attack");
    await expect(attack).toHaveAttribute("aria-disabled", "true");
    await expect(block.getByTestId("hud-statblock-attack-why")).toHaveText(`Spotlight the ${ltName} first. Spotlighting costs 1 Fear.`);
    await attack.click({ force: true });
    await expect(gm.getByTestId("hud-pick")).toHaveCount(0);
    await expect(block.getByRole("button", { name: /^Use Coup de Grace/ })).toBeDisabled();
    await expectNoSeriousA11yViolations(gm);

    // 1 Fear: the spotlight is affordable, so Attack opens; Coup de Grace (1 Fear + its spotlight) needs 2.
    await client.mutation(api.fear.set, { campaignId, value: 1, idempotencyKey: crypto.randomUUID() });
    await expect(spot).not.toHaveAttribute("aria-disabled");
    await expect(attack).not.toHaveAttribute("aria-disabled");
    await expect(block.getByTestId("hud-statblock-feature-why")).toHaveText("This needs 2 Fear. You have 1.");
    await expectNoSeriousA11yViolations(gm);
  } finally {
    await s.close();
  }
});

test("REQUEST_NOT_OPEN: answering a request someone already answered toasts 'Already answered' and the card drops out", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, client, playerClient, campaignId, mapId, enemies } = s;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
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
    if (attack.status !== "pending") throw new Error(`expected a pending attack, got ${attack.status}`);
    const queue = gm.getByTestId("hud-queue");
    const card = queue.getByTestId("hud-queue-range");
    await expect(card).toHaveCount(1);

    // The GM's tab goes offline and presses Allow; meanwhile another GM tab declines it. Back online, the queued Allow
    // reaches the server after the decline: REQUEST_NOT_OPEN.
    await gm.context().setOffline(true);
    await card.getByRole("button", { name: /^Allow:/ }).click();
    await client.mutation(api.combatRequests.sanction, { campaignId, requestId: attack.requestId, approve: false, idempotencyKey: crypto.randomUUID() });
    await gm.context().setOffline(false);

    const notices = gm.getByRole("status", { name: "Notices" });
    await expect(notices).toContainText("Already answered", { timeout: 30_000 });
    await expect(notices).toContainText("Someone already answered this.");
    await expect(card).toHaveCount(0);
    await expect(gm.getByTestId("hud-queue-count")).toHaveText("0");
    await expect(queue.getByRole("alert")).toHaveCount(0);
    await expectNoSeriousA11yViolations(gm);
  } finally {
    await s.close();
  }
});
