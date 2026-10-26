import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll } from "./visual/helpers";

// D11 N6: sharing (.omc/plans/d11-notes.yaml). Three browsers: the GM and players A ('Ash') and B ('Bram'). The GM
// shares a page with A only (A sees it, B does not), then with everyone (B sees it). A writes a page: the GM finds it
// under 'Shared by players' and adds an entry ending ' - GM'; A hides it from everyone (the GM loses it), sets it to
// 'Players only' (B sees it, the GM does not), and shares another page with chosen B only. Every optimistic change is
// confirmed on the server (expect.poll through a Convex client) before another browser checks it. Runs at 1440 and 390.

const PLAYER_A = "e2e-player@example.test";
// The e2e allowlist (scripts/e2e-setup.mjs) has two non-GM accounts; notes-shell.spec.ts also signs this one in by the test form.
const PLAYER_B = "e2e-player2@example.test";

type Seat = { page: Page; client: ConvexHttpClient };

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Sharing ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2] as Id<"campaigns"> };
}

async function joinCode(gm: Page) {
  await gm.getByRole("button", { name: "Players" }).click();
  const dialog = gm.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();
  return code;
}

/** A player in their own browser context joins with the code and gets a character (seeded through Convex). */
async function playerJoins(browser: Browser, viewport: { width: number; height: number }, email: string, code: string, campaign: { name: string; campaignId: Id<"campaigns"> }, hero: string) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signInAsTestGm(page, email);
  await expect(page).toHaveURL("/");
  await page.goto(`/join/${code}`);
  await page.getByRole("button", { name: "Join campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name: campaign.name })).toBeVisible();
  const client = await convexAs(page);
  await client.mutation(api.characters.create, { campaignId: campaign.campaignId, draft: bardDraft(hero), idempotencyKey: crypto.randomUUID() });
  return { seat: { page, client } satisfies Seat, close: () => context.close() };
}

const index = (page: Page) => page.getByRole("complementary", { name: "Journal index" });
const sharedBlock = (page: Page) => index(page).getByRole("region", { name: "Shared" });
const paper = (page: Page) => page.getByRole("region", { name: "Journal page" });

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

async function openTab(page: Page, name: "Shared by players" | "Shared by GM") {
  await openIndex(page);
  const tab = sharedBlock(page).getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return sharedBlock(page).getByRole("tabpanel");
}

/** The Shared row for a page title (inside an owner's group when given). */
function sharedRow(panel: Locator, title: string, owner?: string): Locator {
  const scope = owner ? panel.getByRole("group", { name: owner }) : panel;
  return scope.getByRole("button").filter({ hasText: title });
}

async function openSharing(page: Page) {
  await paper(page).getByRole("button", { name: /^Sharing: / }).click();
  const dialog = page.getByRole("dialog", { name: "Share this page" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function write(page: Page, line: string) {
  const input = paper(page).getByRole("textbox", { name: "New entry" });
  await input.fill(line);
  await input.press("Enter");
  await expect(input).toHaveText("");
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}`, () => {
    test.use({ viewport });

    test("the GM shares with A, then everyone; A shares with the GM, hides, goes players-only and chooses B", async ({ page, browser }) => {
      test.setTimeout(240_000);
      const campaign = await gmCreatesCampaign(page);
      const { campaignId } = campaign;
      const gm: Seat = { page, client: await convexAs(page) };
      const code = await joinCode(page);
      const a = await playerJoins(browser, viewport, PLAYER_A, code, campaign, "Ash");
      const b = await playerJoins(browser, viewport, PLAYER_B, code, campaign, "Bram");
      const A = a.seat;
      const B = b.seat;
      try {
        // ---- The GM shares their first page with A only.
        await gm.page.goto(`/campaigns/${campaignId}/notes`);
        await expect(paper(gm.page).getByRole("button", { name: "Sharing: Private" })).toBeVisible();
        let dialog = await openSharing(gm.page);
        await expect(dialog.getByRole("radio")).toHaveCount(3);
        await dialog.getByRole("radio", { name: /Chosen players/ }).check();
        await expect(dialog.getByRole("group", { name: "Chosen players" })).toBeVisible();
        await dialog.getByRole("checkbox", { name: "Ash" }).check();
        await expect(dialog.getByRole("checkbox", { name: "Ash" })).toBeChecked();
        await expect(dialog.getByRole("checkbox", { name: "Bram" })).not.toBeChecked();
        await expect
          .poll(async () => (await gm.client.query(api.notesSharing.recipients, { campaignId, page: { template: 0 } })).filter((r) => r.chosen).map((r) => r.name))
          .toEqual(["Ash"]);
        await dialog.getByRole("button", { name: "Done" }).click();
        await expect(paper(gm.page).getByRole("button", { name: "Sharing: Chosen players · Ash" })).toBeVisible();

        await A.page.goto(`/campaigns/${campaignId}/notes`);
        let panel = await openTab(A.page, "Shared by GM");
        await sharedRow(panel, "Session 1").click();
        await expect(A.page).toHaveURL(/view=shared-gm/);
        await expect(paper(A.page).getByText("Game Master’s page · read only")).toBeVisible();
        await expect(paper(A.page).getByRole("textbox", { name: "New entry" })).toBeVisible();
        if (viewport.width < 640) await expectNoHorizontalScroll(A.page);

        await B.page.goto(`/campaigns/${campaignId}/notes`);
        panel = await openTab(B.page, "Shared by GM");
        await expect(panel).toHaveText("Nothing shared yet.");

        // ---- Then with everyone: B sees it at once.
        dialog = await openSharing(gm.page);
        await dialog.getByRole("radio", { name: /^Everyone/ }).check();
        await expect.poll(async () => (await gm.client.query(api.notes.journal, { campaignId })).journal !== null).toBe(true);
        await expect
          .poll(async () => (await B.client.query(api.notesSharing.shared, { campaignId, tab: "gm" })).map((r) => r.title))
          .toEqual(["Session 1"]);
        await dialog.getByRole("button", { name: "Done" }).click();
        await expect(sharedRow(panel, "Session 1")).toBeVisible();

        // ---- Player A writes a page; the GM finds it under 'Shared by players' and adds an entry.
        await A.page.goto(`/campaigns/${campaignId}/notes`);
        await write(A.page, "found a brass key");
        const firstPage = async () => {
          const view = await A.client.query(api.notes.journal, { campaignId });
          return view.journal === null ? null : (view.pages[0]?._id ?? null);
        };
        await expect.poll(firstPage).not.toBeNull();
        const aPage = (await firstPage())!;
        await expect
          .poll(async () => (await A.client.query(api.notesEntries.entries, { campaignId, page: aPage })).entries.map((e) => e.text))
          .toEqual(["found a brass key"]);

        await gm.page.goto(`/campaigns/${campaignId}/notes`);
        panel = await openTab(gm.page, "Shared by players");
        await sharedRow(panel, "Session 1", "Ash").click();
        await expect(gm.page).toHaveURL(/view=shared-players/);
        await expect(paper(gm.page).getByText("Ash’s page · read only")).toBeVisible();
        await expect(paper(gm.page).getByText("found a brass key")).toBeVisible();
        await write(gm.page, "the key is cursed");
        await expect(paper(gm.page).getByText("the key is cursed - GM")).toBeVisible();
        await expect
          .poll(async () => (await A.client.query(api.notesEntries.entries, { campaignId, page: aPage })).entries.map((e) => [e.text, e.authorLabel]))
          .toEqual([
            ["found a brass key", "Ash"],
            ["the key is cursed", "GM"],
          ]);
        await expect(paper(A.page).getByText("the key is cursed - GM")).toBeVisible();

        // ---- A hides it from everyone: the GM loses it.
        dialog = await openSharing(A.page);
        await expect(dialog.getByRole("radio")).toHaveCount(5);
        await expect(dialog.getByRole("radio", { name: /Private · GM can read/ })).toBeChecked();
        await dialog.getByRole("radio", { name: /Private · hidden from everyone/ }).check();
        await expect
          .poll(async () => (await gm.client.query(api.notesSharing.shared, { campaignId, tab: "players" })).some((r) => r.pageId === aPage))
          .toBe(false);
        await dialog.getByRole("button", { name: "Done" }).click();
        await expect(paper(A.page).getByRole("button", { name: "Sharing: Private · hidden from everyone" })).toBeVisible();
        await expect(paper(gm.page).getByText("This page isn't shared with you.")).toBeVisible();
        await expect(sharedRow(panel, "Session 1", "Ash")).toHaveCount(0);

        // ---- 'Players only': B sees it, the GM does not.
        dialog = await openSharing(A.page);
        await dialog.getByRole("radio", { name: /Players only/ }).check();
        await expect
          .poll(async () => (await B.client.query(api.notesSharing.shared, { campaignId, tab: "players" })).map((r) => r.pageId))
          .toEqual([aPage]);
        await dialog.getByRole("button", { name: "Done" }).click();
        panel = await openTab(B.page, "Shared by players");
        await expect(sharedRow(panel, "Session 1", "Ash")).toBeVisible();
        await sharedRow(panel, "Session 1", "Ash").click();
        await expect(paper(B.page).getByText("the key is cursed - GM")).toBeVisible();
        const gmPanel = await openTab(gm.page, "Shared by players");
        await expect(sharedRow(gmPanel, "Session 1", "Ash")).toHaveCount(0);

        // ---- A shares another page ('People we met') with chosen B only: B sees it, the GM loses it.
        await expect(sharedRow(gmPanel, "People we met", "Ash")).toBeVisible();
        await A.page.goto(`/campaigns/${campaignId}/notes`);
        await openIndex(A.page);
        await index(A.page).getByRole("navigation", { name: "Your pages" }).getByRole("button", { name: /People we met/ }).click();
        dialog = await openSharing(A.page);
        await dialog.getByRole("radio", { name: /Chosen players/ }).check();
        await expect(dialog.getByRole("checkbox")).toHaveCount(2);
        await expect(dialog.getByRole("checkbox", { name: "GM" })).not.toBeChecked();
        await dialog.getByRole("checkbox", { name: "Bram" }).check();
        await expect
          .poll(async () => (await B.client.query(api.notesSharing.shared, { campaignId, tab: "players" })).map((r) => r.title).sort())
          .toEqual(["People we met", "Session 1"]);
        await dialog.getByRole("button", { name: "Done" }).click();
        await expect(paper(A.page).getByRole("button", { name: "Sharing: Chosen players · Bram" })).toBeVisible();
        await openIndex(B.page);
        await expect(sharedRow(panel, "People we met", "Ash")).toBeVisible();
        await expect(sharedRow(gmPanel, "People we met", "Ash")).toHaveCount(0);
        await expect
          .poll(async () => (await gm.client.query(api.notesSharing.shared, { campaignId, tab: "players" })).map((r) => r.title).sort())
          .toEqual(["Clues & secrets", "My goals"]);
      } finally {
        await a.close();
        await b.close();
      }
    });
  });
}
