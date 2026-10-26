import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll } from "./visual/helpers";

// D11 N3: entries (.omc/plans/d11-notes.yaml). The GM writes on their own page: adds (quick keys), completes, stars,
// edits, moves and deletes entries, and migrates an open task to a new page. A player and the GM both add to the
// player's page: the GM's entry shows ' - GM' in the added colour for both. Every optimistic change is confirmed on the
// server (expect.poll through a Convex client) before the page is left.
// Own pages are opened by ?page= (`template-0` is the first default page before the journal exists); the GM reaches a
// player's page through 'Players’ journals' (N8), since ?page= names only the caller's own pages (N2).

const PLAYER = "e2e-player@example.test";

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Entries ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2] as Id<"campaigns"> };
}

async function playerJoins(page: Page, browser: Browser, campaignName: string) {
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close: () => context.close() };
}

const paperColumn = (page: Page) => page.getByRole("region", { name: "Journal page" });
const paper = (page: Page) => paperColumn(page).getByRole("article", { name: "Page" });
/** Another person's page as the GM reads it in the journal view (N8). */
const readOnlyPaper = (page: Page) => paperColumn(page).getByRole("article", { name: "Read-only page" });
const rowOf = (page: Page, text: string, area: Locator = paper(page)): Locator => area.getByRole("listitem").filter({ hasText: text });

/** At 390 px the whole index column sits behind the 'Pages' disclosure (N9); opens it when it is closed. */
async function openIndex(page: Page) {
  const toggle = page.getByRole("complementary", { name: "Journal index" }).getByRole("button", { name: /^Pages/ });
  await expect(page.getByRole("complementary", { name: "Journal index" })).toBeVisible();
  if (!(await toggle.isVisible())) return;
  // Retried: a click that lands before hydration does nothing.
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass();
}

async function write(page: Page, line: string, area: Locator = paper(page)) {
  const input = area.getByRole("textbox", { name: "New entry" });
  await input.fill(line);
  await input.press("Enter");
  await expect(input).toHaveText("");
}

test("the GM adds, completes, stars, edits, moves and deletes entries and migrates an open task", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const client = await convexAs(page);
  await page.goto(`/campaigns/${campaignId}/notes?page=template-0`);
  await expect(paper(page).getByText("A fresh page. What happened at the table?")).toBeVisible();

  // The chips pick the kind (and focus the input); quick keys pick it otherwise. The first write creates the journal
  // and gives the page its id (dcm-bxp.102): the add row stays mounted, so focus, the chosen chip and text typed right
  // after Enter all survive.
  const input = paper(page).getByRole("textbox", { name: "New entry" });
  const note = paper(page).getByRole("radiogroup", { name: "Bullet type" }).getByRole("radio", { name: /Note/ });
  await note.click();
  await expect(input).toHaveAttribute("placeholder", "Write a note and press Enter… (@ to link)");
  await expect(input).toBeFocused();
  await page.keyboard.type("Old Mag runs the ferry");
  await page.keyboard.press("Enter");
  await page.keyboard.type("* pay the ferryman");
  await page.keyboard.press("Enter");
  await expect(rowOf(page, "pay the ferryman")).toBeVisible();
  await expect(input).toBeFocused();
  await expect(note).toHaveAttribute("aria-checked", "true");
  await expect(input).toHaveText("");
  await write(page, "^ ambush at the ford");
  await expect(rowOf(page, "ambush at the ford").getByRole("button", { name: "Fear. Click to mark resolved." })).toHaveText("☠");
  await expect(rowOf(page, "Old Mag runs the ferry").getByRole("button", { name: "Note. Click to mark resolved." })).toHaveText("–");

  // Complete the task (one click), star the Fear, edit the note, move it up, delete the Fear.
  await rowOf(page, "pay the ferryman").getByRole("button", { name: "Task: open. Click to change." }).click();
  await expect(rowOf(page, "pay the ferryman").getByRole("button", { name: "Task: done. Click to change." })).toHaveText("×");
  await rowOf(page, "ambush at the ford").hover();
  await rowOf(page, "ambush at the ford").getByRole("button", { name: "Toggle priority" }).click();
  await expect(rowOf(page, "ambush at the ford").getByRole("img", { name: "Priority" })).toBeVisible();
  await rowOf(page, "Old Mag runs the ferry").getByText("Old Mag runs the ferry").dblclick();
  const edit = paper(page).getByRole("textbox", { name: "Edit entry" });
  await edit.fill("Old Mag runs the ferry at dusk");
  await edit.press("Enter");
  await expect(rowOf(page, "at dusk")).toBeVisible();
  await expect(paper(page).getByRole("listitem")).toHaveText([/at dusk/, /pay the ferryman/, /ambush at the ford/]);
  await rowOf(page, "pay the ferryman").hover();
  await rowOf(page, "pay the ferryman").getByRole("button", { name: "Move up" }).click();
  await expect(paper(page).getByRole("listitem")).toHaveText([/pay the ferryman/, /at dusk/, /ambush at the ford/]);
  await rowOf(page, "ambush at the ford").hover();
  await rowOf(page, "ambush at the ford").getByRole("button", { name: "Delete entry" }).click();
  await expect(rowOf(page, "ambush at the ford")).toHaveCount(0);

  const serverRows = async () =>
    (await client.query(api.notesEntries.entries, { campaignId, page: { template: 0 } })).entries.map((e) => [e.text, e.kind, e.state, e.star]);
  await expect
    .poll(serverRows)
    .toEqual([
      ["pay the ferryman", "task", "done", false],
      ["Old Mag runs the ferry at dusk", "note", "open", false],
    ]);

  // Migrate: a new open task goes to a new page 'Session 2', which opens; the original is marked >.
  await write(page, "* find the map");
  const migrate = page.getByRole("button", { name: "➜ Migrate open tasks" });
  await expect(migrate).toBeEnabled();
  await expect(migrate).toHaveAttribute("title", "Copy open tasks to a new page and mark them > here");
  await migrate.click();
  await expect(page).toHaveURL(/[?&]page=(?!template)[^&]+/);
  await expect(paper(page).getByRole("listitem")).toHaveText([/find the map/]);
  await expect(rowOf(page, "find the map").getByRole("button", { name: "Task: open. Click to change." })).toBeVisible();
  const target = new URL(page.url()).searchParams.get("page") as Id<"journalPages">;
  await expect.poll(async () => (await client.query(api.notesEntries.entries, { campaignId, page: target })).entries.map((e) => [e.text, e.state])).toEqual([
    ["find the map", "open"],
  ]);
  await expect.poll(async () => (await serverRows()).map(([text, , state]) => [text, state])).toEqual([
    ["pay the ferryman", "done"],
    ["Old Mag runs the ferry at dusk", "open"],
    ["find the map", "migrated"],
  ]);
});

