import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll } from "./visual/helpers";

// D11 N9: Notes end to end (.omc/plans/d11-notes.yaml). The GM and two players, Ash (A) and Bram (B), each in their own
// browser, at 1440x900 and 390x844 (at 390 the whole index column sits behind the 'Pages' disclosure).
//   1. The GM adds a session log linked to the live session, writes on it (a second GM tab updates live), migrates the
//      open task to a new page, shares 'Rumors & hooks' with A only and the session log with everyone.
//   2. A and B write in their character journals and add to the GM's 'everyone' page: ' - Ash' / ' - Bram' (Q3). A makes
//      'Clues & secrets' players-only; B keeps 'Session 1' at the default (GM reads it) and hides 'My goals' from
//      everyone. Every browser's Shared tabs hold exactly the pages the visibility rules allow.
//   3. The GM tears out the 'everyone' page: both players lose it; Undo brings it back with every entry (Q11).
//   4. B's character retires: B's non-private pages appear under Past journals for the GM and A, the private one does not
//      (Q12, D1).
// Every optimistic write is confirmed on the server (expect.poll through a Convex client) before another browser checks it.

const PLAYER_A = "e2e-player@example.test";
// The e2e allowlist (scripts/e2e-setup.mjs) has two non-GM accounts; N6's sharing spec uses this one as player B too.
const PLAYER_B = "e2e-player2@example.test";

type Seat = { page: Page; client: ConvexHttpClient };
type Viewport = { width: number; height: number };

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Flow ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2] as Id<"campaigns"> };
}

/** A player in their own browser joins by code and gets a character (seeded through Convex). */
async function playerJoins(browser: Browser, viewport: Viewport, email: string, code: string, campaign: { name: string; campaignId: Id<"campaigns"> }, hero: string) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signInAsTestGm(page, email);
  await expect(page).toHaveURL("/");
  await page.goto(`/join/${code}`);
  await page.getByRole("button", { name: "Join campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name: campaign.name })).toBeVisible();
  const client = await convexAs(page);
  const { characterId } = await client.mutation(api.characters.create, { campaignId: campaign.campaignId, draft: bardDraft(hero), idempotencyKey: crypto.randomUUID() });
  return { seat: { page, client } satisfies Seat, characterId, close: () => context.close() };
}

const index = (page: Page) => page.getByRole("complementary", { name: "Journal index" });
const paperColumn = (page: Page) => page.getByRole("region", { name: "Journal page" });
const ownPaper = (page: Page) => paperColumn(page).getByRole("article", { name: "Page" });
const rowOf = (page: Page, text: string | RegExp): Locator => paperColumn(page).getByRole("listitem").filter({ hasText: text });
const toast = (page: Page) => page.getByRole("status").filter({ hasText: "Page torn out" });

/** Opens the index column: at 390 px it sits behind the 'Pages' disclosure (N9), wider it is always shown. */
async function openIndex(page: Page) {
  const toggle = index(page).getByRole("button", { name: /^Pages/ });
  await expect(index(page)).toBeVisible();
  if (await toggle.isVisible()) {
    // Retried: a click that lands before hydration does nothing.
    await expect(async () => {
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
    }).toPass();
  }
  return index(page);
}

async function openOwnPage(page: Page, title: string | RegExp) {
  const nav = (await openIndex(page)).getByRole("navigation", { name: "Your pages" });
  await nav.getByRole("button", { name: typeof title === "string" ? new RegExp(`^${title}`) : title }).click();
  await expect(ownPaper(page).getByLabel("Page title")).toHaveValue(typeof title === "string" ? title : /.*/);
}

async function openTab(page: Page, name: "Shared by players" | "Shared by GM") {
  const shared = (await openIndex(page)).getByRole("region", { name: "Shared" });
  const tab = shared.getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return shared.getByRole("tabpanel");
}

function sharedRow(panel: Locator, title: string, owner?: string): Locator {
  const scope = owner ? panel.getByRole("group", { name: owner }) : panel;
  return scope.getByRole("button").filter({ hasText: title });
}

async function write(page: Page, line: string) {
  const input = paperColumn(page).getByRole("textbox", { name: "New entry" });
  await input.fill(line);
  await input.press("Enter");
  await expect(input).toHaveText("");
}

async function share(page: Page, option: RegExp, chosen: string[] = []) {
  await ownPaper(page).getByRole("button", { name: /^Sharing: / }).click();
  const dialog = page.getByRole("dialog", { name: "Share this page" });
  await dialog.getByRole("radio", { name: option }).check();
  for (const name of chosen) await dialog.getByRole("checkbox", { name }).check();
  return dialog;
}

/** `owner/title` of every row the caller sees in a Shared tab, sorted. */
async function sharedTitles(seat: Seat, campaignId: Id<"campaigns">, tab: "players" | "gm") {
  return (await seat.client.query(api.notesSharing.shared, { campaignId, tab })).map((r) => `${r.ownerName}/${r.title}`).sort();
}

async function entryLines(seat: Seat, campaignId: Id<"campaigns">, page: Id<"journalPages">) {
  return (await seat.client.query(api.notesEntries.entries, { campaignId, page })).entries.map((e) => `${e.text}|${e.authorLabel}|${e.state}`);
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return ((error as { data?: { code?: string } }).data?.code ?? String(error)) as string;
  }
}

