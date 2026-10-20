import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { convexAs } from "./visual/helpers";

const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function newCampaign(page: Page, frameId: string) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto(`/frames/${frameId}`);
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const name = unique("Dash");
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("GM Fear: clicking a token sets Fear, clicking the top token lowers it", async ({ page }) => {
  await newCampaign(page, "beast-feast");
  const fear = page.getByTestId("fear-value");
  await expect(fear).toHaveText("—");
  await page.getByRole("button", { name: "Fear 5 of 12" }).click();
  await expect(fear).toHaveText("V");
  await page.getByRole("button", { name: "Fear 5 of 12" }).click();
  await expect(fear).toHaveText("IV");
  await page.getByRole("button", { name: "Fear 12 of 12" }).click();
  await expect(fear).toHaveText("XII");
});

test("countdowns follow the old rules through to completion", async ({ page }) => {
  await newCampaign(page, "motherboard");
  await page.getByRole("button", { name: "+ New countdown" }).click();
  const dialog = page.getByRole("dialog", { name: "New countdown" });
  await dialog.getByLabel("Countdown name").fill("The dam breaks");
  await dialog.getByLabel("What happens at zero").fill("The valley floods.");
  await dialog.getByLabel("Category").selectOption("threat");
  await dialog.getByRole("radio", { name: "3", exact: true }).click();
  await dialog.getByRole("button", { name: "Start at 3" }).click();

  const card = page.getByRole("article", { name: "The dam breaks" });
  const value = card.getByTestId("countdown-value");
  await expect(value).toHaveText("3/3");
  // Borrowed time cannot go above the starting value.
  await expect(card.getByRole("button", { name: /Borrowed time/ })).toBeDisabled();

  await card.getByRole("button", { name: "Tick −1" }).click();
  await expect(value).toHaveText("2/3");

  // Paused: ticking is blocked, a correction still works.
  await card.getByRole("button", { name: "Pause" }).click();
  await expect(card.getByRole("button", { name: "Tick −1" })).toBeDisabled();
  // Clicking the top lit grain corrects the countdown down by one.
  await card.getByRole("button", { name: "The dam breaks: grain 2 of 3" }).click();
  await expect(value).toHaveText("1/3");
  await card.getByRole("button", { name: "Resume" }).click();

  await card.getByRole("button", { name: "Tick −1" }).click();
  await expect(card.getByText("THE COUNTDOWN HAS STRUCK")).toBeVisible();
  await expect(card).toHaveAttribute("data-status", "completed");

  await card.getByRole("button", { name: /Borrowed time/ }).click();
  await expect(value).toHaveText("1/3");
  await expect(card).toHaveAttribute("data-status", "active");

  await card.getByRole("button", { name: "Cancel countdown…" }).click();
  await card.getByRole("alertdialog").getByRole("button", { name: "Cancel countdown" }).click();
  await expect(card).toHaveCount(0);
});

