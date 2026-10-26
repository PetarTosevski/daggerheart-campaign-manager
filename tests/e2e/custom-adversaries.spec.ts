import { expect, test } from "@playwright/test";
import { ConvexError } from "convex/values";

import { api } from "../../convex/_generated/api";
import { expectNoHorizontalScroll, openAdversaries } from "./visual/helpers";

// D8 A5: the GM duplicates Bear into a custom "Cave Bear" with 9 HP, finds it under Custom adversaries, adds it to an
// encounter, and starts a blank adversary from the improvised statistics by tier (CB p.208).

test("the GM duplicates Bear as Cave Bear with 9 HP and adds it to an encounter", async ({ page }) => {
  const { client, campaignId } = await openAdversaries(page);
  const catalogue = page.getByRole("region", { name: "Adversary list" });
  await catalogue.getByRole("searchbox", { name: "Search adversaries" }).fill("bear");
  await catalogue.getByRole("button", { name: /^Bear\b/ }).first().click();
  const statBlock = page.getByRole("complementary", { name: "Stat block" });
  await expect(statBlock.getByRole("heading", { name: "Bear", exact: true })).toBeVisible();

  await statBlock.getByRole("button", { name: "Duplicate and edit Bear" }).click();
  const editor = page.getByRole("dialog", { name: "New custom adversary" });
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Bear");
  await expect(editor.getByLabel("HP", { exact: true })).toHaveValue("7");
  await editor.getByLabel("Name", { exact: true }).fill("Cave Bear");
  await editor.getByLabel("HP", { exact: true }).fill("9");
  // The live preview follows the form.
  const preview = editor.getByRole("article", { name: "Cave Bear stat block" });
  await expect(preview.getByRole("heading", { name: "Cave Bear" })).toBeVisible();
  await expect(preview.locator("dt", { hasText: "HP" }).locator("+ dd")).toHaveText("9");
  await editor.getByRole("button", { name: "Save adversary" }).click();
  await expect(editor).toBeHidden();

  const custom = page.getByRole("region", { name: "Custom adversaries" });
  const list = custom.getByRole("list", { name: "Custom adversary list" });
  await expect(list.getByRole("button", { name: /Cave Bear/ })).toHaveAttribute("aria-current", "true");
  await expect(list.getByRole("button", { name: /Cave Bear/ }).getByText("Custom")).toBeVisible();
  const block = custom.getByRole("article", { name: "Cave Bear stat block" });
  await expect(block.locator("dt", { hasText: "HP" }).locator("+ dd")).toHaveText("9");

  // Edit sends only the changed field.
  await block.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit Cave Bear" });
  await edit.getByLabel("Motives & Tactics").fill("Guard the cave, maul intruders");
  await edit.getByRole("button", { name: "Save adversary" }).click();
  await expect(edit).toBeHidden();
  await expect(block.getByText("Guard the cave, maul intruders")).toBeVisible();

  await block.getByRole("button", { name: "Add Cave Bear to an encounter" }).click();
  const add = page.getByRole("dialog", { name: "Add to encounter" });
  await expect(add.getByRole("combobox", { name: "Encounter" })).toHaveValue("__new__");
  await add.getByLabel("New encounter name").fill("The bear cave");
  await add.getByRole("button", { name: "Add to encounter", exact: true }).click();
  await expect(add).toBeHidden();

  // The encounter holds one Cave Bear whose HP track is 9 (the tracker's pips come from this snapshot).
  await page.getByRole("tab", { name: "Encounters" }).click();
  const panel = page.getByRole("tabpanel", { name: "Encounters" });
  await panel.getByRole("navigation", { name: "Encounter list" }).getByRole("button", { name: /The bear cave/ }).click();
  const rows = panel.getByRole("list", { name: "Adversaries in this encounter" });
  await expect(rows.getByRole("listitem")).toHaveCount(1);
  await expect(rows.getByText("Cave Bear", { exact: true })).toBeVisible();
  await expect(rows.getByText(/HP 9/)).toBeVisible();
  const { active } = await client.query(api.encounters.list, { campaignId });
  const view = (await client.query(api.encounters.get, { campaignId, encounterId: active[0]!._id }))!;
  expect(view.instances.map((i) => [i.label, i.source.kind, i.stats.hpMax])).toEqual([["Cave Bear", "custom", 9]]);

  // Deleting it while the encounter runs is refused; the GM sees why.
  await client.mutation(api.encounters.start, { campaignId, encounterId: active[0]!._id });
  await page.getByRole("tab", { name: "Catalogue" }).click();
  const again = page.getByRole("region", { name: "Custom adversaries" }).getByRole("article", { name: "Cave Bear stat block" });
  await again.getByRole("button", { name: "Delete" }).click();
  await again.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByRole("region", { name: "Custom adversaries" }).getByRole("alert")).toContainText("running encounter");
  const [cave] = await client.query(api.customAdversaries.list, { campaignId });
  const refused = await client.mutation(api.customAdversaries.remove, { campaignId, customId: cave!._id }).catch((e: unknown) => e);
  expect(refused instanceof ConvexError ? (refused.data as { code: string }).code : refused).toBe("ENCOUNTER_RULE");
});

test("the GM starts a blank Tier 2 adversary from the improvised statistics; 390 px has no horizontal scroll", async ({ page }) => {
  await openAdversaries(page);
  const custom = page.getByRole("region", { name: "Custom adversaries" });
  await expect(custom.getByText(/Use “Duplicate & edit”/)).toBeVisible();
  await custom.getByRole("button", { name: "New adversary" }).click();
  const editor = page.getByRole("dialog", { name: "New custom adversary" });
  await expect(editor.getByLabel("Difficulty")).toHaveValue("11");
  await editor.getByLabel("Tier").selectOption("2");
  // CB p.208, Tier 2: attack +2, Difficulty 14, thresholds 10/20.
  await expect(editor.getByLabel("Difficulty")).toHaveValue("14");
  await expect(editor.getByLabel("Major threshold")).toHaveValue("10");
  await expect(editor.getByLabel("Severe threshold")).toHaveValue("20");
  await expect(editor.getByLabel("Attack modifier")).toHaveValue("2");
  await editor.getByLabel("Name", { exact: true }).fill("Bog Wight");
  await editor.getByRole("button", { name: "+ Add feature" }).click();
  const feature = editor.getByRole("group", { name: "Feature 1" });
  await feature.getByLabel("Feature name").fill("Grasping Mire");
  await feature.getByLabel("Kind").selectOption("action");
  await feature.getByLabel("Fear cost").fill("1");
  await feature.getByLabel("Feature text").fill("Spend a Fear to make every target within Close range Restrained.");
  await expect(editor.getByRole("article", { name: "Bog Wight stat block" }).getByText("Fear 1")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  // A wrong value is caught before saving.
  await editor.getByLabel("HP", { exact: true }).fill("0");
  await editor.getByRole("button", { name: "Save adversary" }).click();
  await expect(editor.getByRole("alert")).toHaveText("HP must be a whole number from 1 to 30.");
  await editor.getByLabel("HP", { exact: true }).fill("6");
  await editor.getByRole("button", { name: "Save adversary" }).click();
  await expect(editor).toBeHidden();
  await expect(custom.getByRole("article", { name: "Bog Wight stat block" }).getByText("Tier 2 Standard")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
});
