import { expect, test } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

// The e2e backend has no ANTHROPIC_API_KEY, so photo import must stay hidden,
// even for the GM (decision 13). Reading photos is covered by
// tests/convex/photo-import.test.ts with a stubbed fetch.
test("without ANTHROPIC_API_KEY the GM sees no photo import button", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Photos ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const dialog = page.getByRole("dialog", { name: "Name your campaign" });
  await dialog.getByLabel("Campaign name").fill(name);
  await dialog.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2];

  await page.goto(`/campaigns/${campaignId}/party`);
  await expect(page.getByRole("heading", { level: 1, name: "The Party" })).toBeVisible();
  // The roster has loaded (its queries ran alongside photoImport.available).
  await expect(page.getByText("No characters yet. Create the first hero of this party.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import from photo" })).toHaveCount(0);
});
