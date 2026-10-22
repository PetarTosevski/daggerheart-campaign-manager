import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll } from "./visual/helpers";

// D11 N8: other people's journals (.omc/plans/d11-notes.yaml). Three browsers: the GM and players A ('Ash') and B
// ('Bram'). A writes a 'players' page and a 'private' page (seeded through Convex; writing and sharing are N2 / N6):
// the GM opens Ash's journal and sees neither. The GM retires Ash: everyone finds the 'players' page under Past
// journals and nobody but A the private one; the GM tears it out; Ash is active again and the remaining pages return
// with their visibility (and B, a player, may no longer open the present journal by URL: dcm-bxp.109). Then the same
// for a death, and for a removal followed by a rejoin. Every change is confirmed
// on the server (expect.poll through a Convex client) before another browser checks it. Runs at 1440 and 390.

const PLAYER_A = "e2e-player@example.test";
// The e2e allowlist (scripts/e2e-setup.mjs) has two non-GM accounts; N6 uses this one as player B too.
const PLAYER_B = "e2e-player2@example.test";

type Seat = { page: Page; client: ConvexHttpClient };
type Campaign = { name: string; campaignId: Id<"campaigns"> };

async function gmCreatesCampaign(page: Page): Promise<Campaign> {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Journals ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2] as Id<"campaigns"> };
}

/** A player in their own browser context joins with the code and gets a character (seeded through Convex). */
async function playerJoins(browser: Browser, viewport: { width: number; height: number }, email: string, code: string, campaign: Campaign, hero: string) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signInAsTestGm(page, email);
  await expect(page).toHaveURL("/");
  await page.goto(`/join/${code}`);
  await page.getByRole("button", { name: "Join campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name: campaign.name })).toBeVisible();
  const client = await convexAs(page);
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId: campaign.campaignId,
    draft: bardDraft(hero),
    idempotencyKey: crypto.randomUUID(),
  });
  return { seat: { page, client } satisfies Seat, characterId, close: () => context.close() };
}

const index = (page: Page) => page.getByRole("complementary", { name: "Journal index" });
const playersList = (page: Page) => index(page).getByRole("region", { name: "Players’ journals" });
const pastList = (page: Page) => index(page).getByRole("region", { name: "Past journals" });
const paperColumn = (page: Page) => page.getByRole("region", { name: "Journal page" });
const strip = (page: Page) => paperColumn(page).getByRole("navigation", { name: "Pages of Ash’s Journal" });

/** The titles in the journal view's page strip. */
async function expectStrip(page: Page, titles: string[]) {
  await expect(strip(page).getByRole("button")).toHaveCount(titles.length);
  for (const title of titles) await expect(strip(page).getByRole("button", { name: new RegExp(`^${title}`) })).toBeVisible();
}

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

