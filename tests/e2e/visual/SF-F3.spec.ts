import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../../src/lib/srd";
import { bardDraft, D10_VIEWPORTS, openSheet, visual } from "./helpers";

// Session features F3 visual spec (E2E_VISUAL=1): the Lunar Phases section with no die and with each phase highlighted
// once (seeded dice 1, 2, 4, 5), the Class Features chips (moon die, Slayer Dice, Tide tokens) and the damage
// calculator's New Moon button, at 1440, 1024 and 390. Shots: test-results/visual/SF-F3/. No board counterpart (the
// boards predate Lunar Phases); the section follows the sheet's own look (sh-box, ft-pill, hf-use).

type Seed = { characterId: string; subclassRank?: "mastery"; level?: number; hope?: number; slayerDice?: number; tideTokens?: number; moonDie?: number };

/** Seeds a sheet on the local e2e backend through the internal sessionFeatures:seedForE2e. */
function seed(args: Seed): void {
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "run", "sessionFeatures:seedForE2e", JSON.stringify(args)], { stdio: "pipe" });
}

const witch = {
  classId: "witch",
  subclassId: "moon",
  traits: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 0 },
  primaryWeaponId: "dagger",
  experiences: ["Night walker", "Herbalist"],
  domainCards: cardsForDomains(getClass("witch")!.domains, 1)
    .filter((c) => c.level === 1)
    .slice(0, 2)
    .map((c) => c.id),
};

test("SF-F3 Lunar Phases, Class Features chips and the New Moon damage button at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  // openSheet makes a Bard first (the campaign starts without Hope & Fear); the Witch comes after the option is on.
  const { client, campaignId } = await openSheet(page, { draft: { name: "Liriel" } });
  await client.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const { characterId } = await client.mutation(api.characters.create, { campaignId, draft: { ...bardDraft("Mira"), ...witch }, idempotencyKey: crypto.randomUUID() });
  seed({ characterId, subclassRank: "mastery", level: 7, hope: 3 });
  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  const sheet = page.getByRole("article", { name: "Mira" });
  await expect(sheet.getByRole("heading", { level: 1, name: "Mira" })).toBeVisible();
  const lunar = sheet.getByRole("region", { name: "Lunar Phases" });
  const features = sheet.getByRole("region", { name: "Class Features" });
  const { shoot } = visual(page, "SF-F3", D10_VIEWPORTS);

  await expect(lunar).toContainText("No moon die: rolled when the session starts.");
  await shoot(lunar, "lunar-no-die");

  for (const [die, phase] of [[1, "new"], [2, "waxing"], [4, "full"], [5, "waning"]] as const) {
    seed({ characterId, moonDie: die });
    await expect(lunar.getByLabel(`Moon die ${die}`)).toBeVisible();
    await shoot(lunar, `lunar-${phase}`);
  }

  // Used this rest: the button disabled with its reason.
  await lunar.getByRole("button", { name: /Spend a Hope: \+1 to the moon die/ }).click();
  await expect(lunar).toContainText("Used this rest; it refreshes after a rest.");
  await shoot(lunar, "lunar-used");

  // Chips: the moon die on the Witch; Slayer Dice and Tide tokens on a Seaborne Call of the Slayer Warrior.
  seed({ characterId, moonDie: 1, hope: 3 });
  await expect(features.getByRole("list", { name: "Session features" })).toContainText("Moon die 1: New");
  await shoot(features, "chips-moon");

  const take = sheet.getByRole("group", { name: "Take damage" });
  await take.getByLabel("Damage roll").fill("1");
  await expect(take.getByRole("button", { name: "Spend a Hope to negate this Minor damage" })).toBeVisible();
  await shoot(take, "damage-new-moon");

  const { characterId: brynId } = await client.mutation(api.characters.create, {
    campaignId,
    draft: {
      classId: "warrior",
      subclassId: "call-of-the-slayer",
      ancestry: { kind: "single", id: "elf" },
      communityId: "seaborne",
      traits: { agility: 2, strength: 1, finesse: 0, instinct: 1, presence: -1, knowledge: 0 },
      name: "Bryn",
      pronouns: "",
      description: "",
      primaryWeaponId: "longsword",
      armorId: "chainmail-armor",
      potion: "Minor Health Potion",
      classItem: "",
      background: [],
      experiences: ["Sellsword", "Brawler"],
      domainCards: ["get-back-up", "not-good-enough"],
      connections: [],
    },
    idempotencyKey: crypto.randomUUID(),
  });
  seed({ characterId: brynId, level: 3, slayerDice: 1, tideTokens: 2 });
  await page.goto(`/campaigns/${campaignId}/party/${brynId as Id<"characters">}`);
  const bryn = page.getByRole("article", { name: "Bryn" });
  const brynFeatures = bryn.getByRole("region", { name: "Class Features" });
  await expect(brynFeatures.getByRole("list", { name: "Session features" })).toContainText("Tide tokens 2/3");
  await expect(bryn.getByRole("region", { name: "Lunar Phases" })).toHaveCount(0);
  await shoot(brynFeatures, "chips-slayer-tide");
});
