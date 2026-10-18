import { expect, test } from "@playwright/test";

import { cardsForDomains, getClass } from "../../../src/lib/srd/index";
import { openSheet, visual } from "./helpers";

// S4: Active Weapons and Active Armor at 1440 and 390, plus an app-only Motherboard shot (the Ikonis block).
// Board counterparts: node scripts/board-shots.mjs weapons armor

test("S4 Active Weapons and Active Armor", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page);
  const { shoot } = visual(page, "S4");
  await shoot(sheet.getByRole("region", { name: "Active Weapons" }), "weapons");
  await shoot(sheet.getByRole("region", { name: "Active Armor" }), "armor");
});

test("S4 Motherboard Ikonis in the Active Weapons box", { tag: "@visual" }, async ({ page }) => {
  const warrior = getClass("warrior")!;
  const { sheet } = await openSheet(page, {
    frame: "motherboard",
    draft: {
      name: "Vex",
      classId: "warrior",
      subclassId: "call-of-the-brave",
      traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
      primaryWeaponId: "",
      domainCards: cardsForDomains(warrior.domains, 1)
        .filter((c) => c.level === 1)
        .slice(0, 2)
        .map((c) => c.id),
    },
    extra: { ikonis: { name: "Spark rod", description: "", trait: "strength", range: "Melee", damageType: "physical" } },
  });
  await expect(sheet.getByTestId("ikonis-weapon")).toContainText("Spark rod");
  await visual(page, "S4").shoot(sheet.getByRole("region", { name: "Active Weapons" }), "motherboard-weapons");
});
