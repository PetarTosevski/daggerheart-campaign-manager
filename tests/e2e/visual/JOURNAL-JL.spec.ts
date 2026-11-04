import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { JOURNAL_SCENES, openJournal, seedJournal } from "../journal/helpers";
import { visual } from "./helpers";

// Journal JL visual spec (E2E_VISUAL=1): the session log card at 1440x900 and 390x844, beside the design's 'Session
// log' card (reference/designs/journal/journal_views.jpg, panel 2, centre). The seed plays part of the design's
// evening: scene 1 begins, Moss's Presence roll re-worded 'Tamsin agreed to help', Fear 3 → 5 then one spent, a GM
// line, the 'Session started.' line hidden. Shots: the GM's log, the GM with the hidden line shown, a title being
// re-worded, the player's read-only log, and both full pages.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

const presence = {
  kind: "action" as const,
  trait: "presence" as const,
  modifier: 0,
  experienceIds: [],
  advantage: 0,
  disadvantage: 0,
  help: 0,
  attack: false,
  options: [],
};

test("JL session log at 1440 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(240_000);
  const table = await seedJournal(browser);
  try {
    const { gm, player, client, playerClient, campaignId, characterId, liveSessionId: sessionId, sceneIds } = table;
    const key = () => crypto.randomUUID();
    await client.mutation(api.sessionPrep.setScene, { campaignId, sessionId, sceneId: sceneIds[0]!, title: JOURNAL_SCENES[0].title });
    await client.mutation(api.sessionPrep.setSceneState, { campaignId, sessionId, sceneId: sceneIds[0]!, state: "playing" });
    await playerClient.mutation(api.rolls.manualRoll, { characterId, roll: presence, values: [11, 3], idempotencyKey: key() });
    await client.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: key() });
    await client.mutation(api.fear.set, { campaignId, value: 5, idempotencyKey: key() });
    await client.mutation(api.fear.adjust, { campaignId, direction: "decrease", idempotencyKey: key() });
    await client.mutation(api.sessionPlay.addLog, { campaignId, sessionId, text: "The Sniper slipped into the trees", idempotencyKey: key() });

    const log = gm.getByRole("region", { name: "Session log" });
    await openJournal(gm, table, `?s=${sessionId}&sv=log`);
    const roll = log.getByRole("listitem").filter({ hasText: /Presence action roll/ });
    await roll.getByRole("button", { name: /, re-word$/ }).click();
    await log.getByRole("textbox", { name: "Re-word the line" }).fill("Tamsin agreed to help");
    await log.getByRole("textbox", { name: "Re-word the line" }).press("Enter");
    await expect(log.getByText("Tamsin agreed to help")).toBeVisible();
    const started = log.getByRole("listitem").filter({ hasText: "Session started." });
    await started.getByRole("button", { name: /^Hide log line:/ }).click();
    await expect(gm.getByRole("button", { name: "Show 1 hidden" })).toBeVisible();

    const gmShots = visual(gm, "JOURNAL-JL", VIEWPORTS);
    await gmShots.shoot(log, "gm-log");
    await gm.getByRole("button", { name: "Show 1 hidden" }).click();
    await gmShots.shoot(log, "gm-hidden-shown");
    await log.getByRole("listitem").filter({ hasText: "Tamsin agreed to help" }).getByRole("button", { name: /, re-word$/ }).click();
    await log.screenshot({ path: "test-results/visual/JOURNAL-JL/gm-reword-1440.png", animations: "disabled" });
    await gm.keyboard.press("Escape");

    await openJournal(player, table, `?s=${sessionId}`);
    const playerLog = player.getByRole("region", { name: "Session log" });
    await expect(playerLog.getByText("Tamsin agreed to help")).toBeVisible();
    await visual(player, "JOURNAL-JL", VIEWPORTS).shoot(playerLog, "player-log");
    await player.screenshot({ path: "test-results/visual/JOURNAL-JL/player-page-1440.png", fullPage: true, animations: "disabled" });
    await gm.screenshot({ path: "test-results/visual/JOURNAL-JL/gm-page-1440.png", fullPage: true, animations: "disabled" });
  } finally {
    await table.close();
  }
});
