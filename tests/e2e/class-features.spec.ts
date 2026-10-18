import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";

const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

const common = { pronouns: "", description: "", potion: "Minor Health Potion", classItem: "", background: [], connections: [] };

/** A level-1 Bard (Rally Die d6). */
const bardDraft = (name: string) => ({
  ...common,
  classId: "bard",
  subclassId: "troubadour",
  ancestry: { kind: "single", id: "elf" },
  communityId: "loreborne",
  traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
  name,
  primaryWeaponId: "rapier",
  armorId: "gambeson-armor",
  experiences: ["Wandering minstrel", "Silver tongue"],
  domainCards: ["deft-deceiver", "book-of-ava"],
});

/** A level-1 Warrior. */
const warriorDraft = (name: string) => ({
  ...common,
  classId: "warrior",
  subclassId: "call-of-the-brave",
  ancestry: { kind: "single", id: "elf" },
  communityId: "loreborne",
  traits: { agility: 2, strength: 1, finesse: 0, instinct: 1, presence: -1, knowledge: 0 },
  name,
  primaryWeaponId: "longsword",
  armorId: "chainmail-armor",
  experiences: ["Sellsword", "Brawler"],
  domainCards: ["get-back-up", "not-good-enough"],
});

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

test("a Bard rallies, a Warrior spends the Rally Die on a roll in the dice box, and ending the session clears unspent dice", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const campaign = unique("Rally");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(campaign);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: campaign })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;

  // Seed both characters through the API; the UI is for the features.
  const client = await convexAs(page);
  const bard = unique("Liriel");
  const warrior = unique("Brann");
  const { characterId: bardId } = await client.mutation(api.characters.create, { campaignId, draft: bardDraft(bard), idempotencyKey: crypto.randomUUID() });
  const { characterId: warriorId } = await client.mutation(api.characters.create, { campaignId, draft: warriorDraft(warrior), idempotencyKey: crypto.randomUUID() });

  // The Bard rallies: both PCs hold a d6 Rally Die.
  await page.goto(`/campaigns/${campaignId}/party/${bardId}`);
  await expect(page.getByRole("heading", { level: 1, name: bard })).toBeVisible();
  const bardFeatures = page.getByRole("region", { name: "Features" });
  await bardFeatures.getByRole("button", { name: "Use Rally", exact: true }).click();
  await expect(bardFeatures.getByText("rallied the party: 2 Rally Dice (d6)")).toBeVisible();
  await expect(bardFeatures.getByRole("list", { name: "Held dice" })).toContainText("Rally d6");

  // The Warrior spends it on an action roll: an extra d6 in the roll, and the die is gone.
  await page.goto(`/campaigns/${campaignId}/party/${warriorId}`);
  await expect(page.getByRole("heading", { level: 1, name: warrior })).toBeVisible();
  const warriorFeatures = page.getByRole("region", { name: "Features" });
  await expect(warriorFeatures.getByRole("list", { name: "Held dice" })).toContainText("Rally d6");
  const box = page.getByRole("region", { name: "Dice", exact: true });
  await box.getByLabel("Rally Die d6").check();
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByTestId("last-roll")).toBeVisible();
  await expect(box.getByRole("listitem", { name: /^Extra d6: \d$/ })).toHaveCount(1);
  await expect(warriorFeatures.getByRole("list", { name: "Held dice" })).toHaveCount(0);

  // The GM ends the session: the Bard's unspent die clears.
  await page.goto(`/campaigns/${campaignId}`);
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("dialog", { name: "End the session?" }).getByRole("button", { name: "End session" }).click();
  await expect(page.getByText("Session ended.")).toBeVisible();
  await page.goto(`/campaigns/${campaignId}/party/${bardId}`);
  await expect(page.getByRole("heading", { level: 1, name: bard })).toBeVisible();
  await expect(page.getByRole("region", { name: "Features" }).getByRole("button", { name: "Use Rally", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Features" }).getByRole("list", { name: "Held dice" })).toHaveCount(0);
});
