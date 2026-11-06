import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { openJournal, seedJournal, type JournalTable } from "./journal/helpers";
import { visual } from "./visual/helpers";

// Journal JTh (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JTh.md): 'Threads raised' on Log & recap lists
// the caller's open threads on their Notes pages linked to the session (user Q2, `journalThreads.raised`), each with
// 'In Notes', which opens the page in the Notes sub-tab (`?tab=notes&page=<pageId>`). GM and player side by side on
// the design's campaign (tests/e2e/journal/helpers.ts). The @visual test writes the shots (E2E_VISUAL=1).

const SNIPER = "The Sniper escaped toward the chapel";
const AXE = "Tamsin’s axe: return it";
const DONE = "Pay the ferryman";
const UNLINKED = "A thread on a page with no session";
const PLAYER_TASK = "Ask Oriel about the bell";

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

type Seeded = { gmPage: Id<"journalPages">; playerPage: Id<"journalPages"> };

/** The GM's session 6 page (an open task, a Fear, a done task), a GM page with no session, and the player's own page. */
async function seedThreads(table: JournalTable): Promise<Seeded> {
  const { client, playerClient, campaignId, liveSessionId } = table;
  const add = (who: typeof client, page: Id<"journalPages">, kind: "task" | "fear", text: string) =>
    who.mutation(api.notesEntries.add, { campaignId, page, kind, text });

  const gmPage = await client.mutation(api.notes.createPage, { campaignId, kind: "log", sessionId: liveSessionId });
  await add(client, gmPage, "task", SNIPER);
  await add(client, gmPage, "fear", AXE);
  const { entryId: done } = await add(client, gmPage, "task", DONE);
  await client.mutation(api.notesEntries.cycle, { campaignId, entryId: done });
  const loose = await client.mutation(api.notes.createPage, { campaignId, kind: "log" });
  await add(client, loose, "task", UNLINKED);

  const playerPage = await playerClient.mutation(api.notes.createPage, { campaignId, kind: "log", sessionId: liveSessionId });
  await add(playerClient, playerPage, "task", PLAYER_TASK);
  return { gmPage, playerPage };
}

const card = (page: Page) => page.getByRole("region", { name: "Threads raised" });
const rows = (page: Page) => card(page).getByRole("listitem");

test.describe("Threads raised", () => {
  let table: JournalTable;
  let seeded: Seeded;

  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    table = await seedJournal(browser);
    seeded = await seedThreads(table);
  });

  test.afterAll(async () => {
    await table?.close();
  });

  test("the GM sees the open threads of their session page, and 'In Notes' opens it", async () => {
    const { gm, client, campaignId } = table;
    await openJournal(gm, table, "?sv=log");
    await expect(rows(gm)).toHaveCount(2);
    await expect(rows(gm).nth(0)).toContainText(SNIPER);
    await expect(rows(gm).nth(0)).toContainText("•");
    await expect(rows(gm).nth(1)).toContainText(AXE);
    await expect(rows(gm).nth(1)).toContainText("☠");
    await expect(card(gm)).not.toContainText(DONE);
    await expect(card(gm)).not.toContainText(UNLINKED);
    await expect(card(gm)).not.toContainText(PLAYER_TASK);

    // Live: a new task on the page shows without a reload.
    await client.mutation(api.notesEntries.add, { campaignId, page: seeded.gmPage, kind: "task", text: "Find the bell-ringer" });
    await expect(rows(gm)).toHaveCount(3);

    // Axe on the whole page (the recap line's contrast is fixed, ccd41063).
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await expect(card(gm)).toBeVisible();
      await expectNoSeriousA11yViolations(gm);
      await expectFitsViewport(gm);
    }
    await gm.setViewportSize(VIEWPORTS[0]);

    await rows(gm).filter({ hasText: SNIPER }).getByRole("button", { name: /^In Notes/ }).click();
    await expect(gm).toHaveURL(new RegExp(`[?&]tab=notes(&|$)`));
    await expect(gm).toHaveURL(new RegExp(`[?&]page=${seeded.gmPage}(&|$)`));
    await expect(gm.getByRole("tablist", { name: "Journal" }).getByRole("tab", { name: /^Notes/ })).toHaveAttribute("aria-selected", "true");
    const paper = gm.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Page" });
    await expect(paper.getByRole("listitem").filter({ hasText: SNIPER })).toBeVisible();
    await expect(paper.getByRole("listitem").filter({ hasText: UNLINKED })).toHaveCount(0);
  });

  test("the player sees only their own page's threads and opens their page", async () => {
    const { player } = table;
    await openJournal(player, table);
    await expect(rows(player)).toHaveCount(1);
    await expect(rows(player).first()).toContainText(PLAYER_TASK);
    await expect(card(player)).not.toContainText(SNIPER);
    await expectNoSeriousA11yViolations(player);

    await rows(player).first().getByRole("button", { name: /^In Notes/ }).click();
    await expect(player).toHaveURL(new RegExp(`[?&]page=${seeded.playerPage}(&|$)`));
    const paper = player.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Page" });
    await expect(paper.getByRole("listitem").filter({ hasText: PLAYER_TASK })).toBeVisible();
  });

  test("a session without linked pages shows the empty state", async () => {
    const { gm, sessions } = table;
    await openJournal(gm, table, `?sv=log&s=${sessions[5]}`);
    await expect(card(gm).getByText("No threads raised on this session's pages.")).toBeVisible();
  });
});

test("JTh threads raised at 1440 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(240_000);
  const table = await seedJournal(browser);
  try {
    await seedThreads(table);
    const { gm, player } = table;
    await openJournal(gm, table, "?sv=log");
    await expect(rows(gm)).toHaveCount(2);
    const shots = visual(gm, "JOURNAL-JTh", VIEWPORTS);
    await shots.shoot(card(gm), "gm-threads");
    await gm.setViewportSize(VIEWPORTS[0]);
    await gm.locator(".jr-cols").screenshot({ path: "test-results/visual/JOURNAL-JTh/gm-log-columns-1440.png", animations: "disabled" });

    await openJournal(player, table);
    await expect(rows(player)).toHaveCount(1);
    await visual(player, "JOURNAL-JTh", VIEWPORTS).shoot(card(player), "player-threads");

    await openJournal(gm, table, `?sv=log&s=${table.sessions[5]}`);
    await expect(card(gm).getByText(/No threads raised/)).toBeVisible();
    await visual(gm, "JOURNAL-JTh", VIEWPORTS).shoot(card(gm), "gm-empty");
  } finally {
    await table.close();
  }
});
