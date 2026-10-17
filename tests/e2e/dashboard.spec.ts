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
