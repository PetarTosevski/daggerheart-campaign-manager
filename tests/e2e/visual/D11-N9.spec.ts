import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { bardDraft, convexAs, visual } from "./helpers";

// D11 N9 visual pass (E2E_VISUAL=1): every board region of Notes at 1440x900 and 390x844, seeded like the board's story
// (scripts/board-shots.mjs NOTES_STORY: the same eleven Session 1 lines, Mira in the Codex, 'Rumors & hooks' with a
// task and a Fear). Board counterparts: `node scripts/board-shots.mjs notes:all` (1440 only). 390 shots are checked
// against the plan's 390 rules (one column, no horizontal scroll, the 'Pages' disclosure over the whole index).

const paperColumn = (page: Page) => page.getByRole("region", { name: "Journal page" });

const LINES = [
  ["event", "Crossed the river at dawn with @Mira", 0, false],
  ["task", "Ask the ferryman about the well", 0, true],
  ["task", "Pay the toll", 1, false],
  ["task", "Map the ford", 2, false],
  ["task", "Visit the shrine", 3, false],
  ["task", "Chase the goat", 4, false],
  ["note", "The ferryman owes Mira a favour", 0, false],
  ["idea", "A rival crew on the river?", 0, false],
  ["hope", "The grove spirits are friendly", 0, false],
  ["fear", "Wither spreading through the Grove", 0, false],
  ["fear", "Bandits at the ford", 1, false],
] as const;

test("D11 N9 notes regions at 1440 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  test.setTimeout(300_000);
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
  const { shoot } = visual(page, "D11-N9");
  const root = page.locator(".bj-root");

  // notes:empty - the GM's default pages before the first write.
  await page.goto(`/campaigns/${campaignId}/notes`);
  await expect(page.getByRole("heading", { level: 1, name: "Game Master’s Journal" })).toBeVisible();
  await shoot(root, "empty");

  // 390 only: the 'Pages' disclosure open (the whole index column).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Pages/ }).click();
  await expect(page.getByRole("searchbox", { name: "Search the journal" })).toBeVisible();
  await root.screenshot({ path: "test-results/visual/D11-N9/index-open-390.png", animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 900 });

  // The board's story.
  const { entryId: mira } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.codex.update, { entryId: mira, patch: { name: "Mira", role: "Ferry captain", known: true } });
  let session: Id<"journalPages"> | null = null;
  for (const [kind, text, cycles, star] of LINES) {
    const added: { entryId: Id<"journalEntries">; pageId: Id<"journalPages"> } = await gm.mutation(api.notesEntries.add, {
      campaignId,
      page: session ?? { template: 0 },
      kind,
      text: text.replace("@Mira", `@[Mira](${mira})`),
    });
    session = added.pageId;
    for (let i = 0; i < cycles; i++) await gm.mutation(api.notesEntries.cycle, { campaignId, entryId: added.entryId });
    if (star) await gm.mutation(api.notesEntries.toggleStar, { campaignId, entryId: added.entryId });
  }
  const { pageId: rumors } = await gm.mutation(api.notesEntries.add, { campaignId, page: { template: 1 }, kind: "task", text: "Find who poisoned the well" });
  await gm.mutation(api.notesEntries.add, { campaignId, page: rumors, kind: "fear", text: "The Doom countdown" });

  // notes:page - every kind and state, a star, a mention.
  await page.goto(`/campaigns/${campaignId}/notes?page=${session}`);
  await expect(paperColumn(page).getByRole("link", { name: "Mira" })).toBeVisible();
  await shoot(paperColumn(page), "page");

  // notes:search - 'ferry' (index matches and highlighted rows).
  await page.getByRole("searchbox", { name: "Search the journal" }).fill("ferry");
  await expect(paperColumn(page).locator(".bj-hit").first()).toBeVisible();
  // B9: the index keeps only matching pages ('Rumors & hooks' has no 'ferry').
  await expect(page.getByRole("navigation", { name: "Your pages" }).getByRole("group", { name: "Collections" })).toContainText("No matches.");
  await shoot(page.locator("main"), "search");
  await page.getByRole("searchbox", { name: "Search the journal" }).fill("");

  // notes:threads.
  await page.getByRole("button", { name: /Open threads/ }).click();
  await expect(paperColumn(page).getByText("Wither spreading through the Grove")).toBeVisible();
  await shoot(paperColumn(page), "threads");
  await page.getByRole("button", { name: /Open threads/ }).click();

  // notes:tear - a frame mid-rip (about 500 ms in, as the board shot).
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/campaigns/${campaignId}/notes?page=${rumors}`);
    await expect(paperColumn(page).getByLabel("Page title")).toHaveValue("Rumors & hooks");
    await paperColumn(page).getByRole("button", { name: "Tear out page" }).click();
    await paperColumn(page).getByRole("button", { name: "Click again to tear out" }).click();
    await expect(page.getByTestId("tear-frame")).toBeAttached();
    await page.waitForTimeout(450);
    await page.screenshot({ path: `test-results/visual/D11-N9/tear-${viewport.width}.png` });
    await page.getByRole("status").filter({ hasText: "Page torn out" }).getByRole("button", { name: "Undo" }).click();
    await expect(paperColumn(page).getByLabel("Page title")).toHaveValue("Rumors & hooks");
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // notes:player - a player's default pages under '<character>’s Journal'.
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const player = await context.newPage();
    await signInAsTestGm(player, "e2e-player@example.test");
    await expect(player).toHaveURL("/");
    await player.goto(`/join/${code}`);
    await player.getByRole("button", { name: "Join campaign" }).click();
    await expect(player.getByRole("heading", { level: 1, name })).toBeVisible();
    const client = await convexAs(player);
    await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Liriel"), idempotencyKey: crypto.randomUUID() });
    await player.goto(`/campaigns/${campaignId}/notes`);
    await expect(player.getByRole("heading", { level: 1, name: "Liriel’s Journal" })).toBeVisible();
    await visual(player, "D11-N9").shoot(player.locator(".bj-root"), "player");
  } finally {
    await context.close();
  }
});
