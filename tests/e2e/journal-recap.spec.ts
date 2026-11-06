import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { openJournal, seedJournal, type JournalTable } from "./journal/helpers";

// Journal JR (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JR.md): the recap parchment and 'After the
// session' on Log & recap, GM and player side by side on the design's campaign (tests/e2e/journal/helpers.ts).
// Q4: everyone writes the recap and it is always visible (no share gate); Q5: 'After the session' is GM only.

const RECAP =
  "The party followed the cart tracks to Tamsin’s cottage and traded a promise for directions. At the Forest Camp, Moss pinned the Lieutenant with roots while Brannoc broke the bandits’ line. The Sniper slipped into the trees.";
const LOOT = "Tamsin’s axe · 2 handfuls of gold";

let table: JournalTable;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  table = await seedJournal(browser);
});

test.afterAll(async () => {
  await table?.close();
});

const recapCard = (page: Page) => page.getByRole("region", { name: "Recap" });
const afterCard = (page: Page) => page.getByRole("region", { name: "After the session" });

test("the GM writes the recap and the player reads it live, then the player edits it and the GM sees it", async () => {
  const { gm, player } = table;
  await openJournal(gm, table, "?sv=log");
  await openJournal(player, table);

  await expect(recapCard(player).getByText(/No recap yet/)).toBeVisible();
  await expect(recapCard(gm).getByText("Visible to the table")).toBeVisible();
  await expect(recapCard(gm).getByRole("button", { name: /share/i })).toHaveCount(0);

  await recapCard(gm).getByRole("button", { name: "Write the recap" }).click();
  await recapCard(gm).getByRole("textbox", { name: "Recap" }).fill(RECAP);
  await recapCard(gm).getByRole("button", { name: "Save recap" }).click();
  await expect(recapCard(gm).getByText(RECAP)).toBeVisible();
  await expect(recapCard(player).getByText(RECAP)).toBeVisible();

  // Q4: the player edits it too; blur saves.
  await recapCard(player).getByRole("button", { name: "Edit recap" }).click();
  await recapCard(player).getByRole("textbox", { name: "Recap" }).fill(`${RECAP} Moss kept the axe.`);
  await player.getByRole("heading", { level: 1, name: "Journal" }).click();
  await expect(recapCard(player).getByText(/Moss kept the axe\.$/)).toBeVisible();
  await expect(recapCard(gm).getByText(/Moss kept the axe\.$/)).toBeVisible();

  // Escape drops a draft.
  await recapCard(gm).getByRole("button", { name: "Edit recap" }).click();
  await recapCard(gm).getByRole("textbox", { name: "Recap" }).fill("Thrown away");
  await recapCard(gm).getByRole("textbox", { name: "Recap" }).press("Escape");
  await expect(recapCard(gm).getByText(/Moss kept the axe\.$/)).toBeVisible();
});

test("After the session: level-ups and loot for the GM; the player reads it with no edit controls (JF2)", async () => {
  const { gm, player, client, campaignId } = table;
  await expect(afterCard(gm)).toBeVisible();
  await expect(afterCard(player)).toBeVisible();
  await expect(afterCard(player).getByRole("button", { name: /^Edit loot|^Call milestone/ })).toHaveCount(0);
  const levelUps = afterCard(gm).locator(".jrr-dl-row").first();
  await expect(levelUps).toContainText("None");

  await client.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: crypto.randomUUID() });

  await afterCard(gm).getByRole("button", { name: /^Edit loot/ }).click();
  await afterCard(gm).getByRole("textbox", { name: "Loot" }).fill(LOOT);
  await afterCard(gm).getByRole("textbox", { name: "Loot" }).press("Enter");
  await expect(afterCard(gm).getByRole("button", { name: `Edit loot: ${LOOT}` })).toBeVisible();

  // `sessionWrap.after` reads the live window up to its own `Date.now()`, so a feed row written after it ran does not
  // re-run it (and Convex serves the cached result even after a reload). The loot write above touches a row it reads,
  // so it re-runs and now sees the level-ups (reported in docs/tasks/TASK-JOURNAL-JR.md).
  await expect(levelUps).toContainText("Moss");
  await expect(levelUps).toContainText("Oriel");
  await gm.reload();
  await expect(afterCard(gm).getByText(LOOT)).toBeVisible();
});

test("axe and no sideways scroll at 1440 and 390, editing included", async () => {
  const { gm, player } = table;
  for (const page of [gm, player]) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(recapCard(page)).toBeVisible();
      await expectFitsViewport(page);
      await expectNoSeriousA11yViolations(page);
    }
  }
  await recapCard(gm).getByRole("button", { name: "Edit recap" }).click();
  await expectNoSeriousA11yViolations(gm);
  await recapCard(gm).getByRole("button", { name: "Cancel" }).click();
  await gm.setViewportSize({ width: 1440, height: 900 });
});
