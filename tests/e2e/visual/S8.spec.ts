import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { DOMAIN_CARDS } from "../../../src/lib/srd/domain-cards";
import { openSheet, openTab, visual } from "./helpers";

// S8: level circle (▲ / −), the guided level-up ribbon that ▲ starts (GL0 replaced the stepper dialog) and the
// Level Up tier boxes at 1440 and 390. The ribbon's choosers live in the sections (GL1-GL3), so the level-up for
// the later shots goes through the API.
// Board counterparts: node scripts/board-shots.mjs level-circle level-up-head level-up

test("S8 level circle, level-up ribbon and advancement tiers at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { sheet, client, characterId } = await openSheet(page);
  const { shoot } = visual(page, "S8");

  const circle = sheet.locator(".lvl-row");
  await expect(sheet.getByRole("button", { name: "Level up to 2" })).toBeVisible();
  await shoot(circle, "level-circle");

  await sheet.getByRole("button", { name: "Level up to 2" }).click();
  const ribbon = sheet.getByRole("region", { name: "Level-up to 2" });
  await expect(ribbon.getByRole("list", { name: "Level-up steps" })).toBeVisible();
  await shoot(ribbon, "ribbon");
  await ribbon.getByRole("button", { name: "Cancel" }).click();
  await expect(ribbon).toBeHidden();

  const card = DOMAIN_CARDS.find((c) => c.domain === "grace" && c.level === 1 && c.source === "core" && c.id !== "deft-deceiver")!;
  await client.mutation(api.levelUp.apply, {
    characterId,
    choice: {
      picks: [
        { option: "hp", tier: 2 },
        { option: "stress", tier: 2 },
      ],
      cardId: card.id,
      experienceName: "Never misses a cue",
    },
    idempotencyKey: crypto.randomUUID(),
  });

  await expect(sheet.getByRole("button", { name: "Undo level 2" })).toBeVisible();
  await shoot(circle, "level-circle-undo");

  await openTab(page, "Story & Advancement");
  const levelUp = sheet.getByRole("region", { name: "Level Up" });
  await expect(levelUp.getByText("2 / 2 advancements used")).toBeVisible();
  await shoot(levelUp.locator(".adv-head"), "level-up-head");
  await shoot(levelUp, "level-up");
  await shoot(sheet.locator(".adv-correct"), "correct-level");
});
