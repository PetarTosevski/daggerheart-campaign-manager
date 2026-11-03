import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// The user's answers of 2026-11-02 to the Combat HUD's defaulted questions (.omc/plans/overnight-questions.md):
// - the action ring also offers reactions (greyed with their reason until the server offers them) and out-of-combat
//   Uses (TASK-HUD-H3.4);
// - the GM's Resolutions list players' rolls with Fear ("Moss rolled with Fear · +1 Fear"), each with Undo (H5.1);
// - every player sees a death move's outcome, not only the chooser and the GM (H4.3);
// - the GM's Dice is a plain GM roller, plus "For <PC>" while a PC token is selected (H1.2).

test.use({ actionTimeout: 30_000 });

/** Success with Fear on an Agility action roll (Hope Die 3, Fear Die 8; CB p.95: the GM gains a Fear). */
const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

test("the action ring offers reactions, greyed with their reason until their trigger applies", async ({ browser }) => {
  test.setTimeout(300_000);
  // Moss as a Stalwart Guardian: Iron Will (CB p.44) is a reaction to physical damage.
  const s = await hudScene(browser, { moss: { classId: "guardian", domainCards: ["bare-bones", "get-back-up"] } });
  const { player } = s;
  try {
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    const token = player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Open Moss’s sheet \(your character\)/ });
    await token.click();
    const ring = player.getByRole("toolbar", { name: "Your actions (Moss)" });
    // The ring box has no size of its own (its buttons sit around the token): wait for Attack.
    await expect(ring.getByRole("button", { name: "Attack", exact: true })).toBeVisible();
    // On the ring, or folded under "More actions (n)".
    let iron = ring.getByTestId("hud-ar-button").and(player.getByRole("button", { name: "React with Iron Will", exact: true }));
    if ((await iron.count()) === 0) {
      await ring.getByRole("button", { name: /^More actions/ }).click();
      iron = ring.getByRole("group", { name: "More actions" }).getByRole("button", { name: "React with Iron Will", exact: true });
    }
    await expect(iron).toHaveAttribute("aria-disabled", "true");
    await expect(iron).toHaveAccessibleDescription("Iron Will is a reaction: it waits for its trigger.");
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=hud-action-ring]" });
  } finally {
    await s.close();
  }
});

test("the GM's Resolutions list a player's roll with Fear, with Undo", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, playerClient } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    const fear = (await s.client.query(api.combatHud.scene, { campaignId: s.campaignId })).fear;
    await playerClient.mutation(api.rolls.manualRoll, { characterId: moss.characterId, roll: agility, values: [3, 8], idempotencyKey: crypto.randomUUID() });

    const row = gm.locator('[data-testid="hud-resolution"][data-kind="fear-roll"]').first();
    await expect(row).toContainText("Moss rolled with Fear", { timeout: 30_000 });
    if (fear < 12) await expect(row).toContainText("+1 Fear");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-resolutions]" });
    await row.getByRole("button", { name: "Undo: Moss rolled with Fear" }).click();
    await expect(row).toHaveClass(/hud-res-undone/);
    await expect(row).toContainText("undone");
    await expect.poll(async () => (await s.client.query(api.combatHud.scene, { campaignId: s.campaignId })).fear).toBe(fear);
  } finally {
    await s.close();
  }
});

test("every player sees another character's death move outcome", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client } = s;
  const brannoc = s.pcs.find((p) => p.name === "Brannoc")!;
  try {
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    await expect(player.getByRole("region", { name: "Just now" })).toBeVisible();

    // Brannoc (the GM's PC) marks the last Hit Point and the GM makes the move at once.
    const party = await client.query(api.combatHud.party, { campaignId: s.campaignId, mapId: s.mapId });
    const row = party.find((m) => m.characterId === brannoc.characterId)!;
    await client.mutation(api.characters.adjustResource, { characterId: brannoc.characterId, resource: "hp", delta: row.hp.max - row.hp.marked });
    await client.mutation(api.deathMoves.choose, { characterId: brannoc.characterId, move: "avoidDeath", idempotencyKey: crypto.randomUUID() });

    const popup = player.getByTestId("hud-death-table");
    await expect(popup).toBeVisible({ timeout: 30_000 });
    await expect(popup).toContainText("Brannoc’s death move");
    await expect(popup.getByRole("status")).toContainText(/Brannoc avoids death and drops unconscious\. Hope Die \d+ against level 1/);
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=hud-death-table]" });
    await popup.getByRole("button", { name: "Got it" }).click();
    await expect(popup).toHaveCount(0);
  } finally {
    await s.close();
  }
});

test("the GM's Dice: a plain GM roller, and 'For <PC>' while a PC token is selected", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm } = s;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    const hud = gm.getByTestId("combat-hud");
    await expect(hud).toBeVisible();
    const tools = gm.getByRole("group", { name: "GM tools" });

    // Nothing selected: the GM's own roller (any dice), its result shown.
    await tools.getByRole("button", { name: "Dice", exact: true }).click();
    const dice = gm.getByRole("dialog", { name: "Dice" });
    const form = dice.getByRole("form", { name: "GM roll" });
    await expect(form).toBeVisible({ timeout: 30_000 });
    await expect(dice.getByRole("group", { name: "Roll as" })).toHaveCount(0);
    await form.getByRole("button", { name: "Roll in secret" }).click();
    await expect(dice.getByTestId("gm-roll-result")).toContainText(/^.*1d20 = \d+$/, { timeout: 30_000 });
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-gm-roller]" });
    await dice.getByRole("button", { name: "Close Dice" }).click();

    // Brannoc's token selected (a click opens the sheet; closing it keeps the selection): "For Brannoc" too.
    await gm.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Open Brannoc’s sheet,/ }).click();
    await expect(hud).toHaveClass(/hud-sh-open/);
    await gm.locator(".hud-panel-x").click();
    await expect(hud).not.toHaveClass(/hud-sh-open/);
    await tools.getByRole("button", { name: "Dice", exact: true }).click();
    const as = dice.getByRole("group", { name: "Roll as" });
    await expect(as.getByRole("button", { name: "GM roll" })).toHaveAttribute("aria-pressed", "true");
    await as.getByRole("button", { name: "For Brannoc" }).click();
    await expect(dice.getByTestId("hud-dice-box")).toBeVisible({ timeout: 30_000 });
    await expect(form).toHaveCount(0);
  } finally {
    await s.close();
  }
});