async function journalPageId(seat: Seat, campaignId: Id<"campaigns">, title: string) {
  const view = await seat.client.query(api.notes.journal, { campaignId });
  return view.journal === null ? null : (view.pages.find((p) => p.title === title)?._id ?? null);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}`, () => {
    test.use({ viewport });

    test("the GM and two players keep their journals and see exactly what the rules allow", async ({ page, browser }) => {
      test.setTimeout(420_000);
      const campaign = await gmCreatesCampaign(page);
      const { campaignId } = campaign;
      const gm: Seat = { page, client: await convexAs(page) };
      const uuid = () => crypto.randomUUID();
      await gm.client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: uuid() });
      const { sessionId: two } = await gm.client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: uuid() });
      await gm.client.mutation(api.sessionRecords.setDate, { campaignId, sessionId: two, date: "2026-10-24" });
      await gm.client.mutation(api.sessions.start, { campaignId, sessionId: two, idempotencyKey: uuid() });
      const code = await gm.client.mutation(api.members.rotateJoinCode, { campaignId });
      const a = await playerJoins(browser, viewport, PLAYER_A, code, campaign, "Ash");
      const b = await playerJoins(browser, viewport, PLAYER_B, code, campaign, "Bram");
      const A = a.seat;
      const B = b.seat;
      const gmTab2 = await page.context().newPage();
      try {
        // ---- 1. The GM: a session log linked to the live session (Q5, D6).
        await gm.page.goto(`/campaigns/${campaignId}/notes`);
        await expect(gm.page.getByRole("heading", { level: 1, name: "Game Master’s Journal" })).toBeVisible();
        if (viewport.width < 640) {
          // The whole index column (search, pages, Shared, journals, bin, Quick keys) is behind the disclosure.
          await expect(index(gm.page).getByRole("searchbox")).toBeHidden();
          await expect(index(gm.page).getByText("Quick keys")).toBeHidden();
          await expect(index(gm.page).getByRole("region", { name: "Shared" })).toBeHidden();
          await expect(index(gm.page).getByRole("button", { name: /^Pages · Session 1/ })).toBeVisible();
        }
        const logs = (await openIndex(gm.page)).getByRole("navigation", { name: "Your pages" }).getByRole("group", { name: "Session logs" });
        await logs.getByRole("button", { name: "New session log" }).click();
        const picker = gm.page.getByRole("dialog", { name: "New session log" });
        await expect(picker.getByRole("radio", { name: /^Session 2/ })).toBeChecked();
        await picker.getByRole("button", { name: "Add the page" }).click();
        await expect(picker).toBeHidden();
        await expect(ownPaper(gm.page).getByLabel("Page title")).toHaveValue("Session 2");
        await expect(ownPaper(gm.page).getByText(/^session log · .*24.*2026$/)).toBeVisible();
        if (viewport.width < 640) await expect(index(gm.page).getByRole("region", { name: "Shared" })).toBeHidden();
        const log = (await journalPageId(gm, campaignId, "Session 2"))!;
        expect(log).not.toBeNull();

        // Writes; a second tab of the same account follows live.
        await gmTab2.setViewportSize(viewport);
        await gmTab2.goto(`/campaigns/${campaignId}/notes?page=${log}`);
        await expect(ownPaper(gmTab2).getByLabel("Page title")).toHaveValue("Session 2");
        await write(gm.page, "* bribe the ferryman");
        await write(gm.page, "- the toll is two silver");
        await expect(rowOf(gmTab2, "bribe the ferryman")).toBeVisible();
        await expect(rowOf(gmTab2, "the toll is two silver")).toBeVisible();

        // Migrate the open task: no later log page, so a new one opens; the original is marked >.
        await gm.page.getByRole("button", { name: "➜ Migrate open tasks" }).click();
        await expect(ownPaper(gm.page).getByLabel("Page title")).toHaveValue("Session 3");
        await expect(rowOf(gm.page, "bribe the ferryman").getByRole("button", { name: "Task: open. Click to change." })).toBeVisible();
        await expect.poll(() => entryLines(gm, campaignId, log)).toEqual(["bribe the ferryman|GM|migrated", "the toll is two silver|GM|open"]);
        await expect(rowOf(gmTab2, "bribe the ferryman").getByRole("button", { name: "Task: migrated. Click to change." })).toBeVisible();

        // Share the log with everyone and 'Rumors & hooks' with A only.
        await openOwnPage(gm.page, "Session 2");
        let dialog = await share(gm.page, /^Everyone/);
        await expect.poll(() => gm.client.query(api.notes.journal, { campaignId }).then((v) => v.journal !== null && v.pages.find((p) => p._id === log)?.visibility)).toBe("everyone");
        await dialog.getByRole("button", { name: "Done" }).click();
        await openOwnPage(gm.page, "Rumors & hooks");
        await write(gm.page, "! the mill hides a cellar");
        dialog = await share(gm.page, /Chosen players/, ["Ash"]);
        await expect(dialog.getByRole("checkbox", { name: "Bram" })).not.toBeChecked();
        await expect.poll(() => sharedTitles(A, campaignId, "gm")).toEqual(["Game Master/Rumors & hooks", "Game Master/Session 2"]);
        await dialog.getByRole("button", { name: "Done" }).click();
        await expect(ownPaper(gm.page).getByRole("button", { name: "Sharing: Chosen players · Ash" })).toBeVisible();
        await expect.poll(() => sharedTitles(B, campaignId, "gm")).toEqual(["Game Master/Session 2"]);

        // ---- 2. A writes in Ash's journal and adds to the GM's 'everyone' page: ' - Ash'.
        await A.page.goto(`/campaigns/${campaignId}/notes`);
        await expect(A.page.getByRole("heading", { level: 1, name: "Ash’s Journal" })).toBeVisible();
        await write(A.page, "o we crossed the river");
        let panel = await openTab(A.page, "Shared by GM");
        await expect(sharedRow(panel, "Rumors & hooks")).toBeVisible();
        await sharedRow(panel, "Session 2").click();
        await expect(paperColumn(A.page).getByText("Game Master’s page · read only")).toBeVisible();
        await expect(rowOf(A.page, "the toll is two silver")).toBeVisible();
        await write(A.page, "the ferryman lied");
        await expect(paperColumn(A.page).getByText("the ferryman lied - Ash")).toBeVisible();
        if (viewport.width < 640) await expectNoHorizontalScroll(A.page);

        // A's 'Clues & secrets': players only (B reads it, the GM does not).
        await openOwnPage(A.page, "Clues & secrets");
        await write(A.page, "- the seal is forged");
        dialog = await share(A.page, /Players only/);
        await expect.poll(() => sharedTitles(B, campaignId, "players")).toEqual(["Ash/Clues & secrets"]);
        await dialog.getByRole("button", { name: "Done" }).click();

        // ---- B: sees the GM's 'everyone' page only, adds to it (' - Bram'), writes in Bram's journal.
        await B.page.goto(`/campaigns/${campaignId}/notes`);
        await expect(B.page.getByRole("heading", { level: 1, name: "Bram’s Journal" })).toBeVisible();
        panel = await openTab(B.page, "Shared by GM");
        await expect(panel.getByRole("button")).toHaveCount(1);
        await sharedRow(panel, "Session 2").click();
        await expect(paperColumn(B.page).getByText("the ferryman lied - Ash")).toBeVisible();
        await write(B.page, "* follow him at dusk");
        await expect(paperColumn(B.page).getByText("follow him at dusk - Bram")).toBeVisible();
        await expect.poll(() => entryLines(gm, campaignId, log)).toEqual([
          "bribe the ferryman|GM|migrated",
          "the toll is two silver|GM|open",
          "the ferryman lied|Ash|open",
          "follow him at dusk|Bram|open",
        ]);
        await openOwnPage(gm.page, "Session 2");
        await expect(ownPaper(gm.page).getByText("the ferryman lied - Ash")).toBeVisible();
        await expect(ownPaper(gm.page).getByText("follow him at dusk - Bram")).toBeVisible();

        await B.page.goto(`/campaigns/${campaignId}/notes`);
        await write(B.page, "o lost my map");
        await openOwnPage(B.page, "My goals");
        await write(B.page, "* find my sister");
        dialog = await share(B.page, /Private · hidden from everyone/);
        await expect.poll(() => B.client.query(api.notes.journal, { campaignId }).then((v) => v.journal !== null && v.pages.find((p) => p.title === "My goals")?.visibility)).toBe("private");
        await dialog.getByRole("button", { name: "Done" }).click();

        // Exactly the allowed pages in every browser (server lists, then the GM's and A's tabs in the UI).
        await expect.poll(() => sharedTitles(gm, campaignId, "players")).toEqual([
          "Ash/My goals",
          "Ash/People we met",
          "Ash/Session 1",
          "Bram/Clues & secrets",
          "Bram/People we met",
          "Bram/Session 1",
        ]);
        expect(await sharedTitles(gm, campaignId, "gm")).toEqual(["Game Master/Rumors & hooks", "Game Master/Session 2"]);
        expect(await sharedTitles(A, campaignId, "players")).toEqual([]);
        expect(await sharedTitles(B, campaignId, "players")).toEqual(["Ash/Clues & secrets"]);
        panel = await openTab(gm.page, "Shared by players");
        await expect(sharedRow(panel, "Session 1", "Bram")).toBeVisible();
        await expect(sharedRow(panel, "My goals", "Bram")).toHaveCount(0);
        await expect(sharedRow(panel, "Clues & secrets", "Ash")).toHaveCount(0);
        await sharedRow(panel, "Session 1", "Bram").click();
        await expect(paperColumn(gm.page).getByText("lost my map")).toBeVisible();
        panel = await openTab(A.page, "Shared by players");
        await expect(panel).toHaveText("Nothing shared yet.");
        const myGoals = (await journalPageId(B, campaignId, "My goals"))!;
        expect(await codeOf(gm.client.query(api.notesEntries.entries, { campaignId, page: myGoals }))).toBe("NOTE_PAGE_NOT_FOUND");
        expect(await codeOf(A.client.query(api.notesEntries.entries, { campaignId, page: myGoals }))).toBe("NOTE_PAGE_NOT_FOUND");

        // ---- 3. The GM tears out the 'everyone' page: both readers lose it; Undo brings it back.
        panel = await openTab(A.page, "Shared by GM");
        await sharedRow(panel, "Session 2").click();
        await expect(paperColumn(A.page).getByText("follow him at dusk - Bram")).toBeVisible();
        await openOwnPage(gm.page, "Session 2");
        await ownPaper(gm.page).getByRole("button", { name: "Tear out page" }).click();
        await ownPaper(gm.page).getByRole("button", { name: "Click again to tear out" }).click();
        await expect(toast(gm.page).getByRole("button", { name: "Undo" })).toBeVisible();
        await expect.poll(() => sharedTitles(B, campaignId, "gm")).toEqual([]);
        await expect(paperColumn(A.page).getByText("This page isn't shared with you.")).toBeVisible();
        await toast(gm.page).getByRole("button", { name: "Undo" }).click();
        await expect(ownPaper(gm.page).getByLabel("Page title")).toHaveValue("Session 2");
        await expect.poll(() => sharedTitles(B, campaignId, "gm")).toEqual(["Game Master/Session 2"]);
        expect(await sharedTitles(A, campaignId, "gm")).toEqual(["Game Master/Rumors & hooks", "Game Master/Session 2"]);
        expect(await entryLines(B, campaignId, log)).toHaveLength(4);
        panel = await openTab(A.page, "Shared by GM");
        await sharedRow(panel, "Session 2").click();
        await expect(paperColumn(A.page).getByText("follow him at dusk - Bram")).toBeVisible();

        // ---- 4. Bram retires: his non-private pages are Past journals for everyone; 'My goals' stays private.
        await gm.client.mutation(api.characters.setStatus, { characterId: b.characterId, status: "retired" });
        await expect
          .poll(async () => (await A.client.query(api.notesJournals.pastJournals, { campaignId })).map((r) => [r.name, r.pageCount]))
          .toEqual([["Bram’s journal", 3]]);
        expect((await gm.client.query(api.notesJournals.pastJournals, { campaignId })).map((r) => [r.name, r.pageCount])).toEqual([["Bram’s journal", 3]]);
        expect(await sharedTitles(gm, campaignId, "players")).toEqual(["Ash/My goals", "Ash/People we met", "Ash/Session 1"]);
        for (const seat of [A, gm]) {
          const past = (await openIndex(seat.page)).getByRole("region", { name: "Past journals" });
          await past.getByRole("button", { name: /^Bram’s journal/ }).click();
          await expect(paperColumn(seat.page).getByText("Past journal · read only")).toBeVisible();
          const strip = paperColumn(seat.page).getByRole("navigation", { name: "Pages of Bram’s Journal" });
          await expect(strip.getByRole("button")).toHaveCount(3);
          await expect(strip.getByRole("button", { name: /^My goals/ })).toHaveCount(0);
          await strip.getByRole("button", { name: /^Session 1/ }).click();
          await expect(paperColumn(seat.page).getByText("lost my map")).toBeVisible();
          await expect(paperColumn(seat.page).getByRole("textbox", { name: "New entry" })).toHaveCount(0);
          if (viewport.width < 640) await expectNoHorizontalScroll(seat.page);
        }
        await expect(paperColumn(gm.page).getByRole("button", { name: "Tear out page" })).toBeVisible();
        await expect(paperColumn(A.page).getByRole("button", { name: "Tear out page" })).toHaveCount(0);
        expect(await codeOf(A.client.query(api.notesEntries.entries, { campaignId, page: myGoals }))).toBe("NOTE_PAGE_NOT_FOUND");
        // B's added entry on the GM's page stays; the GM's page itself is not affected by Bram's departure.
        expect(await entryLines(A, campaignId, log)).toContain("follow him at dusk|Bram|open");
      } finally {
        await gmTab2.close();
        await a.close();
        await b.close();
      }
    });
  });
}

// dcm-bxp.106: the add and edit fields are a rich editor; a mention is a name chip while writing and editing, and the
// stored text keeps the '@[name](id)' token.
test("mentions are name chips while writing and editing; the server stores the token", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const gm = await convexAs(page);
  const { entryId: npc } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.codex.update, { entryId: npc, patch: { name: "Marlow", role: "Ferryman" } });
  await page.goto(`/campaigns/${campaignId}/notes?page=template-0`);

  const input = paperColumn(page).getByRole("textbox", { name: "New entry" });
  await input.click();
  await input.pressSequentially("* ask @mar");
  const listbox = paperColumn(page).getByRole("listbox", { name: "Characters & Locations" });
  await expect(listbox.getByRole("option", { name: /Marlow/ })).toHaveAttribute("aria-selected", "true");
  await input.press("Enter");
  await expect(listbox).toHaveCount(0);
  await expect(input.locator(".bj-mi-chip")).toHaveText(["Marlow"]);
  await expect(input).not.toContainText("@[");
  await input.pressSequentially("about the toll");
  await expect(input).toHaveText(/^\* ask Marlow\s+about the toll$/);
  await input.press("Enter");
  await expect(input).toHaveText("");
  const stored = async () => (await gm.query(api.notesEntries.entries, { campaignId, page: { template: 0 } })).entries.map((e) => e.text);
  await expect.poll(stored).toEqual([`ask @[Marlow](${npc}) about the toll`]);

  // Backspace removes a chip whole.
  await input.pressSequentially("@mar");
  await input.press("Enter");
  await expect(input.locator(".bj-mi-chip")).toHaveCount(1);
  await input.press("Backspace");
  await input.press("Backspace");
  await expect(input.locator(".bj-mi-chip")).toHaveCount(0);

  // Editing shows the chip again, never the token; the edit keeps the token.
  await rowOf(page, "about the toll").getByText("about the toll").dblclick();
  const edit = paperColumn(page).getByRole("textbox", { name: "Edit entry" });
  await expect(edit).toBeFocused();
  await expect(edit.locator(".bj-mi-chip")).toHaveText(["Marlow"]);
  await expect(edit).not.toContainText("@[");
  await edit.press("End");
  await edit.pressSequentially(" today");
  await edit.press("Enter");
  await expect(rowOf(page, "today").getByRole("link", { name: "Marlow" })).toBeVisible();
  await expect.poll(stored).toEqual([`ask @[Marlow](${npc}) about the toll today`]);
});
