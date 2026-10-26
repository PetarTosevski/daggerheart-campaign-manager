import { expect, test, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function newCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/frames/age-of-umbra");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const name = unique("Umbra");
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("the GM keeps the Sacred Pyres and spends a Blessed Branch", async ({ page }) => {
  await newCampaign(page);
  await page.getByLabel("Settlement", { exact: true }).fill("Brightmoor");
  await page.getByRole("button", { name: "Add pyre" }).click();
  const pyres = page.getByRole("list", { name: "Sacred Pyres" });
  const flame = pyres.getByRole("button", { name: /^Brightmoor: / });
  await expect(flame).toHaveAttribute("aria-pressed", "true");

  await flame.click();
  await expect(pyres.getByRole("button", { name: "Brightmoor: extinguished" })).toBeVisible();

  await page.getByRole("button", { name: "Rename Brightmoor" }).click();
  await page.getByLabel("Settlement name").fill("Brightmoor Keep");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(pyres.getByRole("button", { name: "Brightmoor Keep: extinguished" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Ignite a Blessed Branch" })).toBeDisabled();
  await page.getByRole("button", { name: "Add a Blessed Branch" }).click();
  await expect(page.getByTestId("blessed-branches")).toHaveText("1");
  await page.getByRole("button", { name: "Ignite a Blessed Branch" }).click();
  const dialog = page.getByRole("dialog", { name: "Ignite a Blessed Branch" });
  await dialog.getByLabel("Kindle").selectOption({ label: "Relight Brightmoor Keep" });
  await dialog.getByRole("button", { name: "Ignite", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "3 Hope" })).toBeVisible();
  await expect(page.getByTestId("blessed-branches")).toHaveText("0");
  await expect(pyres.getByRole("button", { name: "Brightmoor Keep: burning" })).toBeVisible();
});

test("the Lurking Darkness roller rolls on the server, and not at a pyre", async ({ page }) => {
  await newCampaign(page);
  await page.getByRole("button", { name: "Roll Lurking Darkness" }).click();
  const dialog = page.getByRole("dialog", { name: "Lurking Darkness" });
  await dialog.getByRole("button", { name: "+ Add watcher" }).click();
  await dialog.getByLabel("Watcher 1 Hope Die").fill("12");
  await dialog.getByRole("button", { name: "Roll d12" }).click();
  // A watcher's 12 is always at least as good as the GM's roll.
  await expect(dialog.getByTestId("lurking-result")).toHaveText("12");
  await expect(dialog).toContainText("Each PC gains a Hope");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("list", { name: "Last Lurking Darkness rolls" })).toContainText("Each PC gains a Hope");

  await page.getByLabel("The party is at a Sacred Pyre").click();
  await expect(page.getByLabel("The party is at a Sacred Pyre")).toBeChecked();
  await expect(page.getByRole("button", { name: "Roll Lurking Darkness" })).toBeDisabled();
});

test("players see the pyres read-only and no Lurking Darkness roller", async ({ page, browser }) => {
  await newCampaign(page);
  await page.getByLabel("Settlement", { exact: true }).fill("Lastlight");
  await page.getByRole("button", { name: "Add pyre" }).click();
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await dialog.getByLabel("Player email").fill(PLAYER);
  await dialog.getByRole("button", { name: "Invite" }).click();
  await expect(dialog.getByText(`${PLAYER} · invited`)).toBeVisible();
  const campaignUrl = page.url();

  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.goto(campaignUrl);
  await expect(player.getByRole("button", { name: "Lastlight: burning" })).toBeDisabled();
  await expect(player.getByRole("button", { name: "Add pyre" })).toHaveCount(0);
  await expect(player.getByRole("heading", { name: "Lurking Darkness" })).toHaveCount(0);
  await expect(player.getByRole("button", { name: "Roll Lurking Darkness" })).toHaveCount(0);
  await context.close();
});
