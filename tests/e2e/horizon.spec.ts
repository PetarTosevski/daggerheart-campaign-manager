import { expect, test, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function gmCreatesHorizonCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Valloren");
  await page.goto("/frames/journey-to-horizon");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return name;
}

test("the GM marks the Doom Track; players see Echoes and occurred events only", async ({ page, browser }) => {
  await gmCreatesHorizonCampaign(page);
  const doom = page.getByRole("region", { name: /Doom Track/ });
  await expect(doom.getByText("GM only")).toBeVisible();

  // Nested boxes wait for their parent; higher tiers wait for the party.
  const parent = doom.getByRole("checkbox", { name: "Bandits and marauders harry travelers." });
  const nested = doom.getByRole("checkbox", { name: "Tensions rise over contested resources." });
  await expect(nested).toBeDisabled();
  await expect(doom.getByRole("checkbox", { name: /Roving bands of professional soldiers/ })).toBeDisabled();
  await parent.click();
  await expect(parent).toBeChecked();
  await expect(nested).toBeEnabled();
  await nested.click();
  await expect(nested).toBeChecked();
  await expect(parent).toBeDisabled();

  // Soul Echoes: collecting one levels the party up.
  const echoes = page.getByRole("region", { name: "Soul Echoes" });
  await echoes.getByRole("button", { name: "Soul Echo 2 of 10" }).click();
  await expect(echoes.getByRole("status")).toHaveText("The party levels up.");

  // A player joins and sees no Doom Track events until one occurs.
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

  const playerEchoes = player.getByRole("region", { name: "Soul Echoes" });
  await expect(playerEchoes.getByRole("button", { name: "Soul Echo 2 of 10" })).toHaveAttribute("aria-pressed", "true");
  await expect(playerEchoes.getByRole("button", { name: "Soul Echo 2 of 10" })).toBeDisabled();
  const playerDoom = player.getByRole("region", { name: /Doom Track/ });
  await expect(playerDoom.getByText("No disasters have struck yet.")).toBeVisible();
  await expect(player.getByText("Bandits and marauders harry travelers.")).toHaveCount(0);

  // The GM marks the event as occurred; only that text reaches the player.
  await doom.getByRole("button", { name: "Occurred: Bandits and marauders harry travelers." }).click();
  await expect(playerDoom.getByText("Bandits and marauders harry travelers.")).toBeVisible();
  await expect(player.getByText("Tensions rise over contested resources.")).toHaveCount(0);
  await context.close();
});
