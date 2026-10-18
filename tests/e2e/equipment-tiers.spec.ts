import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";

const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;
const TIER_3 = "Advanced Broadsword (Tier 3)";

/** T2's GM correction (decision 4): sets the level directly, no automation. */
const correctLevel = makeFunctionReference<"mutation", { characterId: string; level: number; idempotencyKey: string }>("levelUp:correctLevel");

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

/** A Witherwild campaign (core equipment only) with a level-1 Guardian on a Broadsword. */
async function setup(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Tiers");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2]!;
  const client = await convexAs(page);
  const hero = unique("Bram");
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId: campaignId as Id<"campaigns">,
    draft: {
      classId: "guardian",
      subclassId: "stalwart",
      ancestry: { kind: "single", id: "dwarf" },
      communityId: "ridgeborne",
      traits: { agility: 1, strength: 2, finesse: 0, instinct: 1, presence: 0, knowledge: -1 },
      name: hero,
      pronouns: "he/him",
      description: "",
      primaryWeaponId: "broadsword",
      armorId: "chainmail-armor",
      potion: "Minor Health Potion",
      classItem: "",
      background: [],
      experiences: ["Shieldwall", "Stubborn"],
      domainCards: ["i-am-your-shield", "bare-bones"],
      connections: [],
    },
    idempotencyKey: crypto.randomUUID(),
  });
  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await expect(page.getByRole("heading", { level: 1, name: hero })).toBeVisible();
  return { client, characterId };
}

test("a level-1 character cannot see a Tier 3 weapon", async ({ page }) => {
  await setup(page);
  const primary = page.getByLabel("Primary weapon");
  await expect(primary.getByRole("option", { name: "Broadsword (Tier 1)", exact: true })).toBeAttached();
  await expect(primary.getByRole("option", { name: TIER_3 })).toHaveCount(0);
  await expect(page.getByLabel("Active armor").getByRole("option", { name: /\(Tier [234]\)/ })).toHaveCount(0);
  // Stalwart foundation, Unwavering: chainmail 7/15 + level 1 + 1 (CB 36).
  await expect(page.getByTestId("threshold-major")).toHaveText("Major 9");
  await expect(page.getByTestId("threshold-severe")).toHaveText("Severe 17");
  // Page three: only the foundation card is unlocked at subclassRank foundation (CB 110).
  await page.getByRole("tab", { name: "Heritage & Story" }).click();
  await expect(page.getByRole("article", { name: "Subclass: Stalwart Foundation" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Subclass: Stalwart Specialization (locked)" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Subclass: Stalwart Mastery (locked)" })).toBeVisible();
});

test("a level-5 character can pick a Tier 3 weapon", async ({ page }) => {
  const { client, characterId } = await setup(page);
  await client.mutation(correctLevel, { characterId, level: 5, idempotencyKey: `level-5-${characterId}` });
  const primary = page.getByLabel("Primary weapon");
  await expect(primary.getByRole("option", { name: TIER_3 })).toBeAttached();
  await primary.selectOption({ label: TIER_3 });
  await expect(page.getByTestId("primary-damage")).toHaveText(/d8\+6 phy$/);
  await page.reload();
  await expect(page.getByLabel("Primary weapon")).toHaveValue("advanced-broadsword");
});