/** Opens Ash's past journal from the index. */
async function openPast(page: Page) {
  await page.goto(page.url().split("?")[0]!);
  await openIndex(page);
  await pastList(page).getByRole("button", { name: /^Ash’s journal/ }).click();
  await expect(page).toHaveURL(/view=journal&journal=/);
  await expect(paperColumn(page).getByText("Past journal · read only")).toBeVisible();
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}`, () => {
    test.use({ viewport });

    test("the GM reads Ash's journal; retirement, death and removal make it a past journal; return and rejoin restore it", async ({ page, browser }) => {
      test.setTimeout(360_000);
      const campaign = await gmCreatesCampaign(page);
      const { campaignId } = campaign;
      const gm: Seat = { page, client: await convexAs(page) };
      const code = await gm.client.mutation(api.members.rotateJoinCode, { campaignId });
      const a = await playerJoins(browser, viewport, PLAYER_A, code, campaign, "Ash");
      const b = await playerJoins(browser, viewport, PLAYER_B, code, campaign, "Bram");
      const A = a.seat;
      const B = b.seat;
      const notesUrl = `/campaigns/${campaignId}/notes`;
      const setStatus = (status: "active" | "dead" | "retired") => gm.client.mutation(api.characters.setStatus, { characterId: a.characterId, status });
      const pastNames = async (seat: Seat) => (await seat.client.query(api.notesJournals.pastJournals, { campaignId })).map((r) => [r.name, r.pageCount]);
      try {
        // ---- A writes: 'Session 1' (default: the GM reads it), a 'players' page and a 'private' page.
        const write = async (template: number, text: string) =>
          (await A.client.mutation(api.notesEntries.add, { campaignId, page: { template }, kind: "note", text })).pageId;
        const session = await write(0, "met the ferryman");
        const secrets = await write(1, "the ring is a fake");
        const trueName = await write(2, "my name is Ashra");
        await A.client.mutation(api.notes.renamePage, { campaignId, page: secrets, title: "Party secrets" });
        await A.client.mutation(api.notesSharing.setVisibility, { campaignId, page: secrets, visibility: "players" });
        await A.client.mutation(api.notes.renamePage, { campaignId, page: trueName, title: "True name" });
        await A.client.mutation(api.notesSharing.setVisibility, { campaignId, page: trueName, visibility: "private" });

        // ---- The GM opens Ash's journal: neither page is there; the GM adds to 'Session 1' (Q3).
        await gm.page.goto(notesUrl);
        await openIndex(gm.page);
        await expect(playersList(gm.page).getByRole("button", { name: /^Ash/ })).toContainText("Player journal · Bard · 2 pages");
        await playersList(gm.page).getByRole("button", { name: /^Ash/ }).click();
        await expect(gm.page).toHaveURL(/view=journal&journal=/);
        await expect(paperColumn(gm.page).getByRole("heading", { level: 2, name: "Ash’s Journal" })).toBeVisible();
        await expect(paperColumn(gm.page).getByText("read only", { exact: true })).toBeVisible();
        await expectStrip(gm.page, ["Session 1", "My goals"]);
        await expect(paperColumn(gm.page).getByText("met the ferryman")).toBeVisible();
        const input = paperColumn(gm.page).getByRole("textbox", { name: "New entry" });
        await input.fill("the ferryman lies");
        await input.press("Enter");
        await expect(paperColumn(gm.page).getByText("the ferryman lies - GM")).toBeVisible();
        await expect
          .poll(async () => (await A.client.query(api.notesEntries.entries, { campaignId, page: session })).entries.map((e) => e.text))
          .toEqual(["met the ferryman", "the ferryman lies"]);
        await expect(paperColumn(gm.page).getByRole("button", { name: "Tear out page" })).toHaveCount(0);
        if (viewport.width < 640) await expectNoHorizontalScroll(gm.page);
        // Players get no 'Players’ journals' list (Q2).
        await B.page.goto(notesUrl);
        await openIndex(B.page);
        await expect(pastList(B.page)).toContainText("No past journals.");
        await expect(playersList(B.page)).toHaveCount(0);

        // ---- Retired: everyone finds 'Party secrets' under Past journals; 'True name' only A.
        await setStatus("retired");
        await expect.poll(() => pastNames(B)).toEqual([["Ash’s journal", 3]]);
        await gm.page.goto(notesUrl);
        await openIndex(gm.page);
        await expect(playersList(gm.page)).toContainText("No player has written yet.");
        await openPast(gm.page);
        await expectStrip(gm.page, ["Session 1", "Party secrets", "My goals"]);
        await expect(paperColumn(gm.page).getByRole("textbox", { name: "New entry" })).toHaveCount(0);
        await openPast(B.page);
        await expectStrip(B.page, ["Session 1", "Party secrets", "My goals"]);
        await strip(B.page).getByRole("button", { name: /^Party secrets/ }).click();
        await expect(paperColumn(B.page).getByText("the ring is a fake")).toBeVisible();
        await expect(paperColumn(B.page).getByRole("textbox", { name: "New entry" })).toHaveCount(0);
        await expect(paperColumn(B.page).getByRole("button", { name: "Tear out page" })).toHaveCount(0);
        if (viewport.width < 640) await expectNoHorizontalScroll(B.page);
        await A.page.goto(notesUrl);
        await openIndex(A.page);
        await openPast(A.page);
        await expectStrip(A.page, ["Session 1", "Party secrets", "True name", "My goals"]);

        // ---- The GM tears 'Party secrets' out of the past journal (D2).
        await strip(gm.page).getByRole("button", { name: /^Party secrets/ }).click();
        await expect(paperColumn(gm.page).getByText("the ring is a fake")).toBeVisible();
        await paperColumn(gm.page).getByRole("button", { name: "Tear out page" }).click();
        await paperColumn(gm.page).getByRole("button", { name: "Click again to tear out" }).click();
        await expect.poll(() => pastNames(B)).toEqual([["Ash’s journal", 2]]);
        await expectStrip(gm.page, ["Session 1", "My goals"]);
        await openIndex(gm.page);
        await expect(index(gm.page).getByRole("region", { name: "Torn-out pages" })).toContainText("from Ash’s journal");
        await expectStrip(B.page, ["Session 1", "My goals"]);

        // ---- Active again: the remaining pages are back in A's journal with their visibility.
        await setStatus("active");
        await expect.poll(() => pastNames(B)).toEqual([]);
        await expect
          .poll(async () => {
            const view = await A.client.query(api.notes.journal, { campaignId });
            return "pages" in view ? view.pages.map((p) => [p.title, p.visibility]) : [];
          })
          .toEqual([
            ["Session 1", "gm"],
            ["True name", "private"],
            ["My goals", "gm"],
          ]);
        await gm.page.goto(notesUrl);
        await openIndex(gm.page);
        await expect(pastList(gm.page)).toContainText("No past journals.");
        await playersList(gm.page).getByRole("button", { name: /^Ash/ }).click();
        await expectStrip(gm.page, ["Session 1", "My goals"]);
        await expect(paperColumn(gm.page).getByRole("textbox", { name: "New entry" })).toBeVisible();
        await B.page.goto(notesUrl);
        await openIndex(B.page);
        await expect(pastList(B.page)).toContainText("No past journals.");

        // ---- Dead, then active: the same cycle.
        await setStatus("dead");
        await expect.poll(() => pastNames(gm)).toEqual([["Ash’s journal", 2]]);
        await openPast(B.page);
        await expectStrip(B.page, ["Session 1", "My goals"]);
        await setStatus("active");
        await expect.poll(() => pastNames(B)).toEqual([]);
        // dcm-bxp.109: Ash's journal is present again, so B (a player) may no longer open it; the URL is refused.
        await expect(paperColumn(B.page).getByRole("alert")).toContainText("The journal failed to load");
        await B.page.reload();
        await expect(paperColumn(B.page).getByRole("alert")).toContainText("The journal failed to load");
        await expect(paperColumn(B.page).getByText("met the ferryman")).toHaveCount(0);

        // ---- Removed: a past journal for those who stay, nothing for A; the rejoin restores it.
        const members = await gm.client.query(api.notesSharing.recipients, { campaignId, page: { template: 0 } });
        const ashUser = members.find((m) => m.name === "Ash")!.userId;
        await gm.client.mutation(api.members.removePlayer, { campaignId, userId: ashUser });
        await expect.poll(() => pastNames(B)).toEqual([["Ash’s journal", 2]]);
        await expect.poll(() => A.client.query(api.notesJournals.pastJournals, { campaignId }).then(() => "ok", () => "refused")).toBe("refused");
        await gm.page.goto(notesUrl);
        await openIndex(gm.page);
        await openPast(gm.page);
        await expectStrip(gm.page, ["Session 1", "My goals"]);
        const fresh = await gm.client.mutation(api.members.rotateJoinCode, { campaignId });
        await A.client.mutation(api.members.joinByCode, { code: fresh });
        await expect.poll(() => pastNames(gm)).toEqual([]);
        await expect(paperColumn(gm.page).getByText("read only", { exact: true })).toBeVisible();
        await expect(paperColumn(gm.page).getByRole("textbox", { name: "New entry" })).toBeVisible();
        await gm.page.goto(notesUrl);
        await openIndex(gm.page);
        await expect(playersList(gm.page).getByRole("button", { name: /^Ash/ })).toContainText("2 pages");
      } finally {
        await a.close();
        await b.close();
      }
    });
  });
}
