import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { openJournal, seedJournal } from "../journal/helpers";
import { visual } from "./helpers";

// Journal JN (docs/tasks/TASK-JOURNAL-JN.md): the Notes sub-tab at 1440 and 390, beside the design's third panel
// (reference/designs/journal/journal_views.jpg, 'Notes'). The GM's 'Session 1' page gets the design's lines; the
// player's Notes tab is shot too. Runs only with E2E_VISUAL=1.

test("JN Notes sub-tab at 1440 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(240_000);
  const table = await seedJournal(browser);
  try {
    const { gm, player, client, campaignId } = table;
    const { entryId } = await client.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.codex.update, { entryId, patch: { name: "Tamsin", role: "Woodcutter" } });

    await openJournal(gm, table, "?tab=notes&page=template-0");
    const input = gm.getByRole("region", { name: "Journal page" }).getByRole("textbox", { name: "New entry" });
    for (const line of [
      "* Return Tamsin’s axe",
      "o Ambush at the Forest Camp · see Session 6",
      "- The Lieutenant wears a ring with a crow on it",
      "! The chapel bell rings when someone lies nearby?",
      "^ The Sniper reaches the chapel before us",
    ]) {
      await input.click();
      await input.pressSequentially(line);
      await input.press("Enter");
      await expect(input).toHaveText("");
    }
    await input.pressSequentially("* Ask @tam");
    await gm.getByRole("listbox", { name: "Codex" }).getByRole("option", { name: /Tamsin/ }).waitFor();
    await input.press("Enter");
    await input.pressSequentially("about her grandson");
    await input.press("Enter");
    await expect(gm.getByRole("listitem").filter({ hasText: "about her grandson" }).getByRole("link")).toHaveText("Tamsin");

    await visual(gm, "JOURNAL-JN").shoot(gm.locator("body"), "gm-notes");
    await openJournal(gm, table, "?tab=notes&view=threads");
    await visual(gm, "JOURNAL-JN").shoot(gm.locator("body"), "gm-threads");
    await openJournal(player, table, "?tab=notes");
    await visual(player, "JOURNAL-JN").shoot(player.locator("body"), "player-notes");
  } finally {
    await table.close();
  }
});
