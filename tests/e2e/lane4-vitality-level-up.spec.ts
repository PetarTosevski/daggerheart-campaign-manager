// Plan lanes-2, wave 10, tracer E8.4 (dcm-txlu, dcm-u9pv; docs/tasks/TASK-LN4-E8.md). Vitality (CB p.330): "When you
// choose this card, permanently gain two of the following benefits: • One Stress slot • One Hit Point slot • +2 bonus to
// your damage thresholds Then place this card in your vault permanently."
//
// The guided level-up asks for the two benefits once Vitality is chosen in the Domain Deck, sends them as `cardChoices`,
// and the sheet's thresholds then carry the +2. blade.ts Vitality becomes data in batch B (S1.4); until then the card has
// no "when you choose this card" use and this spec skips (it was run against the switched data before the commit).
import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardChoiceAsks } from "../../src/lib/domain/level-up/card-choices";
import { ANCESTRIES, ARMOR, cardsForDomains, COMMUNITIES, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd";
import { signInAsTestGm } from "./fixtures";

test.skip(cardChoiceAsks(["vitality"]).length === 0, "blade.ts Vitality is not data yet (S1.4 switches it)");

/** A valid level-1 Warrior (Blade and Bone). */
function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

async function clientFor(page: Page): Promise<ConvexHttpClient> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  expect(token, "Convex Auth token in localStorage").toBeTruthy();
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(token!);
  return client;
}

test("the level-up asks for Vitality's two benefits and the sheet counts them", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Vitality ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const dialog = page.getByRole("dialog", { name: "Name your campaign" });
  await dialog.getByLabel("Campaign name").fill(name);
  await dialog.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;

  // The GM's own character, levelled to 4 through the API (each level's card is a Blade / Bone card it doesn't hold).
  const client = await clientFor(page);
  const hero = `Brann ${crypto.randomUUID().slice(0, 6)}`;
  const { characterId } = await client.mutation(api.characters.create, { campaignId, draft: draft(hero), idempotencyKey: crypto.randomUUID() });
  const owned = new Set(draft(hero).domainCards);
  const cardFor = (level: number) => {
    const card = cardsForDomains(getClass("warrior")!.domains, level).find((c) => c.level <= level && c.source === "core" && !owned.has(c.id) && c.id !== "vitality")!;
    owned.add(card.id);
    return card.id;
  };
  const levels = [
    { picks: [{ option: "hp" as const, tier: 2 }, { option: "stress" as const, tier: 2 }], experienceName: "Grit", cardId: cardFor(2) },
    { picks: [{ option: "hp" as const, tier: 2 }, { option: "stress" as const, tier: 2 }], cardId: cardFor(3) },
    { picks: [{ option: "evasion" as const, tier: 2 }, { option: "traits" as const, tier: 2, targets: ["agility", "strength"] }], cardId: cardFor(4) },
  ];
  for (const choice of levels) await client.mutation(api.levelUp.apply, { characterId, choice, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: crypto.randomUUID() });

  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await expect(page.getByRole("img", { name: "Level 4" })).toBeVisible();
  const major = Number((await page.getByTestId("threshold-major").textContent())!.replace(/\D/g, ""));
  const severe = Number((await page.getByTestId("threshold-severe").textContent())!.replace(/\D/g, ""));

  // Level 5: name the Experience, take two Tier 3 picks, choose Vitality in the deck.
  await page.getByRole("button", { name: "Level up to 5" }).click();
  const ribbon = page.getByRole("region", { name: "Level-up to 5" });
  await expect(ribbon).toBeVisible();
  await page.getByRole("textbox", { name: "New Experience (+2) for level 5" }).fill("Unbreakable");
  await ribbon.getByRole("button", { name: "Next" }).click();
  const levelUp = page.getByRole("region", { name: "Level Up" });
  await levelUp.getByRole("checkbox", { name: "Tier 3: +1 Hit Point slot for level 5" }).check();
  await levelUp.getByRole("checkbox", { name: "Tier 3: +1 Stress slot for level 5" }).click();
  const deck = page.getByRole("region", { name: "Domain Deck" });
  await expect(deck.getByRole("heading", { name: "Domain Deck" })).toBeFocused();
  await deck.getByRole("button", { name: "Choose Vitality for level 5" }).click();

  // The card's picks: Finish waits for exactly two.
  const picks = page.getByRole("group", { name: /Vitality: Two benefits \(choose 2\)/ });
  await expect(picks).toBeVisible();
  await expect(ribbon.getByRole("button", { name: "Vitality: choose 2 (Two benefits)." })).toBeVisible();
  await expect(ribbon.getByRole("button", { name: "Finish level-up" })).toBeDisabled();
  await picks.getByRole("checkbox", { name: "One Hit Point slot" }).check();
  await picks.getByRole("checkbox", { name: "+2 to your damage thresholds" }).check();
  await expect(picks.getByRole("checkbox", { name: "One Stress slot" })).toBeDisabled();
  await expect(ribbon.getByText("Everything is chosen. Finish to level up.")).toBeVisible();
  await ribbon.getByRole("button", { name: "Finish level-up" }).click();
  await expect(ribbon).toBeHidden();

  // Level 5 adds +1 to the thresholds and Vitality +2.
  await expect(page.getByRole("img", { name: "Level 5" })).toBeVisible();
  await page.getByRole("tab", { name: "Character Sheet", exact: true }).click();
  await expect(page.getByTestId("threshold-major")).toHaveText(`Major ${major + 3}`);
  await expect(page.getByTestId("threshold-severe")).toHaveText(`Severe ${severe + 3}`);
  const view = await client.query(api.charactersReads.get, { characterId });
  const sheet = view!.sheet as { slotBonuses?: string[]; domainCards: { owned: string[]; loadout: string[] } };
  expect(sheet.slotBonuses).toEqual(expect.arrayContaining(["card:vitality:hp+1", "card:vitality:major+2", "card:vitality:severe+2"]));
  expect(sheet.domainCards.owned).toContain("vitality");
  expect(sheet.domainCards.loadout).not.toContain("vitality");
});
