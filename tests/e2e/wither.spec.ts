import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";

const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

/** A level-1 Bard: Gambeson (5/11), so Severe is 12 or more. */
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

async function createCharacter(page: Page, campaignId: string, name: string): Promise<string> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  expect(token, "Convex Auth token in localStorage").toBeTruthy();
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(token!);
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId: campaignId as Id<"campaigns">,
    draft: bardDraft(name),
    idempotencyKey: crypto.randomUUID(),
  });
  return characterId;
}

test("Witherwild: Severe Withered damage gives a Wither token, and ending the session turns it into GM Fear", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Wither");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2];

  const hero = unique("Thorn");
  const characterId = await createCharacter(page, campaignId, hero);
  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await expect(page.getByRole("heading", { level: 1, name: hero })).toBeVisible();
  const tokens = page.getByTestId("wither-tokens");
  await expect(tokens).toHaveText("0");

  // The Fear Die (d12) at or below the tokens scars and clears them, so repeat until a token stays.
  for (let attempt = 0; attempt < 10 && (await tokens.textContent()) === "0"; attempt++) {
    await page.getByPlaceholder("Roll").fill("13");
    await page.getByLabel("Withered source").check();
    await expect(page.getByText("Severe damage: mark 3 Hit Points. Withered: gain a Wither token and roll the Fear Die.")).toBeVisible();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(/^Withered: /)).toBeVisible();
  }
  const count = Number(await tokens.textContent());
  expect(count).toBeGreaterThan(0);

  await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByRole("button", { name: "Fear 1 of 12" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(`Wither ${count}`)).toBeVisible();

  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("dialog", { name: "Start the session?" }).getByRole("button", { name: "Start session" }).click();
  await expect(page.getByText("Session started.")).toBeVisible();

  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("dialog", { name: "End the session?" }).getByRole("button", { name: "End session" }).click();
  await expect(page.getByText(`${count} Wither token${count === 1 ? "" : "s"} → +${count} Fear.`)).toBeVisible();
  await expect(page.getByRole("button", { name: `Fear ${count} of 12` })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: `Fear ${count + 1} of 12` })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(`Wither ${count}`)).toBeHidden();
});
