import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function gmCreatesCampaign(page: Page, frameId = "witherwild") {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Shared");
  await page.goto(`/frames/${frameId}`);
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return name;
}

async function playerPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsTestGm(page, PLAYER);
  await expect(page).toHaveURL("/");
  return { page, close: () => context.close() };
}

test("a player joins with the GM's code and sees a read-only dashboard", async ({ page, browser }) => {
  const name = await gmCreatesCampaign(page);
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;

  const player = await playerPage(browser);
  await player.page.getByRole("button", { name: /Join Campaign/ }).click();
  await player.page.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code.toLowerCase());
  await player.page.getByRole("button", { name: "Join", exact: true }).click();

  await expect(player.page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(player.page.getByText("Player", { exact: true })).toBeVisible();
  await expect(player.page.getByRole("button", { name: "Players" })).toHaveCount(0);
  await expect(player.page.getByRole("button", { name: "Fear 3 of 12" })).toBeDisabled();
  await expect(player.page.getByRole("button", { name: "+ New countdown" })).toHaveCount(0);
  await expect(player.page.getByRole("button", { name: "Day 2: Sunrise" })).toBeDisabled();

  // The GM sees the player at the table, live.
  await expect(dialog.getByRole("list", { name: "Players in this campaign" })).toContainText("e2e-player");

  // GM changes show up for the player without reloading.
  await dialog.getByRole("button", { name: "Close players" }).click();
  await page.getByRole("button", { name: "Fear 4 of 12" }).click();
  await expect(player.page.getByTestId("fear-value")).toHaveText("IV");
  await player.close();
});

test("an email invite shows the campaign in the player's Load Campaign", async ({ page, browser }) => {
  const name = await gmCreatesCampaign(page, "beast-feast");
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(
    dialog.getByText("Email invites work for accounts that sign in with Google. Players who use a password should join with the code above."),
  ).toBeVisible();
  await dialog.getByLabel("Player email").fill(PLAYER);
  await dialog.getByRole("button", { name: "Invite" }).click();
  await expect(dialog.getByText(`${PLAYER} · invited`)).toBeVisible();

  const player = await playerPage(browser);
  await player.page.goto("/campaigns");
  const band = player.page.locator("button[aria-expanded]", { hasText: name });
  await expect(band).toContainText("Player");
  if ((await band.getAttribute("aria-expanded")) !== "true") await band.click();
  await player.page.getByRole("button", { name: `Leave ${name}` }).click();
  await player.page.getByRole("alertdialog", { name: "Confirm leave" }).getByRole("button", { name: "Leave" }).click();
  await expect(band).toHaveCount(0);
  await player.close();
});

test("email + password: create an account (or sign in if it exists)", async ({ page }) => {
  const email = "e2e-password@example.test";
  const password = "correct-horse-battery";
  await page.goto("/signin");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  const signUp = page.getByRole("form", { name: "Create account" });
  await signUp.getByLabel("Name").fill("Pass Word");
  await signUp.getByLabel("Email").fill(email);
  await signUp.getByLabel("Password").fill(password);
  await signUp.getByRole("button", { name: "Create account" }).click();

  // On a backend where the account already exists, sign up fails; sign in instead.
  const outcome = await Promise.race([
    page.waitForURL("/").then(() => "in"),
    signUp.getByRole("alert").waitFor().then(() => "exists"),
  ]);
  if (outcome === "exists") {
    await page.getByRole("button", { name: "Have an account? Sign in" }).click();
    const signIn = page.getByRole("form", { name: "Sign in with email" });
    await signIn.getByLabel("Email").fill(email);
    await signIn.getByLabel("Password").fill(password);
    await signIn.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
});

test("a wrong password and a non-allowlisted sign-up are refused", async ({ page }) => {
  await page.goto("/signin");
  const signIn = page.getByRole("form", { name: "Sign in with email" });
  await signIn.getByLabel("Email").fill("e2e-password@example.test");
  await signIn.getByLabel("Password").fill("not-the-password");
  await signIn.getByRole("button", { name: "Sign in" }).click();
  await expect(signIn.getByRole("alert")).toBeVisible();

  await page.getByRole("button", { name: "New here? Create an account" }).click();
  const signUp = page.getByRole("form", { name: "Create account" });
  await signUp.getByLabel("Email").fill("stranger@example.test");
  await signUp.getByLabel("Password").fill("long-enough-pw");
  await signUp.getByRole("button", { name: "Create account" }).click();
  await expect(signUp.getByRole("alert")).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL("/signin");
});
