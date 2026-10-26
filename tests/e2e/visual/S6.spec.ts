import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { openSheet, visual } from "./helpers";

// S6: the Hope box with its hf block (Use pill, status, Active effects) and the Class Features box (cf rows,
// Full feature text), at 1440 and 390. Board counterparts: node scripts/board-shots.mjs hope class-features

test("S6 Hope and Class Features boxes at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  // A Rogue: Rogue's Dodge (Hope feature, an effect until hit) and Cloaked (a class action row).
  const { client, characterId, sheet } = await openSheet(page, {
    draft: {
      classId: "rogue",
      subclassId: "nightwalker",
      traits: { agility: 2, strength: -1, finesse: 1, instinct: 0, presence: 1, knowledge: 0 },
      experiences: ["Cutpurse", "Rooftop runner"],
      domainCards: ["deft-deceiver", "pick-and-pull"],
    },
  });
  const { shoot } = visual(page, "S6");
  const hope = sheet.getByRole("region", { name: "Hope", exact: true });
  const features = sheet.getByRole("region", { name: "Class Features" });

  await expect(hope.getByRole("button", { name: "Use Rogue’s Dodge · 3 Hope" })).toBeDisabled();
  await expect(hope.getByRole("status")).toHaveText("Needs 3 Hope.");
  await shoot(hope, "hope");

  // Spend 3 Hope on Rogue's Dodge: an Active effects row with its End button.
  await client.mutation(api.characters.adjustResource, { characterId, resource: "hope", delta: 1 });
  await client.mutation(api.classFeatures.use, { characterId, featureKey: "roguesDodge", params: {}, idempotencyKey: crypto.randomUUID() });
  await expect(hope.getByRole("list", { name: "Active effects" })).toContainText("Rogue’s Dodge");
  await shoot(hope, "hope-effects");

  await features.getByText("Full feature text").click();
  await expect(features.getByRole("group", { name: "Cloaked" })).toBeVisible();
  await shoot(features, "class-features");
});
