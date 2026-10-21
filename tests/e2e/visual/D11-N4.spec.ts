import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { convexAs, visual } from "./helpers";

// D11 N4 visual spec (E2E_VISUAL=1): the threads view and a search ('ferry') on the GM's journal seeded with the board's
// sample pages (scripts/board-shots.mjs NOTES_STORY), at 1440x900 and 390x844.
// Board counterparts: `node scripts/board-shots.mjs notes:threads notes:search`
// (test-results/visual/board/notes-threads-1440.png, notes-search-1440.png).

test("D11 N4 threads view and search at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const client = await convexAs(page);

  // The board's 'Session 1' (every kind and state, a star) and 'Rumors & hooks' (a task and a Fear).
  const session1 = [
    ["event", "Crossed the river at dawn with Mira", 0],
    ["task", "Ask the ferryman about the well", 0],
    ["task", "Pay the toll", 1],
    ["task", "Map the ford", 2],
    ["task", "Visit the shrine", 3],
    ["task", "Chase the goat", 4],
    ["note", "The ferryman owes Mira a favour", 0],
    ["idea", "A rival crew on the river?", 0],
    ["hope", "The grove spirits are friendly", 0],
    ["fear", "Wither spreading through the Grove", 0],
    ["fear", "Bandits at the ford", 1],
  ] as const;
  const rumors = [
    ["task", "Find who poisoned the well", 0],
    ["fear", "The Doom countdown", 0],
  ] as const;
  let star: Id<"journalEntries"> | null = null;
  for (const [template, lines] of [[0, session1], [1, rumors]] as const) {
    for (const [kind, text, cycles] of lines) {
      const { entryId } = await client.mutation(api.notesEntries.add, { campaignId, page: { template }, kind, text });
      for (let c = 0; c < cycles; c++) await client.mutation(api.notesEntries.cycle, { campaignId, entryId });
      if (text === "Ask the ferryman about the well") star = entryId;
    }
  }
  await client.mutation(api.notesEntries.toggleStar, { campaignId, entryId: star! });

  await page.goto(`/campaigns/${campaignId}/notes`);
  await page.getByRole("button", { name: /^🧵 Open threads · 4$/ }).click();
  const paper = page.getByRole("region", { name: "Journal page" });
  await expect(paper.getByRole("article", { name: "Open threads" }).getByRole("listitem")).toHaveCount(4);
  const { shoot } = visual(page, "D11-N4");
  await page.mouse.move(0, 0); // no hover highlight on a row
  await shoot(paper, "threads");

  await page.goto(`/campaigns/${campaignId}/notes`);
  await page.getByRole("searchbox", { name: "Search the journal" }).fill("ferry");
  const nav = page.getByRole("navigation", { name: "Your pages" });
  await expect(nav.getByRole("button", { name: /Rumors & hooks/ })).toHaveCount(0);
  await expect(paper.getByRole("listitem").filter({ hasText: "Ask the ferryman" })).toHaveClass(/bj-hit/);
  await page.mouse.move(0, 0);
  await shoot(page.locator("main"), "search");
});