test("countdown visibility: private, public with hidden fields, public", async ({ page, browser }) => {
  await newCampaign(page, "beast-feast");
  const campaignUrl = page.url();
  await page.getByRole("button", { name: "Players" }).click();
  const players = page.getByRole("dialog", { name: "Players" });
  await expect(players.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await players.getByTestId("join-code").textContent())!;
  await players.getByRole("button", { name: "Close players" }).click();

  async function create(name: string, preset: "Private" | "Public, details hidden" | "Public", tick: string[] = []) {
    await page.getByRole("button", { name: "+ New countdown" }).click();
    const dialog = page.getByRole("dialog", { name: "New countdown" });
    await dialog.getByLabel("Countdown name").fill(name);
    await dialog.getByLabel("What happens at zero").fill(`${name}: the end`);
    await dialog.getByLabel("Notes").fill(`${name} secret notes`);
    await dialog.getByRole("radio", { name: preset, exact: true }).check();
    if (preset === "Public, details hidden") {
      // Name and Description are ticked by default.
      await expect(dialog.getByRole("checkbox", { name: "Name" })).toBeChecked();
      await expect(dialog.getByRole("checkbox", { name: "Description" })).toBeChecked();
      for (const field of tick) await dialog.getByRole("checkbox", { name: field }).check();
    }
    await dialog.getByRole("radio", { name: "4", exact: true }).click();
    await dialog.getByRole("button", { name: "Start at 4" }).click();
    await expect(dialog).toBeHidden();
  }
  await create("Shadow plot", "Private");
  await create("The dam breaks", "Public, details hidden", ["Progress"]);
  await create("Market day", "Public");

  // The GM sees every field, with a badge saying what players see.
  const grid = page.getByRole("region", { name: "Countdowns" });
  await expect(grid.getByRole("button", { name: "Who can see Shadow plot: Private" })).toBeVisible();
  await expect(grid.getByRole("button", { name: "Who can see The dam breaks: Partly hidden" })).toBeVisible();
  await expect(grid.getByRole("button", { name: "Who can see Market day: Public" })).toBeVisible();
  await expect(grid.getByRole("article", { name: "The dam breaks" }).getByTestId("countdown-value")).toHaveText("4/4");

  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, "e2e-player@example.test");
  await expect(player).toHaveURL("/");
  await player.goto(`/join/${code}`);
  await player.getByRole("button", { name: "Join campaign" }).click();
  await expect(player).toHaveURL(campaignUrl);
  const seen = player.getByRole("region", { name: "Countdowns" });

  // A: nothing of the private countdown reaches the player.
  await expect(seen.getByRole("article")).toHaveCount(2);
  await expect(seen).not.toContainText("Shadow plot");
  // B: hidden name, description and progress show as placeholders; the rest is there.
  const hidden = seen.getByRole("article", { name: "Hidden countdown" });
  await expect(hidden.getByTestId("hidden-description")).toBeVisible();
  await expect(hidden.getByTestId("covered-hourglass")).toBeAttached();
  await expect(hidden.getByTestId("countdown-value")).toHaveText("?");
  await expect(hidden).toContainText("The dam breaks: the end");
  await expect(seen).not.toContainText("The dam breaks secret notes");
  await expect(player.getByText("The dam breaks", { exact: true })).toHaveCount(0);
  // C: everything public.
  const market = seen.getByRole("article", { name: "Market day" });
  await expect(market.getByTestId("countdown-value")).toHaveText("4/4");
  await expect(market).toContainText("Market day secret notes");
  await expect(seen.getByRole("button", { name: /Who can see/ })).toHaveCount(0);

  // The GM changes visibility later from the badge; the player's board follows live.
  await grid.getByRole("button", { name: "Who can see Shadow plot: Private" }).click();
  const change = page.getByRole("dialog", { name: "Who can see this" });
  await change.getByRole("radio", { name: "Public", exact: true }).check();
  await change.getByRole("button", { name: "Save" }).click();
  await expect(grid.getByRole("button", { name: "Who can see Shadow plot: Public" })).toBeVisible();
  await expect(seen.getByRole("article", { name: "Shadow plot" }).getByTestId("countdown-value")).toHaveText("4/4");

  await grid.getByRole("button", { name: "Who can see Market day: Public" }).click();
  await change.getByRole("radio", { name: "Private", exact: true }).check();
  await change.getByRole("button", { name: "Save" }).click();
  await expect(seen.getByRole("article", { name: "Market day" })).toHaveCount(0);
  await context.close();
});

test("Witherwild campaign time: set a day, then begin a new week", async ({ page }) => {
  await newCampaign(page, "witherwild");
  await expect(page.getByTestId("time-label")).toContainText("Month 1 · Week 1 · Day 1");
  await expect(page.getByTestId("time-stage")).toHaveText("Dawn");

  await page.getByRole("button", { name: "Day 4: High Noon" }).click();
  await expect(page.getByTestId("time-stage")).toHaveText("High Noon");

  await page.getByRole("button", { name: "Day 7: Nautical Twilight" }).click();
  await page.getByRole("button", { name: /Bring the Night/ }).click();
  await expect(page.getByTestId("time-label")).toContainText("Month 1 · Week 2 · Day 1");
  await expect(page.getByTestId("time-label")).toContainText("Night");
  await expect(page.getByTestId("time-stage")).toHaveText("Nightfall");
});

