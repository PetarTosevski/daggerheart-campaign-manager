import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";

/** A level-1 Bard with 5 Hit Points. */
function bardDraft(name: string) {
  return {
    classId: "bard",
    subclassId: "troubadour",
    ancestry: { kind: "single", id: "elf" },
    communityId: "loreborne",
    traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: "rapier",
    armorId: "gambeson-armor",
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Wandering minstrel", "Silver tongue"],
    domainCards: ["deft-deceiver", "book-of-ava"],
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

test("a character at their last Hit Point avoids death, and clearing a Hit Point wakes them", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const client = await convexAs(page);
  const name = `Wren ${crypto.randomUUID().slice(0, 8)}`;
  const { campaignId } = await client.mutation(api.campaigns.create, { frameId: "witherwild", name: `Death ${name}`, idempotencyKey: crypto.randomUUID() });
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId: campaignId as Id<"campaigns">,
    draft: bardDraft(name),
    idempotencyKey: crypto.randomUUID(),
  });
  await client.mutation(api.characters.adjustResource, { characterId, resource: "hp", delta: 5 });

  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  const dialog = page.getByRole("dialog", { name: "Death move" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Avoid Death" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("death-unconscious")).toHaveText("Unconscious");
  await expect(page.getByRole("status").filter({ hasText: /Hope Die \d+ against level 1/ })).toBeVisible();

  // An ally clears one Hit Point: the character wakes up.
  await page.getByRole("button", { name: "Hit Point 5 of 5" }).click();
  await expect(page.getByRole("group", { name: "Hit Point: 4 of 5 marked" })).toBeVisible();
  await expect(page.getByTestId("death-unconscious")).toHaveCount(0);
});
