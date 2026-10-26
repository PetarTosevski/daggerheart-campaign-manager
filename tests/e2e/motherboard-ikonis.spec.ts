import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd/index";
import { signInAsTestGm } from "./fixtures";

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

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

test("a Motherboard Warrior gets an Ikonis with a Force augment and no weapon picker (CB 295, 301)", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Ikonis ${Date.now().toString(36)}`;
  await page.goto("/frames/motherboard");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2];

  await page.goto(`/campaigns/${campaignId}/party/new`);
  await page.getByRole("radio", { name: /^Warrior/ }).check();
  await page.getByRole("radio", { name: "Call of the Brave", exact: true }).check();
  await next(page);
  await page.getByRole("radio", { name: "Dwarf", exact: true }).check();
  await page.getByRole("radio", { name: "Ridgeborne", exact: true }).check();
  await next(page);
  await page.getByRole("button", { name: "Use suggested" }).click();
  await next(page);
  await page.getByLabel("Character name").fill("Vex Coilhand");
  await next(page);

  // Step 5: the Ikonis replaces the weapon pickers.
  await expect(page.getByRole("group", { name: "Primary weapon" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Secondary weapon/ })).toHaveCount(0);
  await expect(page.getByText(/Still needed: an Ikonis trait/)).toBeVisible();
  await expect(page.getByText(/Ikonis Training gives you a Force augment/)).toBeVisible();
  await page.getByLabel("Ikonis name").fill("Spark rod");
  await page.getByLabel("Ikonis trait").selectOption("strength");
  await page.getByLabel("Ikonis range and damage").selectOption("Melee");
  await page.getByLabel("Ikonis damage type").selectOption("tech");
  await page.getByRole("button", { name: "Use suggested armor" }).click();
  await page.getByRole("radio", { name: /Minor Health Potion/ }).check();
  await page.getByRole("group", { name: "Class item" }).getByRole("radio").first().check();
  await next(page);
  await next(page);
  await page.getByLabel("First Experience").fill("Scavenger");
  await page.getByLabel("Second Experience").fill("Tinker");
  await next(page);
  const cards = page.getByRole("checkbox", { name: /^Choose / });
  await cards.nth(0).check();
  await cards.nth(1).check();
  await next(page);
  await page.getByRole("button", { name: "Create character" }).click();

  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/party/(?!new$)[a-z0-9]+$`));
  // The frame extras region: one paper box for the Motherboard module, with the frame name as kicker.
  const ikonisModule = page.getByTestId("character-extras").getByRole("region", { name: "Ikonis Module" });
  await expect(ikonisModule.getByText("Motherboard", { exact: true })).toBeVisible();
  await expect(ikonisModule.getByTestId("ikonis-augments")).toHaveText(/Installed augments: Force/);
  await expect(ikonisModule.getByTestId("ikonis-damage")).toContainText("Melee · d12+2 tech");
  const augments = ikonisModule.getByRole("region", { name: "Augments" });
  await expect(augments.getByRole("img", { name: "Augment slots: 1 of 2 used" })).toBeVisible();

  // CB 301: swaps only during downtime. No rest is open, so Uninstall is disabled until the GM starts one.
  await expect(augments.getByText("Swap installed augments while the party rests (downtime).")).toBeVisible();
  await expect(augments.getByRole("button", { name: "Uninstall" })).toBeDisabled();
  const client = await convexAs(page);
  await client.mutation(api.rests.start, { campaignId: campaignId as Id<"campaigns">, kind: "short", idempotencyKey: crypto.randomUUID() });
  await augments.getByRole("button", { name: "Uninstall" }).click();
  await expect(augments.getByRole("img", { name: "Augment slots: 0 of 2 used" })).toBeVisible();

  // CB 301-302: a Network tether in the inventory, and Wealth in quantum (5 to start) instead of gold.
  await page.getByRole("tab", { name: "Story & Advancement", exact: true }).click();
  const wealth = page.getByRole("region", { name: "Wealth" });
  await expect(wealth.getByRole("group", { name: "Quantum" })).toContainText("5");
  await expect(wealth.getByRole("group", { name: "Handfuls of gold" })).toHaveCount(0);
  await wealth.getByRole("button", { name: "Increase Quantum" }).click();
  await expect(wealth.getByRole("group", { name: "Quantum" })).toContainText("6");
  await expect(page.getByRole("list", { name: "Inventory" })).toContainText("Network tether");
});

test("a remnant companion has a six-box Corruption Track the GM can repair (CB 295)", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Remnant ${Date.now().toString(36)}`;
  await page.goto("/frames/motherboard");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;

  const client = await convexAs(page);
  const ranger = getClass("ranger")!;
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId,
    draft: {
      classId: "ranger",
      subclassId: "beastbound",
      ancestry: { kind: "single", id: "elf" },
      communityId: "loreborne",
      traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
      name: "Ash",
      pronouns: "",
      description: "",
      primaryWeaponId: "",
      armorId: "gambeson-armor",
      potion: "Minor Health Potion",
      classItem: "",
      background: [],
      experiences: ["Scavenger", "Tinker"],
      domainCards: cardsForDomains(ranger.domains, 1)
        .filter((c) => c.level === 1)
        .slice(0, 2)
        .map((c) => c.id),
      connections: [],
    },
    ikonis: { name: "Spark rod", description: "", trait: "agility", range: "Far", damageType: "physical" },
    idempotencyKey: crypto.randomUUID(),
  });

  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await page.getByRole("button", { name: "Companion", exact: true }).click();
  const track = page.getByRole("region", { name: "Corruption Track" });
  await expect(track.getByRole("img", { name: /^Corruption:/ })).toHaveCount(0);
  // The checkbox follows the server's state, so it turns checked once the mutation lands.
  await track.getByRole("checkbox", { name: "This companion is a remnant" }).click();
  await expect(track.getByRole("checkbox", { name: "This companion is a remnant" })).toBeChecked();
  await expect(track.getByRole("img", { name: "Corruption: 0 of 6 marked" })).toBeVisible();
  // The GM sees the repair; with nothing marked it is disabled.
  await expect(track.getByRole("button", { name: "Repair (clear 1d4)" })).toBeDisabled();
  await expect
    .poll(async () => (await client.query(api.characterExtras.corruption, { characterId }))?.remnant)
    .toBe(true);
});
