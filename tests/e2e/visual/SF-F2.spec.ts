import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { bardDraft, D10_VIEWPORTS, expectNoHorizontalScroll, openSessions, visual } from "./helpers";

// Session features F2 visual spec (E2E_VISUAL=1): the dice box's Slayer choice prompt, the '+ Slayer Dice' stepper
// (attack roll) and the '+ Tide tokens' stepper at 1440, 1024 and 390. Shots: test-results/visual/SF-F2/.

const action = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

function warriorDraft(name: string, subclassId: string, communityId: string) {
  return {
    ...bardDraft(name),
    classId: "warrior",
    subclassId,
    communityId,
    traits: { agility: 2, strength: 1, finesse: 0, instinct: 1, presence: -1, knowledge: 0 },
    primaryWeaponId: "longsword",
    armorId: "chainmail-armor",
    experiences: ["Sellsword", "Brawler"],
    domainCards: ["get-back-up", "not-good-enough"],
  };
}

test("SF-F2 dice box: Slayer prompt, Slayer and Tide steppers at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId } = await openSessions(page);
  const { characterId: slayer } = await client.mutation(api.characters.create, { campaignId, draft: warriorDraft("Bryn", "call-of-the-slayer", "wildborne"), idempotencyKey: crypto.randomUUID() });
  const { characterId: tide } = await client.mutation(api.characters.create, { campaignId, draft: warriorDraft("Kai", "call-of-the-brave", "seaborne"), idempotencyKey: crypto.randomUUID() });
  const { shoot } = visual(page, "SF-F2", D10_VIEWPORTS);

  // The prompt after a roll with Hope.
  const { entryId } = await client.mutation(api.rolls.manualRoll, { characterId: slayer, roll: action, values: [8, 3], idempotencyKey: crypto.randomUUID() });
  await page.goto(`/campaigns/${campaignId}/party/${slayer}`);
  const box = page.getByRole("region", { name: "Dice", exact: true });
  await expect(box.getByRole("group", { name: "Take the Hope or store a Slayer Die?" })).toBeVisible();
  await shoot(box, "slayer-prompt");
  await expectNoHorizontalScroll(page);

  // The Slayer stepper on an attack roll (one die stored).
  await client.mutation(api.rolls.storeSlayerDie, { characterId: slayer, entryId, idempotencyKey: crypto.randomUUID() });
  await box.getByText("Attack roll", { exact: true }).click();
  await expect(box.getByRole("group", { name: "Slayer Dice to spend" })).toBeVisible();
  await shoot(box, "slayer-stepper");

  // The Tide stepper (one token held).
  await client.mutation(api.rolls.manualRoll, { characterId: tide, roll: action, values: [3, 8], idempotencyKey: crypto.randomUUID() });
  await page.goto(`/campaigns/${campaignId}/party/${tide}`);
  const tideBox = page.getByRole("region", { name: "Dice", exact: true });
  await expect(tideBox.getByRole("group", { name: "Tide tokens to spend" })).toBeVisible();
  await shoot(tideBox, "tide-stepper");
  await expectNoHorizontalScroll(page);
});