test("frames without campaign time show no arc", async ({ page }) => {
  await newCampaign(page, "castle-high");
  await expect(page.getByRole("region", { name: "GM Fear" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Time of the long cycle" })).toHaveCount(0);
});

test("D10 S7: the hero session line, Start Session, the Last Session card and the Wither panel's End Session", async ({ page, browser }) => {
  await newCampaign(page, "witherwild");
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const client = await convexAs(page);
  const hero = page.getByRole("region", { name: "Campaign header" });
  const last = page.getByRole("region", { name: "Last Session" });
  const wither = page.getByRole("region", { name: "Wither Tokens" });

  // Nothing yet: the board's fallbacks (B9), an empty Wither panel (B12), and no temporary Session card.
  await expect(hero.getByTestId("hero-session")).toHaveText("No sessions yet");
  await expect(hero.getByTestId("hero-next-session")).toHaveText("Next session not scheduled");
  await expect(last.getByTestId("last-session-text")).toHaveText("No sessions played yet. Write a recap in a session's Wrap-up stage and it will appear here.");
  await expect(last.getByRole("link", { name: "All sessions" })).toHaveAttribute("href", `/campaigns/${campaignId}/sessions`);
  await expect(wither.getByTestId("wither-panel-count")).toHaveText("0 on sheets · 20 in pool");
  await expect(page.getByRole("heading", { name: "Session", exact: true })).toHaveCount(0);

  // Start Session (B8): no session yet, so one is created, started and opened on Play.
  await hero.getByRole("button", { name: "Start Session", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\?s=[^&]+&stage=play$/);
  await expect(page.getByRole("tab", { name: "Play" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Live session" })).toContainText("Session in progress");
  const sessionUrl = new URL(page.url());

  await page.goto(`/campaigns/${campaignId}`);
  await expect(hero.getByTestId("hero-session")).toHaveText("Session 1");
  await expect(hero.getByRole("link", { name: "Session 1 in progress" })).toHaveAttribute("href", `${sessionUrl.pathname}${sessionUrl.search}`);
  await expect(hero.getByRole("button", { name: "Start Session", exact: true })).toHaveCount(0);

  // The Wither panel's End Session: the same confirm and report as the live card (B12).
  await wither.getByRole("button", { name: "End Session · convert 0 to Fear" }).click();
  await page.getByRole("dialog", { name: "End the session?" }).getByRole("button", { name: "End session" }).click();
  await expect(wither.getByRole("status")).toHaveText("Session ended.");
  await expect(hero.getByRole("button", { name: "Start Session", exact: true })).toBeVisible();
  await expect(hero.getByTestId("hero-session")).toHaveText("Session 1");
  await expect(last.getByTestId("last-session-text")).toHaveText("Session 1 was played, but no recap was written. Add one in the session's Wrap-up.");

  // A recap and a dated planned session reach the card and the hero.
  const sessionId = sessionUrl.searchParams.get("s")!;
  await client.mutation(api.sessionWrap.setRecap, { campaignId, sessionId, recap: "The party crossed the river at dawn." });
  const { sessionId: next } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.sessionRecords.setDate, { campaignId, sessionId: next, date: "2026-11-24" });
  await expect(last.getByTestId("last-session-text")).toHaveText("The party crossed the river at dawn.");
  await expect(hero.getByTestId("hero-next-session")).toHaveText(/^Next session \D*24\D*2026$|^Next session .*2026.*24/);

  // A player sees the line and the card, no buttons, and while a session runs a chip instead of the button.
  await page.getByRole("button", { name: "Players" }).click();
  const players = page.getByRole("dialog", { name: "Players" });
  await expect(players.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await players.getByTestId("join-code").textContent())!;
  await players.getByRole("button", { name: "Close players" }).click();
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, "e2e-player@example.test");
  await expect(player).toHaveURL("/");
  await player.goto(`/join/${code}`);
  await player.getByRole("button", { name: "Join campaign" }).click();
  const playerHero = player.getByRole("region", { name: "Campaign header" });
  await expect(playerHero.getByTestId("hero-session")).toHaveText("Session 1");
  await expect(player.getByRole("region", { name: "Last Session" }).getByTestId("last-session-text")).toHaveText("The party crossed the river at dawn.");
  await expect(playerHero.getByRole("button", { name: "Start Session", exact: true })).toHaveCount(0);
  await expect(player.getByRole("region", { name: "Wither Tokens" }).getByRole("button")).toHaveCount(0);

  await client.mutation(api.sessions.start, { campaignId, idempotencyKey: crypto.randomUUID() });
  await expect(playerHero.getByText("Session 2 in progress")).toBeVisible();
  await expect(playerHero.getByRole("link", { name: "Session 2 in progress" })).toHaveCount(0);
  await expect(hero.getByRole("link", { name: "Session 2 in progress" })).toBeVisible();
  await context.close();
});