test("a player and the GM add to the player's page: the GM's entry ends ' - GM' in the added colour for both", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const gmClient = await convexAs(page);
  const { player, close } = await playerJoins(page, browser, name);
  try {
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
    // Seed the player's journal (its first write) to learn the page id; the behaviour under test goes through the UI.
    const { pageId } = await playerClient.mutation(api.notesEntries.add, { campaignId, page: { template: 0 }, kind: "event", text: "we crossed the river" });

    await player.goto(`/campaigns/${campaignId}/notes?page=${pageId}`);
    await write(player, "* ask about the lantern");
    await expect(rowOf(player, "ask about the lantern")).toBeVisible();

    // The GM opens the player's page ('gm' visibility, the default) through 'Players’ journals' and adds an entry.
    await page.goto(`/campaigns/${campaignId}/notes`);
    await openIndex(page);
    await page.getByRole("complementary", { name: "Journal index" }).getByRole("region", { name: "Players’ journals" }).getByRole("button", { name: /^Ash/ }).click();
    await expect(page).toHaveURL(/view=journal&journal=/);
    // The journal opens on its first page, 'Session 1' (the seeded page).
    await expect(paperColumn(page).getByRole("navigation", { name: "Pages of Ash’s Journal" }).getByRole("button", { name: /^Session 1/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const gmPaper = readOnlyPaper(page);
    await expect(gmPaper.getByRole("heading", { level: 3, name: "Session 1" })).toBeVisible();
    await expect(rowOf(page, "we crossed the river", gmPaper)).toBeVisible();
    await expect(page.getByRole("button", { name: "➜ Migrate open tasks" })).toHaveCount(0);
    await expect(rowOf(page, "we crossed the river", gmPaper).getByRole("button", { name: "Delete entry" })).toHaveCount(0);
    await write(page, "the ferryman lies", gmPaper);
    for (const [viewer, area] of [
      [page, gmPaper],
      [player, paper(player)],
    ] as const) {
      const added = rowOf(viewer, "the ferryman lies", area).locator(".bj-text");
      await expect(added).toHaveText("the ferryman lies - GM");
      await expect(added).toHaveClass(/bj-added/);
      await expect(rowOf(viewer, "we crossed the river", area).locator(".bj-text")).toHaveText("we crossed the river");
    }
    // The owner may delete the GM's entry but not edit it; the GM may edit it.
    await expect(rowOf(player, "the ferryman lies").getByRole("button", { name: "Edit entry" })).toHaveCount(0);
    await expect(rowOf(player, "the ferryman lies").getByRole("button", { name: "Delete entry" })).toBeAttached();
    await rowOf(page, "the ferryman lies", gmPaper).getByText("the ferryman lies").dblclick();
    const edit = page.getByRole("textbox", { name: "Edit entry" });
    await edit.fill("the ferryman lies twice");
    await edit.press("Enter");
    await expect(rowOf(player, "lies twice").locator(".bj-text")).toHaveText("the ferryman lies twice - GM");
    await expect
      .poll(async () => (await gmClient.query(api.notesEntries.entries, { campaignId, page: pageId })).entries.map((e) => [e.text, e.added, e.authorLabel]))
      .toEqual([
        ["we crossed the river", false, "Ash"],
        ["ask about the lantern", false, "Ash"],
        ["the ferryman lies twice", true, "GM"],
      ]);
  } finally {
    await close();
  }
});

test("entries fit a phone: one column, no horizontal scroll, 44 px bullets, row actions on hover or focus", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const client = await convexAs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/campaigns/${campaignId}/notes?page=template-0`);
  await write(page, "* a long task line that has to wrap on a narrow phone screen without scrolling sideways");
  await expectNoHorizontalScroll(page);
  const row = rowOf(page, "a long task line");
  expect((await row.getByRole("button", { name: /^Task: / }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await row.hover();
  expect((await row.getByRole("button", { name: "Delete entry" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (const chip of await paper(page).getByRole("radio").all()) expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect.poll(async () => (await client.query(api.notesEntries.entries, { campaignId, page: { template: 0 } })).entries.length).toBe(1);
});
