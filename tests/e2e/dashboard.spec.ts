import { expect, test, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

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
