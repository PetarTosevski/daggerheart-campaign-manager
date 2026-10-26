import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, expectNoHorizontalScroll, openSessions } from "./visual/helpers";

// D10 S6: Wrap-up (B5, Q4, Q5). The GM writes a recap and loot, calls the milestone (every active character shows
// 'Level up pending'); a player reads the recap and never sees loot or threads.

const PLAYER = "e2e-player@example.test";

async function playerJoins(page: Page, browser: Browser, campaignId: string, campaignName: string) {
  await page.goto(`/campaigns/${campaignId}`);
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

const RECAP = "The party crossed the river at dawn and met the Warden of Thornwick.";
const LOOT = "A bag of gold and the Wither Lantern";
const THREADS = "The Blight countdown ticked to 3.";

test("the GM writes the recap and loot and calls the milestone; a player reads only the recap", async ({ page, browser }) => {
  const { client, campaignId, campaignName, url } = await openSessions(page);
  const hero = `Tabby ${crypto.randomUUID().slice(0, 6)}`;
  const second = `Wren ${crypto.randomUUID().slice(0, 6)}`;
  for (const name of [hero, second]) {
    await client.mutation(api.characters.create, { campaignId, draft: bardDraft(name), idempotencyKey: crypto.randomUUID() });
  }

  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(page).toHaveURL(/\?s=/);
  const sessionId = new URL(page.url()).searchParams.get("s")!;
  const card = page.getByRole("region", { name: "Session detail" }).getByRole("region", { name: "Session", exact: true });
  await card.getByLabel("Session 1 title").fill("The Bridge at Dawn");
  await card.getByLabel("Session 1 title").press("Enter");
  await page.getByRole("tab", { name: "Wrap-up" }).click();
  await expect(page).toHaveURL(/stage=wrap/);

  const stage = page.getByRole("region", { name: "Wrap-up stage" });
  const recap = stage.getByRole("textbox", { name: "Recap" });
  const loot = stage.getByRole("textbox", { name: "Loot & gold" });
  const threads = stage.getByRole("textbox", { name: "Countdowns & threads" });
  await expect(stage.getByText('This shows on the dashboard as "Last Session".')).toBeVisible();
  // The recap saves after a pause in typing (no blur), loot and threads on blur.
  await recap.fill(RECAP);
  await expect.poll(async () => (await client.query(api.sessionWrap.get, { campaignId, sessionId }))?.recap).toBe(RECAP);
  await loot.fill(LOOT);
  await threads.click();
  await threads.fill(THREADS);
  await threads.blur();
  await expect.poll(async () => (await client.query(api.sessionWrap.get, { campaignId, sessionId }))?.threads).toBe(THREADS);
  expect((await client.query(api.sessionWrap.get, { campaignId, sessionId }))?.loot).toBe(LOOT);
  await page.reload();
  await expect(recap).toHaveValue(RECAP);
  await expect(loot).toHaveValue(LOOT);
  await expect(threads).toHaveValue(THREADS);

  // The milestone: one way; the box stays ticked and the Party link shows.
  const milestone = stage.getByRole("button", { name: "Milestone reached: the party levels up" });
  await expect(milestone).toHaveAttribute("aria-pressed", "false");
  await expect(stage.getByRole("link", { name: "Open Party to level up →" })).toHaveCount(0);
  await milestone.click();
  // A confirm step first; Cancel leaves the party alone.
  await stage.getByRole("button", { name: "Cancel" }).click();
  await expect(milestone).toHaveAttribute("aria-pressed", "false");
  await milestone.click();
  await stage.getByRole("button", { name: "Level up the party" }).click();
  await expect(stage.getByRole("status").filter({ hasText: "can level up" })).toHaveText("2 characters can level up.");
  await expect(milestone).toHaveAttribute("aria-pressed", "true");
  await expect(milestone).toBeDisabled();
  await page.reload();
  await expect(milestone).toHaveAttribute("aria-pressed", "true");
  await expect(milestone).toBeDisabled();

  await card.getByRole("button", { name: "Mark as played" }).click();
  await expect(card.getByRole("button", { name: "Mark as not played" })).toBeVisible();

  await stage.getByRole("link", { name: "Open Party to level up →" }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/party`);
  for (const name of [hero, second]) await expect(page.getByRole("article", { name }).getByTestId("level-up-pending")).toBeVisible();

  // Every member's dashboard summary now carries the recap (S7 shows it).
  const summary = await client.query(api.sessionWrap.dashboard, { campaignId });
  expect(summary).toMatchObject({ dashboardNumber: "Session 1", lastSessionText: RECAP });

  const { player, close } = await playerJoins(page, browser, campaignId, campaignName);
  try {
    await player.goto(url);
    const view = player.getByRole("region", { name: "Session detail" }).getByRole("region", { name: "Session", exact: true });
    await expect(view.getByRole("heading", { name: "The Bridge at Dawn" })).toBeVisible();
    await expect(view.getByText(RECAP)).toBeVisible();
    await expect(player.getByText(LOOT)).toHaveCount(0);
    await expect(player.getByText(THREADS)).toHaveCount(0);
    await expect(player.getByRole("tab", { name: "Wrap-up" })).toHaveCount(0);
    await expect(player.getByRole("region", { name: "Wrap-up stage" })).toHaveCount(0);
    // Even with the stage in the URL.
    await player.goto(`${url}?s=${sessionId}&stage=wrap`);
    await expect(player.getByRole("region", { name: "Wrap-up stage" })).toHaveCount(0);
    await expect(player.getByText(LOOT)).toHaveCount(0);
  } finally {
    await close();
  }
});

test("Wrap-up fits a phone: one column, labelled fields, 44 px milestone row, no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSessions(page);
  await page.getByRole("button", { name: "+ New session" }).click();
  await page.getByRole("tab", { name: "Wrap-up" }).click();
  const stage = page.getByRole("region", { name: "Wrap-up stage" });
  for (const name of ["Recap", "Loot & gold", "Countdowns & threads"]) await expect(stage.getByRole("textbox", { name })).toBeVisible();
  await expectNoHorizontalScroll(page);
  const recapBox = (await stage.getByRole("textbox", { name: "Recap" }).boundingBox())!;
  const lootBox = (await stage.getByRole("textbox", { name: "Loot & gold" }).boundingBox())!;
  expect(lootBox.y).toBeGreaterThan(recapBox.y + recapBox.height);
  expect((await stage.getByRole("button", { name: "Milestone reached: the party levels up" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
