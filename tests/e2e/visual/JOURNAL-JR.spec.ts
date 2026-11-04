import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { openJournal, seedJournal } from "../journal/helpers";
import { visual } from "./helpers";

// Journal JR visual spec (E2E_VISUAL=1): the recap parchment and 'After the session' at 1440x900 and 390x844 (design
// reference/designs/journal/journal_views.jpg, Log & recap: 'Recap' under the log, 'After the session' last on the
// right). GM reading, GM editing, the player's recap, the empty recap and the loot editor.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

const RECAP =
  "The party followed the cart tracks to Tamsin’s cottage and traded a promise for directions. At the Forest Camp, Moss pinned the Lieutenant with roots while Brannoc broke the bandits’ line. The Sniper slipped into the trees.";

test("JR recap and after the session at 1440 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(240_000);
  const table = await seedJournal(browser);
  try {
    const { gm, player, client, campaignId, liveSessionId } = table;
    const recap = (page: Page) => page.getByRole("region", { name: "Recap" });
    const after = (page: Page) => page.getByRole("region", { name: "After the session" });

    await openJournal(gm, table, "?sv=log");
    const gmShots = visual(gm, "JOURNAL-JR", VIEWPORTS);
    await expect(recap(gm).getByText(/No recap yet/)).toBeVisible();
    await gmShots.shoot(recap(gm), "gm-recap-empty");

    await client.mutation(api.sessionWrap.setRecap, { campaignId, sessionId: liveSessionId, recap: RECAP });
    await client.mutation(api.sessionWrap.setLoot, { campaignId, sessionId: liveSessionId, loot: "Tamsin’s axe · 2 handfuls of gold" });
    await expect(recap(gm).getByText(RECAP)).toBeVisible();
    await gmShots.shoot(recap(gm), "gm-recap");
    await gmShots.shoot(after(gm), "gm-after");

    await recap(gm).getByRole("button", { name: "Edit recap" }).click();
    await recap(gm).screenshot({ path: "test-results/visual/JOURNAL-JR/gm-recap-editing-1440.png", animations: "disabled" });
    await recap(gm).getByRole("button", { name: "Cancel" }).click();
    await after(gm).getByRole("button", { name: /^Edit loot/ }).click();
    await after(gm).screenshot({ path: "test-results/visual/JOURNAL-JR/gm-loot-editing-1440.png", animations: "disabled" });
    await after(gm).getByRole("textbox", { name: "Loot" }).press("Escape");

    await gm.setViewportSize(VIEWPORTS[0]);
    await gm.locator(".jr-cols").screenshot({ path: "test-results/visual/JOURNAL-JR/gm-log-columns-1440.png", animations: "disabled" });

    await openJournal(player, table);
    await expect(recap(player).getByText(RECAP)).toBeVisible();
    await visual(player, "JOURNAL-JR", VIEWPORTS).shoot(recap(player), "player-recap");
  } finally {
    await table.close();
  }
});
