import { expect, test, type Page } from "@playwright/test";

import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { openJournal, seedJournal, type JournalTable } from "./journal/helpers";
import { visual } from "./visual/helpers";

// Journal J1 (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-J1.md): the page shell at /journal for the GM and
// a player on the design's campaign (tests/e2e/journal/helpers.ts): header frame, Sessions / Notes sub-tabs with
// counts, the GM's Plan / Log & recap toggle, the Combat Map link, URL state, axe and no sideways scroll at 1440x900
// and 390x844. The @visual test (E2E_VISUAL=1) writes the board-match shots to test-results/visual/JOURNAL-J1/.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

let table: JournalTable;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  table = await seedJournal(browser);
});

test.afterAll(async () => {
  await table?.close();
});

/** Axe and no sideways scroll at both viewports; ends at 1440x900. */
async function checkViewports(page: Page) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
    await expectFitsViewport(page);
    await expectNoSeriousA11yViolations(page);
  }
  await page.setViewportSize(VIEWPORTS[0]);
}

test("GM: header, sub-tabs with counts, Plan / Log & recap, Notes, URL state", async () => {
  const { gm, campaignId, liveSessionId } = table;
  await gm.setViewportSize(VIEWPORTS[0]);
  await openJournal(gm, table);
  await expect(gm).toHaveTitle(/^Journal · /);
  await expect(gm.getByText("The Witherwild", { exact: true })).toBeVisible();
  await expect(gm.getByText("Every session and every note, in one place.")).toBeVisible();

  const tabs = gm.getByRole("tablist", { name: "Journal" });
  await expect(tabs.getByRole("tab", { name: "Sessions 6" })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab", { name: /^Notes \d+ pages?$/ })).toHaveAttribute("aria-selected", "false");

  const view = gm.getByRole("tablist", { name: "Session view" });
  await expect(view.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
  await expect(gm.getByRole("link", { name: "Play on the Combat Map" })).toHaveAttribute("href", `/campaigns/${campaignId}/combat-map`);
  await expect(gm.getByRole("complementary", { name: "All sessions" })).toBeVisible();
  await checkViewports(gm);

  // The view toggle names the default (live) session in the URL; a reload keeps the view.
  await view.getByRole("tab", { name: "Log & recap" }).click();
  await expect(gm).toHaveURL(new RegExp(`\\?s=${liveSessionId}&sv=log$`));
  await gm.reload();
  await expect(gm.getByRole("tablist", { name: "Session view" }).getByRole("tab", { name: "Log & recap" })).toHaveAttribute("aria-selected", "true");
  await checkViewports(gm);

  // The Notes sub-tab keeps the other params; a bad value falls back.
  await gm.getByRole("tablist", { name: "Journal" }).getByRole("tab", { name: /^Notes/ }).click();
  await expect(gm).toHaveURL(/tab=notes/);
  await expect(gm.getByRole("tablist", { name: "Journal" }).getByRole("tab", { name: /^Notes/ })).toHaveAttribute("aria-selected", "true");
  await expect(gm.getByRole("complementary", { name: "All sessions" })).toBeHidden();
  await checkViewports(gm);

  await openJournal(gm, table, "?tab=bogus&sv=bogus");
  await expect(gm.getByRole("tablist", { name: "Journal" }).getByRole("tab", { name: "Sessions 6" })).toHaveAttribute("aria-selected", "true");
  await expect(gm.getByRole("tablist", { name: "Session view" }).getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
});

test("player: live and played sessions only, no view toggle, both sub-tabs", async () => {
  const { player } = table;
  await player.setViewportSize(VIEWPORTS[0]);
  await openJournal(player, table, "?sv=plan");
  const tabs = player.getByRole("tablist", { name: "Journal" });
  await expect(tabs.getByRole("tab", { name: "Sessions 5" })).toHaveAttribute("aria-selected", "true");
  await expect(player.getByRole("link", { name: "Play on the Combat Map" })).toBeVisible();
  await expect(player.getByRole("tablist", { name: "Session view" })).toHaveCount(0);
  await checkViewports(player);

  await tabs.getByRole("tab", { name: /^Notes/ }).click();
  await expect(player).toHaveURL(/tab=notes/);
  await expect(tabs.getByRole("tab", { name: /^Notes/ })).toHaveAttribute("aria-selected", "true");
  await checkViewports(player);
});

test("J1 board-match shots at 1440 and 390", { tag: "@visual" }, async () => {
  const { gm, player } = table;
  const body = (page: Page) => page.locator("body");
  await openJournal(gm, table);
  const gmShots = visual(gm, "JOURNAL-J1");
  await gmShots.shoot(body(gm), "gm-plan");
  await openJournal(gm, table, "?sv=log");
  await gmShots.shoot(body(gm), "gm-log");
  await openJournal(gm, table, "?tab=notes");
  await gmShots.shoot(body(gm), "gm-notes");
  await openJournal(player, table);
  await visual(player, "JOURNAL-J1").shoot(body(player), "player-sessions");
});
