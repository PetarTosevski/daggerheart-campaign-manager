import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Whelvia");
  await page.goto("/frames/reign-of-the-weredragon");
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

test("a player rolls the night sky and the GM places the dice; players submit secrets privately", async ({ page, browser }) => {
  await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser);
  const card = page.getByRole("region", { name: /Revelations/ });
  const playerCard = player.getByRole("region", { name: /Revelations/ });

  // HF p.140: the players roll the 5d6; every member sees the result.
  await playerCard.getByRole("button", { name: "Roll the night sky" }).click();
  await expect(playerCard.getByTestId("night-sky-roll")).toHaveText(/^[1-6]( · [1-6]){4}$/);
  const roll = (await playerCard.getByTestId("night-sky-roll").textContent())!;
  await expect(card.getByTestId("night-sky-roll")).toHaveText(roll);
  await expect(playerCard.getByRole("button", { name: "Roll the night sky" })).toBeDisabled();
  await expect(playerCard.getByRole("group", { name: "Night sky reading" })).toHaveCount(0);

  // Picking a die already in another column swaps the two.
  const reading = card.getByRole("group", { name: "Night sky reading" });
  await reading.getByLabel("Die for Powerful Ally").selectOption({ index: 0 });
  await expect(reading.getByLabel("Die for Secret’s Location")).toHaveValue("1");
  await reading.getByRole("button", { name: "Apply reading" }).click();
  await expect(reading).toHaveCount(0);
  await expect(playerCard.getByTestId("night-sky-roll")).toHaveCount(0);
  await expect(playerCard.getByRole("button", { name: "Roll the night sky" })).toBeEnabled();

  const ally = card.getByRole("listitem", { name: "Powerful Ally" });
  const allyText = await ally.getByLabel("Powerful Ally text").inputValue();
  expect(allyText.length).toBeGreaterThan(10);
  await ally.getByLabel("Powerful Ally status").selectOption("revealed");

  await expect(playerCard.getByRole("listitem", { name: "Powerful Ally" })).toContainText(allyText);
  await expect(playerCard.getByRole("listitem", { name: "Secret’s Location" })).toContainText("Not yet revealed.");

  const secrets = player.getByRole("region", { name: /Forlorne’s Secrets/ });
  await secrets.getByLabel("Secret Forlorne is hiding").fill("She fears her own reflection");
  await secrets.getByRole("button", { name: "Submit secret" }).click();
  await expect(secrets.getByRole("list", { name: "Your secrets" })).toContainText("She fears her own reflection");

  const gmSecrets = page.getByRole("region", { name: /Forlorne’s Secrets/ });
  await expect(gmSecrets.getByRole("list", { name: "Submitted secrets" })).toContainText("She fears her own reflection");
  await gmSecrets.getByRole("checkbox", { name: "Used" }).click();
  await expect(gmSecrets.getByRole("checkbox", { name: "Used" })).toBeChecked();
  await close();
});
