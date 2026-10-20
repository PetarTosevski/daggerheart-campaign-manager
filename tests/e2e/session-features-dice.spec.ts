import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bardDraft, openSessions } from "./visual/helpers";

// Session features in the dice box (plan session-features F2): the Slayer choice after a roll with Hope (U2), Slayer
// Dice spent on a damage roll (U3), a Know the Tide token placed by a roll with Fear (U4) and spent for +1 (U5), and
// no Tide stepper for a character without Know the Tide. Fixed dice come through the server's manual roll.

const action = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

/** A level 1 Warrior; `subclassId` and `communityId` pick the session feature. */
function warriorDraft(name: string, subclassId: string, communityId: string) {
  return {
    ...bardDraft(name),
    classId: "warrior",
    subclassId,
    ancestry: { kind: "single", id: "elf" },
    communityId,
    traits: { agility: 2, strength: 1, finesse: 0, instinct: 1, presence: -1, knowledge: 0 },
    primaryWeaponId: "longsword",
    armorId: "chainmail-armor",
    experiences: ["Sellsword", "Brawler"],
    domainCards: ["get-back-up", "not-good-enough"],
  };
}

const diceBox = (page: Page) => page.getByRole("region", { name: "Dice", exact: true });

test("a Slayer stores a Slayer Die and spends it on a damage roll; a Seaborne PC gains and spends a Tide token", async ({ page }) => {
  const { client, campaignId } = await openSessions(page);
  const slayerName = `Bryn ${crypto.randomUUID().slice(0, 6)}`;
  const tideName = `Kai ${crypto.randomUUID().slice(0, 6)}`;
  const { characterId: slayer } = await client.mutation(api.characters.create, { campaignId, draft: warriorDraft(slayerName, "call-of-the-slayer", "wildborne"), idempotencyKey: crypto.randomUUID() });
  const { characterId: tide } = await client.mutation(api.characters.create, { campaignId, draft: warriorDraft(tideName, "call-of-the-brave", "seaborne"), idempotencyKey: crypto.randomUUID() });
  const hopeOf = async (id: Id<"characters">) => (await client.query(api.characters.get, { characterId: id }))!.sheet.hope;

  // The Slayer rolls with Hope (Hope 8, Fear 3): the box asks to take the Hope or store a Slayer Die.
  const hopeBefore = await hopeOf(slayer);
  await client.mutation(api.rolls.manualRoll, { characterId: slayer, roll: action, values: [8, 3], idempotencyKey: crypto.randomUUID() });
  await page.goto(`/campaigns/${campaignId}/party/${slayer}`);
  await expect(page.getByRole("heading", { level: 1, name: slayerName })).toBeVisible();
  const box = diceBox(page);
  // A character without Know the Tide never sees the Tide stepper (U5).
  await expect(box.getByRole("group", { name: "Tide tokens to spend" })).toHaveCount(0);
  const choice = box.getByRole("group", { name: "Take the Hope or store a Slayer Die?" });
  await expect(choice).toBeVisible();
  await choice.getByRole("button", { name: "Store a Slayer Die" }).click();
  await expect(choice).toHaveCount(0);
  expect(await hopeOf(slayer)).toBe(hopeBefore);

  // Damage roll with the stored die: the server rolls it and adds a "Slayer d6".
  await box.getByText("Damage", { exact: true }).click();
  const slayerStepper = box.getByRole("group", { name: "Slayer Dice to spend" });
  await expect(slayerStepper).toBeVisible();
  await expect(box.getByText("1 held", { exact: true })).toBeVisible();
  await slayerStepper.getByRole("button", { name: "Increase Slayer Dice to spend" }).click();
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByTestId("last-roll")).toContainText("Slayer d6");
  await expect(box.getByRole("listitem", { name: /^Slayer d6: \d$/ })).toHaveCount(1);
  // The pool is empty now, so the stepper is gone.
  await expect(slayerStepper).toHaveCount(0);

  // The Seaborne PC rolls with Fear (Hope 3, Fear 8): one token, spent for +1 on the next action roll.
  await client.mutation(api.rolls.manualRoll, { characterId: tide, roll: action, values: [3, 8], idempotencyKey: crypto.randomUUID() });
  await page.goto(`/campaigns/${campaignId}/party/${tide}`);
  await expect(page.getByRole("heading", { level: 1, name: tideName })).toBeVisible();
  const tideBox = diceBox(page);
  const tideStepper = tideBox.getByRole("group", { name: "Tide tokens to spend" });
  await expect(tideStepper).toBeVisible();
  await expect(tideBox.getByText("1 held (+1 each)")).toBeVisible();
  await tideStepper.getByRole("button", { name: "Increase Tide tokens to spend" }).click();
  await tideBox.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(tideBox.getByTestId("last-roll")).toContainText("Know the Tide +1");
  // The stepper resets after the roll; the Slayer stepper never shows for a non-Slayer.
  await expect(tideStepper.locator("output")).toHaveText("0");
  await expect(tideBox.getByRole("group", { name: "Slayer Dice to spend" })).toHaveCount(0);
});
