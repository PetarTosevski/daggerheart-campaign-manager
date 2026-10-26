import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function gmCreatesFiveBanners(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Banners");
  await page.goto("/frames/five-banners-burning");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return name;
}

async function playerJoins(browser: Browser, code: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsTestGm(page, PLAYER);
  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: /Join Campaign/ }).click();
  await page.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  return { page, close: () => context.close() };
}

test("the GM runs the Five Banners and a player sees only what is revealed", async ({ page, browser }) => {
  const name = await gmCreatesFiveBanners(page);
  const tracker = page.getByRole("region", { name: /Five Banners/ });
  await expect(tracker).toContainText("Week 1");

  // Relationship: Armada–Hilltop starts as Enemies (−2); improve it to Unfriendly.
  await tracker.getByRole("button", { name: /^Armada and Hilltop: Enemies/ }).click();
  await tracker.getByRole("button", { name: "Improve Armada–Hilltop relationship" }).click();
  await expect(tracker.getByTestId("relationship-value")).toHaveText("Unfriendly (−1)");
  await tracker.getByRole("button", { name: "Reveal Armada–Hilltop relationship to players" }).click();
  await expect(tracker.getByRole("button", { name: "Reveal Armada–Hilltop relationship to players" })).toHaveAttribute("aria-pressed", "true");

  // Objectives: a revealed minor and a hidden major for Armada.
  const armada = tracker.getByRole("article", { name: "Armada" });
  await armada.getByRole("button", { name: "New Armada objective" }).click();
  let dialog = page.getByRole("dialog", { name: "Armada objective" });
  await dialog.getByRole("radio", { name: "Minor (4–6 steps)" }).click();
  await dialog.getByRole("radio", { name: "4", exact: true }).click();
  await dialog.getByLabel("Objective", { exact: true }).fill("Acquire airship technology");
  await dialog.getByRole("button", { name: "Start at 4" }).click();
  await expect(dialog).toBeHidden();
  await armada.getByRole("button", { name: "Reveal Acquire airship technology to players" }).click();

  await armada.getByRole("button", { name: "New Armada objective" }).click();
  dialog = page.getByRole("dialog", { name: "Armada objective" });
  await dialog.getByLabel("Objective", { exact: true }).fill("Secret harbour plan");
  await dialog.getByRole("button", { name: "Start at 10" }).click();
  await expect(dialog).toBeHidden();

  // Advance the week, ticking the airship objective.
  await tracker.getByRole("button", { name: "Advance week" }).click();
  const week = page.getByRole("dialog", { name: "Advance to week 2" });
  await week.getByRole("group", { name: "Armada" }).getByLabel(/Acquire airship technology/).check();
  await week.getByRole("button", { name: "Advance week" }).click();
  await expect(tracker.getByTestId("week-result")).toContainText("Week 2 begins.");
  await expect(tracker).toContainText("Week 2");
  await expect(armada.getByRole("listitem", { name: "Acquire airship technology" }).getByTestId("objective-value")).toHaveText("3/4");

  // A player joins and sees only the revealed relationship and objective.
  await page.getByRole("button", { name: "Players", exact: true }).click();
  const players = page.getByRole("dialog", { name: "Players" });
  await expect(players.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await players.getByTestId("join-code").textContent())!;
  await players.getByRole("button", { name: "Close players" }).click();

  const player = await playerJoins(browser, code);
  await expect(player.page.getByRole("heading", { level: 1, name })).toBeVisible();
  const seen = player.page.getByRole("region", { name: /Five Banners/ });
  await expect(seen).toContainText("Week 2");
  await expect(seen.getByLabel("Armada and Hilltop: Unfriendly (−1)")).toBeVisible();
  await expect(seen.getByLabel("Armada and Jesthaen: unknown")).toBeVisible();
  await expect(seen.getByRole("listitem", { name: "Acquire airship technology" })).toBeVisible();
  await expect(seen).not.toContainText("Secret harbour plan");
  await expect(seen.getByRole("button", { name: "Advance week" })).toHaveCount(0);
  await expect(seen.getByRole("button", { name: /Tick/ })).toHaveCount(0);
  await player.close();
});
