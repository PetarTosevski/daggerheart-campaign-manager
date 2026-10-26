import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll } from "./visual/helpers";

// D11 N7: the bin (.omc/plans/d11-notes.yaml). The GM tears out a page (two clicks, the rip and its sound), presses
// Undo and it is back; tears it out again, opens it under Torn-out pages and restores it. A player tears out their
// page the GM could read (under reduced motion: no rip, no sound) and the GM loses it. At 1440x900 and 390x844. Every
// change is confirmed on the server (expect.poll through a Convex client) before the page is left.

const PLAYER = "e2e-player@example.test";

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** Counts AudioContexts the page creates (the tear sound is synthesised only after the second click). */
async function countAudio(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { AudioContext?: typeof AudioContext; __audioCount: number };
    w.__audioCount = 0;
    const Real = w.AudioContext;
    if (!Real) return;
    w.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        w.__audioCount += 1;
      }
    };
  });
  return () => page.evaluate(() => (window as unknown as { __audioCount: number }).__audioCount);
}

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Bin ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2] as Id<"campaigns"> };
}

async function playerJoins(page: Page, browser: Browser, campaignName: string, viewport: { width: number; height: number }) {
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.goto(`/join/${code}`);
  await player.getByRole("button", { name: "Join campaign" }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close: () => context.close() };
}

const paper = (page: Page) => page.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Page" });
const toast = (page: Page) => page.getByRole("status").filter({ hasText: "Page torn out" });
const binList = (page: Page) => page.getByRole("list", { name: "Torn-out pages" });

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

async function tearOut(page: Page) {
  const button = paper(page).getByRole("button", { name: "Tear out page" });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await paper(page).getByRole("button", { name: "Click again to tear out" }).click();
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return ((error as { data?: { code?: string } }).data?.code ?? String(error)) as string;
  }
}

/** The page's server state: in the journal's pages, in the bin. */
async function serverState(client: ConvexHttpClient, campaignId: Id<"campaigns">, pageId: Id<"journalPages">) {
  const journal = await client.query(api.notes.journal, { campaignId });
  const bin = await client.query(api.notesBin.bin, { campaignId });
  return {
    listed: "pages" in journal && journal.pages.some((p) => p._id === pageId),
    binned: bin.some((r) => r._id === pageId),
  };
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}: the GM tears out a page, undoes it, tears it out again and restores it from Torn-out pages`, async ({ page }) => {
    // The test waits out the toast's 10 s on purpose; on a loaded machine the rest no longer fits the default 30 s.
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const audio = await countAudio(page);
    const { campaignId } = await gmCreatesCampaign(page);
    const client = await convexAs(page);
    // Seed 'Rumors & hooks' (the journal's first write) to learn its id; the behaviour under test goes through the UI.
    const { pageId } = await client.mutation(api.notesEntries.add, { campaignId, page: { template: 1 }, kind: "note", text: "the mill burned" });

    await page.goto(`/campaigns/${campaignId}/notes?page=${pageId}`);
    await expect(paper(page).getByLabel("Page title")).toHaveValue("Rumors & hooks");
    await openIndex(page);
    await expect(page.getByRole("region", { name: "Torn-out pages" }).getByText("Nothing torn out.")).toBeVisible();

    // First click arms, second tears: the rip plays over the paper, the sound is synthesised, the toast offers Undo.
    await paper(page).getByRole("button", { name: "Tear out page" }).click();
    await expect(paper(page).getByRole("button", { name: "Click again to tear out" })).toBeVisible();
    expect(await audio()).toBe(0);
    await paper(page).getByRole("button", { name: "Click again to tear out" }).click();
    await expect(page.getByTestId("tear-frame")).toBeAttached();
    expect(await audio()).toBe(1);
    await expect(toast(page)).toBeVisible();
    await expect(toast(page).getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(paper(page).getByLabel("Page title")).toHaveValue("Session 1");
    await expect(page.getByTestId("tear-frame")).toHaveCount(0);
    await expect.poll(() => serverState(client, campaignId, pageId)).toEqual({ listed: false, binned: true });
    if (viewport.width < 640) await expectNoHorizontalScroll(page);

    // Undo: the page is back and open.
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect(paper(page).getByLabel("Page title")).toHaveValue("Rumors & hooks");
    await expect(page).toHaveURL(new RegExp(`page=${pageId}`));
    await expect(toast(page)).toBeHidden();
    await expect.poll(() => serverState(client, campaignId, pageId)).toEqual({ listed: true, binned: false });

    // Again: this time it waits under Torn-out pages ('30 days left'); the toast goes after 10 seconds.
    await tearOut(page);
    await expect(toast(page)).toBeVisible();
    await openIndex(page);
    const row = binList(page).getByRole("listitem").filter({ hasText: "Rumors & hooks" });
    await expect(row).toContainText("30 days left");
    await expect.poll(() => serverState(client, campaignId, pageId)).toEqual({ listed: false, binned: true });
    await expect(toast(page)).toBeHidden({ timeout: 13_000 });

    // Open it read only, then restore it.
    await row.getByRole("button", { name: /^Rumors & hooks/ }).click();
    const torn = page.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Torn-out page" });
    await expect(torn.getByText("the mill burned")).toBeVisible();
    await expect(torn.getByRole("textbox", { name: "New entry" })).toHaveCount(0);
    if (viewport.width < 640) await expectNoHorizontalScroll(page);
    await openIndex(page);
    await row.getByRole("button", { name: "Restore Rumors & hooks" }).click();
    await expect(paper(page).getByLabel("Page title")).toHaveValue("Rumors & hooks");
    await openIndex(page);
    await expect(page.getByRole("region", { name: "Torn-out pages" }).getByText("Nothing torn out.")).toBeVisible();
    await expect.poll(() => serverState(client, campaignId, pageId)).toEqual({ listed: true, binned: false });
    expect((await client.query(api.notesEntries.entries, { campaignId, page: pageId })).entries.map((e) => e.text)).toEqual(["the mill burned"]);
  });

  test(`${viewport.width}: a player tears out a page the GM could read (reduced motion: no rip, no sound) and the GM loses it`, async ({ page, browser }) => {
    const { name, campaignId } = await gmCreatesCampaign(page);
    const gm = await convexAs(page);
    const { player, close } = await playerJoins(page, browser, name, viewport);
    try {
      const audio = await countAudio(player);
      const client = await convexAs(player);
      await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
      const { pageId } = await client.mutation(api.notesEntries.add, { campaignId, page: { template: 0 }, kind: "event", text: "we crossed the river" });
      // 'gm' is a player's default visibility (A4): the GM reads the page.
      expect(await codeOf(gm.query(api.notesEntries.entries, { campaignId, page: pageId }))).toBe("ok");

      await player.goto(`/campaigns/${campaignId}/notes?page=${pageId}`);
      await expect(paper(player).getByText("we crossed the river")).toBeVisible();
      await tearOut(player);
      await expect(toast(player)).toBeVisible();
      await expect(player.getByTestId("tear-frame")).toHaveCount(0);
      expect(await audio()).toBe(0);
      await openIndex(player);
      await expect(binList(player).getByRole("listitem").filter({ hasText: "Session 1" })).toContainText("30 days left");
      await expect.poll(() => codeOf(gm.query(api.notesEntries.entries, { campaignId, page: pageId }))).toBe("NOTE_PAGE_NOT_FOUND");
      await expect.poll(async () => (await gm.query(api.notesBin.bin, { campaignId })).length).toBe(0);
      if (viewport.width < 640) await expectNoHorizontalScroll(player);
    } finally {
      await close();
    }
  });
}
