import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function gmCreatesCampaign(page: Page, frameId: string, signIn = true) {
  if (signIn) {
    await signInAsTestGm(page);
    await expect(page).toHaveURL("/");
  }
  const name = unique("Wizard");
  await page.goto(`/frames/${frameId}`);
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2];
  return { name, campaignId };
}

async function playerJoins(page: Page, browser: Browser, campaignName: string) {
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

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

/** Walks all nine steps with a Guardian and creates the character. */
async function completeWizard(page: Page, characterName: string) {
  await expect(page.getByRole("heading", { level: 2, name: "Class & Subclass" })).toBeVisible();
  await expect(page.getByText("Still needed: a class")).toBeVisible();
  await page.getByRole("radio", { name: /^Guardian/ }).check();
  await page.getByRole("radio", { name: "Stalwart", exact: true }).check();
  await next(page);

  await expect(page.getByRole("heading", { level: 2, name: "Heritage" })).toBeFocused();
  await page.getByRole("radio", { name: "Dwarf", exact: true }).check();
  await page.getByRole("radio", { name: "Ridgeborne", exact: true }).check();
  await next(page);

  await page.getByRole("button", { name: "Use suggested" }).click();
  await next(page);

  await page.getByLabel("Character name").fill(characterName);
  await page.getByLabel("Pronouns").fill("they/them");
  await next(page);

  await expect(page.getByText("Still needed: a primary weapon, armor, a potion and a class item")).toBeVisible();
  await page.getByRole("button", { name: "Use suggested loadout" }).click();
  await page.getByRole("radio", { name: /Minor Health Potion/ }).check();
  await page.getByRole("group", { name: "Class item" }).getByRole("radio").first().check();
  await next(page);

  // Background is optional.
  await next(page);

  await page.getByLabel("First Experience").fill("Bodyguard");
  await page.getByRole("button", { name: "Soldier" }).click();
  await expect(page.getByLabel("Second Experience")).toHaveValue("Soldier");
  await next(page);

  const cards = page.getByRole("checkbox", { name: /^Choose / });
  await cards.nth(0).check();
  await cards.nth(1).check();
  await expect(page.getByText("2 / 2 chosen")).toBeVisible();
  await next(page);

  await expect(page.getByRole("heading", { level: 2, name: "Connections" })).toBeVisible();
  await page.getByRole("button", { name: "Create character" }).click();
}

test("a player completes all nine steps and lands on the sheet", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page, "witherwild");
  const { player, close } = await playerJoins(page, browser, name);

  await player.goto(`/campaigns/${campaignId}/party/new`);
  await completeWizard(player, "Brakka Stonefist");
  await expect(player).toHaveURL(new RegExp(`/campaigns/${campaignId}/party/(?!new$)[a-z0-9]+$`));

  // The sent draft is cleared: a new wizard starts empty.
  await player.goto(`/campaigns/${campaignId}/party/new`);
  await expect(player.getByText("Still needed: a class")).toBeVisible();
  await expect(player.getByLabel("Character for")).toHaveCount(0);
  await close();
});

test("the GM creates a character for a player", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page, "witherwild");
  const { close } = await playerJoins(page, browser, name);

  await page.goto(`/campaigns/${campaignId}/party/new`);
  const owner = page.getByLabel("Character for");
  const option = owner.locator("option", { hasText: "e2e-player" });
  await expect(option).toHaveCount(1);
  await owner.selectOption((await option.getAttribute("value"))!);
  await completeWizard(page, "Mira for the player");
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/party/(?!new$)[a-z0-9]+$`));
  await close();
});

test("Hope & Fear classes are hidden when the option is off", async ({ page }) => {
  const core = await gmCreatesCampaign(page, "witherwild");
  await page.goto(`/campaigns/${core.campaignId}/party/new`);
  await expect(page.getByRole("radio", { name: /^Guardian/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Witch/ })).toHaveCount(0);

  // Already signed in: /signin would redirect home without the form.
  const expansion = await gmCreatesCampaign(page, "castle-high", false);
  await page.goto(`/campaigns/${expansion.campaignId}/party/new`);
  await expect(page.getByRole("radio", { name: /^Witch/ })).toBeVisible();
});

test("an unsent draft survives a reload", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page, "witherwild");
  await page.goto(`/campaigns/${campaignId}/party/new`);
  await page.getByRole("radio", { name: /^Bard/ }).check();
  await page.reload();
  await expect(page.getByRole("radio", { name: /^Bard/ })).toBeChecked();
  await expect(page.getByText("Still needed: a subclass")).toBeVisible();
});
