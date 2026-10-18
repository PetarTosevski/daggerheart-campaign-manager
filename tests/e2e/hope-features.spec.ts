import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";

const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

/** A level-1 Rogue: Rapier, Gambeson, two level-1 Grace/Midnight cards. */
function rogueDraft(name: string) {
  return {
    classId: "rogue",
    subclassId: "nightwalker",
    ancestry: { kind: "single", id: "elf" },
    communityId: "loreborne",
    traits: { agility: 2, strength: -1, finesse: 1, instinct: 0, presence: 1, knowledge: 0 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: "rapier",
    armorId: "gambeson-armor",
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Cutpurse", "Rooftop runner"],
    domainCards: ["deft-deceiver", "pick-and-pull"],
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

test("a Rogue spends 3 Hope on Rogue's Dodge, Evasion shows +2, and Got hit removes it", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const campaign = unique("Dodge");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(campaign);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: campaign })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;

  // Seed the character and its Hope through the API; the UI is for the feature.
  const client = await convexAs(page);
  const hero = unique("Vex");
  const { characterId } = await client.mutation(api.characters.create, { campaignId, draft: rogueDraft(hero), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.adjustResource, { characterId, resource: "hope", delta: 1 }); // 2 → 3

  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await expect(page.getByRole("heading", { level: 1, name: hero })).toBeVisible();
  const evasion = page.getByTestId("evasion");
  const base = Number(await evasion.textContent());

  const features = page.getByRole("region", { name: "Features" });
  await features.getByRole("button", { name: "Use Rogue’s Dodge" }).click();
  await expect(evasion).toHaveText(String(base + 2));
  await expect(page.getByText("(+2 effects)")).toBeVisible();
  await expect(page.getByRole("group", { name: "Hope: 0 of 6 marked" })).toBeVisible();
  await expect(features.getByRole("list", { name: "Active effects" })).toContainText("Rogue’s Dodge");

  await features.getByRole("button", { name: "Got hit" }).click();
  await expect(evasion).toHaveText(String(base));
  await expect(features.getByRole("list", { name: "Active effects" })).toHaveCount(0);
});
