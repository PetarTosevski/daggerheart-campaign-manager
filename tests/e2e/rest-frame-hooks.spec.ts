import { expect, test } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

test("a Colossus campaign's long rest marks the GM-only Siphoning Track twice (CB 327)", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/frames/colossus-of-the-drylands");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const name = unique("Drylands rest");
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  const siphon = page.getByTestId("siphon-marked");
  await expect(siphon).toHaveText("1");

  const rest = page.getByRole("region", { name: "Rest", exact: true });
  await rest.getByRole("button", { name: "Start long rest" }).click();
  await expect(rest.getByTestId("open-rest")).toContainText("Long rest under way");
  await rest.getByRole("button", { name: "Finish rest" }).click();
  await expect(rest.getByText(/Last: Long rest/)).toBeVisible();

  await expect(siphon).toHaveText("3");
});
