import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Jesaña");
  await page.goto("/frames/dark-heart-of-andaluria");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

async function playerJoins(page: Page, browser: Browser) {
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
  return { player, close: () => context.close() };
}

test("the GM runs a hunt; players see the beat and solid clues only", async ({ page, browser }) => {
  await gmCreatesCampaign(page);
  const card = page.getByRole("region", { name: "The Hunt" });
  await card.getByLabel("New hunt name").fill("The Drowned Bell");
  await card.getByRole("button", { name: "New hunt" }).click();
  const hunt = card.getByRole("listitem", { name: "The Drowned Bell" });
  await expect(hunt).toBeVisible();

  await hunt.getByLabel("Monster", { exact: true }).fill("The grieving siren");
  await hunt.getByLabel("Monster", { exact: true }).blur();
  await hunt.getByLabel("Beat for The Drowned Bell").selectOption("investigation");
  for (const text of ["Wet footprints lead to the bay", "The children hum her song"]) {
    await hunt.getByLabel("New clue for The Drowned Bell").fill(text);
    await hunt.getByRole("button", { name: "Add clue" }).click();
    await expect(hunt.getByLabel(/^Clue \d$/).last()).toHaveValue(text);
  }
  await hunt.getByRole("checkbox", { name: "Clue 1 revealed" }).click();
  await expect(hunt.getByRole("checkbox", { name: "Clue 1 revealed" })).toBeChecked();

  const { player, close } = await playerJoins(page, browser);
  const playerHunt = player.getByRole("region", { name: "The Hunt" }).getByRole("listitem", { name: "The Drowned Bell" });
  await expect(playerHunt).toContainText("Investigation");
  await expect(playerHunt).toContainText("Wet footprints lead to the bay");
  await expect(player.getByText("The children hum her song")).toHaveCount(0);
  await expect(player.getByText("The grieving siren")).toHaveCount(0);
  await expect(playerHunt.getByText("All clues revealed")).toHaveCount(0);

  await hunt.getByRole("checkbox", { name: "Clue 2 revealed" }).click();
  await expect(hunt.getByText("All clues revealed")).toBeVisible();
  await expect(playerHunt.getByText("All clues revealed")).toBeVisible();
  await expect(playerHunt).toContainText("The children hum her song");

  await hunt.getByRole("checkbox", { name: "Reveal monster to players" }).click();
  await expect(playerHunt).toContainText("The grieving siren");
  await close();
});
