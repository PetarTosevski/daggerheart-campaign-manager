import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { bardDraft, convexAs, visual } from "./helpers";

// D11 N3 visual spec (E2E_VISUAL=1): a page with every bullet kind, every task state, a star, a resolved line and an
// entry added by the GM, at 1440x900 and 390x844, seen by its owner (a player, character 'Ash').
// Board counterpart: `node scripts/board-shots.mjs notes:page` (test-results/visual/board/notes-page-1440.png).

const PLAYER = "e2e-player@example.test";

test("D11 N3 entries page at 1440 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const gm = await convexAs(page);

  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.goto(`/join/${code}`);
  await player.getByRole("button", { name: "Join campaign" }).click();
  await expect(player.getByRole("heading", { level: 1, name })).toBeVisible();
  const client = await convexAs(player);
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });

  // The board's sample page (notes:page): an event, tasks in every state, a note, an idea, Hope, Fear, a resolved Fear,
  // a star; plus an entry the GM added.
  const lines = [
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
  let pageId: Id<"journalPages"> | null = null;
  const ids: Id<"journalEntries">[] = [];
  for (const [kind, text, cycles] of lines) {
    const added: { entryId: Id<"journalEntries">; pageId: Id<"journalPages"> } = await client.mutation(api.notesEntries.add, { campaignId, page: pageId ?? { template: 0 }, kind, text });
    pageId = added.pageId;
    for (let c = 0; c < cycles; c++) await client.mutation(api.notesEntries.cycle, { campaignId, entryId: added.entryId });
    ids.push(added.entryId);
  }
  await client.mutation(api.notesEntries.toggleStar, { campaignId, entryId: ids[1]! });
  await gm.mutation(api.notesEntries.add, { campaignId, page: pageId!, kind: "note", text: "Old Mag lied about the toll" });

  await player.goto(`/campaigns/${campaignId}/notes?page=${pageId}`);
  const sheet = player.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Page" });
  await expect(sheet.getByRole("listitem")).toHaveCount(12);
  await expect(sheet.getByText("Old Mag lied about the toll - GM")).toBeVisible();
  const { shoot } = visual(player, "D11-N3");
  await shoot(sheet, "page");
  await sheet.getByRole("listitem").filter({ hasText: "Ask the ferryman" }).hover();
  await shoot(sheet.getByRole("list", { name: "Entries" }), "rows-hover");
  await context.close();
});
