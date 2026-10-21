import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll } from "./visual/helpers";

// D11 N2: own journal and pages (.omc/plans/d11-notes.yaml). The GM opens Notes and sees the four default pages; with
// Session 2 live, adds a session log titled 'Session 2' that shows its date; adds a collection, renames it and changes
// its tape; a reload keeps it. A player with a character sees the player defaults under '<character>’s Journal'.
// Optimistic changes are confirmed on the server (expect.poll through a Convex client) before the page is left.

const PLAYER = "e2e-player@example.test";

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Notes ${crypto.randomUUID().slice(0, 8)}`;
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

function group(page: Page, label: string) {
  return page.getByRole("navigation", { name: "Your pages" }).getByRole("group", { name: label });
}

test("the GM's journal: default pages, a session log for the live session, a renamed and re-taped collection", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const client = await convexAs(page);
  const uuid = () => crypto.randomUUID();
  await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: uuid() });
  const { sessionId: two } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: uuid() });
  await client.mutation(api.sessionRecords.setDate, { campaignId, sessionId: two, date: "2026-10-24" });
  await client.mutation(api.sessions.start, { campaignId, sessionId: two, idempotencyKey: uuid() });

  await page.goto(`/campaigns/${campaignId}/notes`);
  await expect(page.getByRole("heading", { level: 1, name: "Game Master’s Journal" })).toBeVisible();
  await expect(page.getByText("GM journal · private to the GM · 4 pages · 0 entries")).toBeVisible();
  await expect(group(page, "Session logs").getByRole("button", { name: /^Session 1/ })).toHaveAttribute("aria-current", "page");
  await expect(group(page, "Collections").getByRole("button", { name: /Rumors & hooks|Loot & debts/ })).toHaveText([/Rumors & hooks/, /Loot & debts/]);
  await expect(group(page, "Future log").getByRole("button", { name: /^Future log/ })).toBeVisible();
  const paper = page.getByRole("article", { name: "Page" });
  await expect(paper.getByLabel("Page title")).toHaveValue("Session 1");
  // The default Session 1 is linked to the live session (D6): its meta shows that session's date.
  await expect(paper.getByText(/^session log · .*24.*2026$/)).toBeVisible();
  await expect(page.getByText(/PIN|Writing as/)).toHaveCount(0);

  // '＋ New session log': the picker preselects the live session (D6).
  await group(page, "Session logs").getByRole("button", { name: "New session log" }).click();
  const picker = page.getByRole("dialog", { name: "New session log" });
  await expect(picker.getByRole("radio", { name: /^Session 2/ })).toBeChecked();
  await expect(picker.getByRole("radio", { name: /^No session/ })).toBeVisible();
  await picker.getByRole("button", { name: "Add the page" }).click();
  await expect(picker).toBeHidden();
  await expect(paper.getByLabel("Page title")).toHaveValue("Session 2");
  await expect(paper.getByText(/^session log · .*24.*2026$/)).toBeVisible();
  await expect(group(page, "Session logs").getByRole("button", { name: /^Session 2/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("GM journal · private to the GM · 5 pages · 0 entries")).toBeVisible();

  // A collection: add, rename (Enter saves), change its tape.
  await group(page, "Collections").getByRole("button", { name: "New collection" }).click();
  await expect(paper.getByLabel("Page title")).toHaveValue("New collection");
  const tape = paper.getByTestId("page-tape");
  await expect(tape).toHaveClass(/bj-tape-5/);
  await paper.getByLabel("Page title").fill("Debts to the Baron");
  await paper.getByLabel("Page title").press("Enter");
  await expect(tape).toHaveText("Debts to the Baron");
  await expect(group(page, "Collections").getByRole("button", { name: /Debts to the Baron/ })).toBeVisible();
  await paper.getByRole("button", { name: "🎀 Tape" }).click();
  await expect(tape).toHaveClass(/bj-tape-0/);

  // The server has both changes before the page reloads.
  await expect
    .poll(async () => {
      const view = await client.query(api.notes.journal, { campaignId });
      const p = view.journal === null ? undefined : view.pages.find((x) => x.title === "Debts to the Baron");
      return p ? p.tape : null;
    })
    .toBe(0);
  await page.reload();
  await expect(paper.getByLabel("Page title")).toHaveValue("Debts to the Baron");
  await expect(tape).toHaveClass(/bj-tape-0/);
  await expect(group(page, "Collections").getByRole("button", { name: /Debts to the Baron/ })).toHaveAttribute("aria-current", "page");
});

test("a player sees the player defaults under '<character>’s Journal'", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);
  try {
    const client = await convexAs(player);
    await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Liriel"), idempotencyKey: crypto.randomUUID() });
    await player.goto(`/campaigns/${campaignId}/notes`);
    await expect(player.getByRole("heading", { level: 1, name: "Liriel’s Journal" })).toBeVisible();
    await expect(player.getByText("Player journal · Bard · 4 pages · 0 entries")).toBeVisible();
    await expect(group(player, "Session logs").getByRole("button", { name: /^Session 1/ })).toBeVisible();
    await expect(group(player, "Collections").getByRole("button", { name: /People we met|Clues & secrets|My goals/ })).toHaveText([
      /People we met/,
      /Clues & secrets/,
      /My goals/,
    ]);
    await expect(group(player, "Future log").getByText("Nothing here yet.")).toBeVisible();
    // Each page carries its visibility mark: 'gm' by default (A4).
    await expect(group(player, "Collections").getByRole("button", { name: /People we met/ })).toContainText("Private · GM can read");

    // Renaming a default page before the first write creates the journal (template ref, CL6).
    await group(player, "Collections").getByRole("button", { name: /My goals/ }).click();
    await expect(player).toHaveURL(/page=template-3/);
    const title = player.getByRole("article", { name: "Page" }).getByLabel("Page title");
    await title.fill("Find my sister");
    await title.blur();
    await expect(group(player, "Collections").getByRole("button", { name: /Find my sister/ })).toBeVisible();
    await expect
      .poll(async () => {
        const view = await client.query(api.notes.journal, { campaignId });
        return view.journal === null ? null : view.pages.map((p) => p.title);
      })
      .toEqual(["Session 1", "People we met", "Clues & secrets", "Find my sister"]);
  } finally {
    await close();
  }
});

test("at 390 px the pages sit behind a 'Pages' disclosure; the session picker fits", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/campaigns/${campaignId}/notes`);
  await expect(page.getByRole("heading", { level: 1, name: "Game Master’s Journal" })).toBeVisible();
  const toggle = page.getByRole("button", { name: /Pages/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(group(page, "Collections")).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const rumors = group(page, "Collections").getByRole("button", { name: /Rumors & hooks/ });
  expect((await rumors.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await rumors.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("article", { name: "Page" }).getByLabel("Page title")).toHaveValue("Rumors & hooks");
  await expectNoHorizontalScroll(page);

  await toggle.click();
  await group(page, "Session logs").getByRole("button", { name: "New session log" }).click();
  const picker = page.getByRole("dialog", { name: "New session log" });
  await expect(picker.getByRole("radio", { name: /^No session/ })).toBeChecked();
  await expectNoHorizontalScroll(page);
  await picker.getByRole("button", { name: "Cancel" }).click();
  await expect(picker).toBeHidden();
});
