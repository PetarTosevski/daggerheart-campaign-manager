import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { openJournal, seedJournal } from "../journal/helpers";
import { visual } from "./helpers";

// Journal JP2 visual spec (E2E_VISUAL=1): the Combat scene's encounter card and the 'Battle points · Scene 3' panel
// at 1440x900 and 390x844 (design reference/designs/journal/journal_views.jpg, Plan: scene 3's encounter and the right
// column), with the encounter on the live map; then the card without an encounter (create / link).

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

test("JP2 encounter card and Battle Points at 1440 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(240_000);
  const table = await seedJournal(browser);
  try {
    const { gm, client, campaignId, liveSessionId } = table;
    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Forest camp", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
    await client.mutation(api.combatTokens.placeSessionEncounter, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });

    await gm.setViewportSize(VIEWPORTS[0]);
    await openJournal(gm, table, `?s=${liveSessionId}&sv=plan`);
    const card = gm.getByTestId("scene-encounter");
    const panel = gm.getByTestId("bp-panel");
    await expect(card.getByTestId("scene-encounter-on-map")).toBeVisible();
    await expect(panel.getByTestId("bp-spent")).toHaveText(/10\s*of 14 spent/);
    const shots = visual(gm, "JOURNAL-JP2", VIEWPORTS);
    await shots.shoot(card, "encounter-card");
    await shots.shoot(panel, "battle-points");

    await card.getByRole("button", { name: /^Unlink .* from this scene$/ }).click();
    await expect(card.getByRole("button", { name: "Create encounter" })).toBeVisible();
    await shots.shoot(card, "encounter-none");
  } finally {
    await table.close();
  }
});
