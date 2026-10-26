import { expect, test, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function newCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/frames/colossus-of-the-drylands");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const name = unique("Drylands");
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return name;
}

test("the GM marks the Siphoning Track, slays a colossus and sees Kudamat's Power", async ({ page }) => {
  await newCampaign(page);
  const siphon = page.getByTestId("siphon-marked");
  await expect(siphon).toHaveText("1");
  await expect(page.getByTestId("kudamat-power")).toHaveText("0");

  await page.getByRole("button", { name: "Short rest +1" }).click();
  await expect(siphon).toHaveText("2");
  await page.getByRole("button", { name: "Long rest +2" }).click();
  await expect(siphon).toHaveText("4");

  await page.getByRole("button", { name: "Colossus defeated" }).click();
  await expect(page.getByRole("status").filter({ hasText: "levels up" })).toBeVisible();
  await expect(page.getByTestId("colossi-defeated")).toHaveText("1");
  await expect(siphon).toHaveText("1");
  await expect(page.getByRole("radio", { name: "interlude" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Short rest +1" })).toBeDisabled();
  await expect(page.getByRole("list", { name: "Last siphon rolls" })).toContainText("Colossus slain");

  // Correct Power to 57: Major 29, Severe 57.
  await page.getByLabel("Correct Power").fill("57");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.getByTestId("kudamat-power")).toHaveText("57");
  await expect(page.getByTestId("kudamat-major")).toHaveText("29");
  await expect(page.getByTestId("kudamat-severe")).toHaveText("57");

  await page.getByLabel("Correct Power").fill("100");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.getByText("KUDAMAT EMERGES FROM GODFELL MOUNTAIN")).toBeVisible();
});

test("players see the phase and colossi slain, but not Kudamat", async ({ page, browser }) => {
  await newCampaign(page);
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await dialog.getByLabel("Player email").fill(PLAYER);
  await dialog.getByRole("button", { name: "Invite" }).click();
  await expect(dialog.getByText(`${PLAYER} · invited`)).toBeVisible();
  const campaignUrl = page.url();
  await dialog.getByRole("button", { name: "Close players" }).click();
  await page.getByRole("button", { name: "Colossus defeated" }).click();
  await expect(page.getByTestId("colossi-defeated")).toHaveText("1");

  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.goto(campaignUrl);
  await expect(player.getByTestId("colossi-defeated")).toHaveText("1");
  await expect(player.getByRole("radio", { name: "interlude" })).toHaveAttribute("aria-checked", "true");
  await expect(player.getByRole("radio", { name: "hunt" })).toBeDisabled();
  await expect(player.getByTestId("kudamat-power")).toHaveCount(0);
  await expect(player.getByRole("group", { name: "Siphoning Track" })).toHaveCount(0);
  await expect(player.getByRole("button", { name: "Colossus defeated" })).toHaveCount(0);
  await context.close();
});
