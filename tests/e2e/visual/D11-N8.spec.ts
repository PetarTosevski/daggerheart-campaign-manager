import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { bardDraft, convexAs, visual } from "./helpers";

// D11 N8 visual spec (E2E_VISUAL=1): 'Players’ journals', a player's journal opened by the GM, 'Past journals' and a
// past journal, at 1440x900 and 390x844. Not on the board: judged against its tokens (index-column rows, paper, tapes).

const index = (page: Page) => page.getByRole("complementary", { name: "Journal index" });
const paperColumn = (page: Page) => page.getByRole("region", { name: "Journal page" });

test("D11 N8 journals at 1440 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  test.setTimeout(240_000);
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
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });

  const context = await browser.newContext();
  try {
    const playerPage = await context.newPage();
    await signInAsTestGm(playerPage, "e2e-player@example.test");
    await expect(playerPage).toHaveURL("/");
    await playerPage.goto(`/join/${code}`);
    await playerPage.getByRole("button", { name: "Join campaign" }).click();
    await expect(playerPage.getByRole("heading", { level: 1, name })).toBeVisible();
    const player = await convexAs(playerPage);
    const { characterId } = await player.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
    const lines = [
      ["event", "Crossed the river at dawn with Mira"],
      ["task", "Ask the ferryman about the well"],
      ["fear", "Wither spreading through the Grove"],
    ] as const;
    let session: Id<"journalPages"> | null = null;
    for (const [kind, text] of lines) {
      session = (await player.mutation(api.notesEntries.add, { campaignId, page: session ?? { template: 0 }, kind, text })).pageId;
    }
    const secrets = (await player.mutation(api.notesEntries.add, { campaignId, page: { template: 1 }, kind: "note", text: "The ring is a fake" })).pageId;
    await player.mutation(api.notesSharing.setVisibility, { campaignId, page: secrets, visibility: "players" });
    await gm.mutation(api.notesEntries.add, { campaignId, page: session!, kind: "note", text: "The ferryman lies" });

    const { shoot } = visual(page, "D11-N8");
    await page.goto(`/campaigns/${campaignId}/notes`);
    const players = index(page).getByRole("region", { name: "Players’ journals" });
    await expect(players.getByRole("button", { name: /^Ash/ })).toBeVisible();
    await shoot(players, "players-journals");
    await players.getByRole("button", { name: /^Ash/ }).click();
    await expect(paperColumn(page).getByText("The ferryman lies - GM")).toBeVisible();
    await shoot(paperColumn(page), "journal-view");

    await gm.mutation(api.characters.setStatus, { characterId, status: "retired" });
    const past = index(page).getByRole("region", { name: "Past journals" });
    await expect(past.getByRole("button", { name: /^Ash’s journal/ })).toBeVisible();
    await shoot(past, "past-journals");
    await past.getByRole("button", { name: /^Ash’s journal/ }).click();
    await expect(paperColumn(page).getByText("Past journal · read only")).toBeVisible();
    await shoot(paperColumn(page), "past-journal-view");
  } finally {
    await context.close();
  }
});
