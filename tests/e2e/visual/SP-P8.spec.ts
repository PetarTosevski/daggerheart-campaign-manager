import path from "node:path";

import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { D9_VIEWPORTS, openCombatMap, visual } from "./helpers";

// Shots for the SP-P8 task doc (E2E_VISUAL=1): the sprite packs screen with a cut 4 x 4 sheet in the labelling
// grid, and a pack with saved sprites. No design board exists for sprites (plan rule "Visual acceptance"); the
// counterparts are the Combat Map's own cards and the P4 contact sheets.

const SHEET = path.join(__dirname, "../../fixtures/sprite-uploads/props-4x4.png");

test("SP-P8 labelling grid and saved sprites at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId } = await openCombatMap(page);
  await client.mutation(api.spritePacks.createPack, { campaignId, name: "Moorland", extends: "forest", idempotencyKey: crypto.randomUUID() });
  await page.goto(`/campaigns/${campaignId}/combat-map/packs`);
  const pack = page.getByRole("region", { name: "Moorland", exact: true });
  const upload = pack.getByRole("region", { name: "Add sprites to Moorland" });
  await upload.getByTestId(/^sprite-file-/).setInputFiles(SHEET);
  const cuts = upload.getByRole("list", { name: "Cut sprites" });
  await expect(cuts.getByRole("listitem")).toHaveCount(16);
  await upload.getByRole("button", { name: "Select none" }).click();
  for (const [index, name, sight] of [
    [1, "Standing stone", "Blocks sight"],
    [2, "Mossy crate", "Cover"],
    [3, "Old well", "Blocks sight"],
  ] as const) {
    const cut = cuts.getByRole("listitem", { name: `Cut ${index}: Sprite ${index}` });
    await cut.getByLabel("Upload").check();
    await cut.getByLabel("Name").fill(name);
    await cuts.getByRole("listitem", { name: `Cut ${index}: ${name}` }).getByLabel("Sight").selectOption({ label: sight });
  }
  const { shoot } = visual(page, "SP-P8", D9_VIEWPORTS);
  await shoot(page.locator(".cm-root"), "labelling");

  await upload.getByRole("button", { name: "Upload selected (3)" }).click();
  await expect(cuts.getByText("Uploaded")).toHaveCount(3);
  await expect.poll(async () => (await client.query(api.spritePacks.packs, { campaignId }))[0]?.sprites.length).toBe(3);
  await upload.getByRole("button", { name: "Clear" }).click();
  await pack.getByRole("button", { name: "Hide upload" }).click();
  const saved = pack.getByRole("list", { name: "Sprites in Moorland" });
  await expect(saved.getByRole("img")).toHaveCount(3);
  await shoot(page.locator(".cm-root"), "saved");
});
