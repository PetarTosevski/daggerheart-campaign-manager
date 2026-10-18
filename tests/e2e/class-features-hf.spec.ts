import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd";
import { signInAsTestGm } from "./fixtures";

const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

/** A level-1 Juggernaut Brawler with no weapon but Brawler's Strike. */
function brawlerDraft(name: string) {
  return {
    classId: "brawler",
    subclassId: "juggernaut",
    ancestry: { kind: "single", id: "elf" },
    communityId: "loreborne",
    traits: { agility: 1, strength: 2, finesse: 0, instinct: 1, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: "brawler-s-strike",
    armorId: "gambeson-armor",
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Bare-knuckle champion", "Dockhand"],
    domainCards: cardsForDomains(getClass("brawler")!.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
    connections: [],
  };
}

/** A Convex client authenticated as the page's signed-in user. */
async function convexAs(page: Page): Promise<ConvexHttpClient> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  expect(token, "Convex Auth token in localStorage").toBeTruthy();
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(token!);
  return client;
}

test("a Brawler without a weapon rolls Brawler's Strike damage with Proficiency-many d8 and d6", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const campaign = unique("Brawl");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(campaign);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: campaign })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;

  // Seed through the API: Hope & Fear on, the Brawler, and level 2 (Proficiency 2, CB 109) so both dice visibly scale.
  const client = await convexAs(page);
  await client.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const hero = unique("Knuckles");
  const { characterId } = await client.mutation(api.characters.create, { campaignId, draft: brawlerDraft(hero), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.levelUp.apply, {
    characterId,
    choice: {
      picks: [
        { option: "traits", tier: 2, targets: ["agility", "instinct"] },
        { option: "hp", tier: 2 },
      ],
      experienceName: "Never Stays Down",
      cardId: cardsForDomains(getClass("brawler")!.domains, 2).find((c) => c.level === 2)!.id,
    },
    idempotencyKey: crypto.randomUUID(),
  });

  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await expect(page.getByRole("heading", { level: 1, name: hero })).toBeVisible();
  const box = page.getByRole("region", { name: "Dice", exact: true });
  await box.getByText("Damage", { exact: true }).click();
  await box.getByLabel("Damage source").selectOption({ label: "Brawler’s Strike (I Am the Weapon)" });
  await box.getByRole("button", { name: "Roll", exact: true }).click();

  const last = box.getByRole("region", { name: "Last roll" });
  await expect(last.getByTestId("last-roll")).toBeVisible();
  const faces = last.getByRole("list", { name: "Dice" });
  await expect(faces.getByRole("listitem", { name: /^Damage d8: / })).toHaveCount(2);
  await expect(faces.getByRole("listitem", { name: /^Damage d6: / })).toHaveCount(2);
});
