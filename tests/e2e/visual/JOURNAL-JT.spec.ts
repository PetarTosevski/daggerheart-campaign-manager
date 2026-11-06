import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { JOURNAL_PCS, openJournal, seedJournal } from "../journal/helpers";
import { visual } from "./helpers";

// Journal JT visual spec (E2E_VISUAL=1): the Session tally and Spotlight cards at 1440x900 and 390x844, beside the
// design's right column (reference/designs/journal/journal_views.jpg, panel 2). The seed plays the design's numbers
// where the server can: Fear 0 → 4, 3 spent; two critical rolls; the spotlight handed Moss 6, Brannoc 5, Vex 3,
// Oriel 2 times. Hope spent / HP marked / defeats stay 0 (they need sheet saves and a fought encounter). Also the
// planned session 7's tiles ('-') and the full GM page.

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

const HANDS = ["Moss", "Brannoc", "Moss", "Brannoc", "Moss", "Brannoc", "Moss", "Brannoc", "Moss", "Brannoc", "Vex", "Moss", "Vex", "Oriel", "Vex", "Oriel"] as const;

test("JT tally and spotlight at 1440 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(240_000);
  const table = await seedJournal(browser);
  try {
    const { gm, client, playerClient, campaignId, characterId, liveSessionId: sessionId, sessions } = table;
    const key = () => crypto.randomUUID();
    await client.mutation(api.fear.set, { campaignId, value: 4, idempotencyKey: key() });
    for (let i = 0; i < 3; i++) await client.mutation(api.fear.adjust, { campaignId, direction: "decrease", idempotencyKey: key() });
    await playerClient.mutation(api.rolls.manualRoll, { characterId, roll: presence, values: [7, 7], idempotencyKey: key() });
    await playerClient.mutation(api.rolls.manualRoll, { characterId, roll: presence, values: [10, 10], idempotencyKey: key() });

    const party = await client.query(api.charactersReads.partySummary, { campaignId });
    const ids = new Map<string, Id<"characters">>(party.map((c) => [c.sheet.name, c._id]));
    expect([...ids.keys()].sort()).toEqual([...JOURNAL_PCS].sort());
    for (const name of HANDS) await client.mutation(api.combatSpotlight.handTo, { campaignId, characterId: ids.get(name)!, idempotencyKey: key() });

    await openJournal(gm, table, `?s=${sessionId}&sv=log`);
    const tally = gm.getByRole("region", { name: "Session tally" });
    const spot = gm.getByRole("region", { name: "Spotlight" });
    await expect(tally.getByRole("listitem").filter({ hasText: "Fear gained" })).toHaveText("4 Fear gained");
    await expect(tally.getByRole("listitem").filter({ hasText: "Critical successes" })).toHaveText("2 Critical successes");
    await expect(gm.getByText("Oriel has had the least spotlight this session.")).toBeVisible();

    const shots = visual(gm, "JOURNAL-JT", VIEWPORTS);
    await shots.shoot(tally, "gm-tally");
    await shots.shoot(spot, "gm-spotlight");
    await gm.screenshot({ path: "test-results/visual/JOURNAL-JT/gm-page-1440.png", fullPage: true, animations: "disabled" });

    await openJournal(gm, table, `?s=${sessions[7]}&sv=log`);
    await expect(tally.getByRole("listitem").first()).toContainText("-");
    await shots.shoot(tally, "gm-tally-planned");
  } finally {
    await table.close();
  }
});
