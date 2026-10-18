import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

function bardDraft(name: string) {
  return {
    classId: "bard",
    subclassId: "troubadour",
    ancestry: { kind: "single", id: "elf" },
    communityId: "loreborne",
    traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
    name,
    pronouns: "she/her",
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

/** The GM creates a campaign, a player joins it by code and creates a Bard through the API. */
async function campaignWithPlayer(page: Page, browser: Browser) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Dice");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2]!;

  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();

  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name })).toBeVisible();

  const hero = unique("Liriel");
  const { characterId } = await (await convexAs(player)).mutation(api.characters.create, {
    campaignId: campaignId as Id<"campaigns">,
    draft: bardDraft(hero),
    idempotencyKey: crypto.randomUUID(),
  });
  return { campaignId, hero, characterId, player, close: () => context.close() };
}

const feedOf = (page: Page) => page.getByRole("list", { name: "Rolls" });

test("a player rolls from the sheet and the GM and player see it in the feed", async ({ page, browser }) => {
  const { campaignId, hero, characterId, player, close } = await campaignWithPlayer(page, browser);
  await player.goto(`/campaigns/${campaignId}/party/${characterId}`);
  const box = player.getByRole("region", { name: "Dice", exact: true });
  await box.getByLabel("Trait").selectOption("presence");
  await box.getByLabel("Difficulty").fill("12");
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByTestId("last-roll")).toContainText("Presence +2 action roll vs 12");
  await expect(box.getByText(/^GM Fear \d+$/)).toBeVisible();
  // A second roll moves the first into the "Earlier" list.
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByRole("list", { name: "Earlier" }).getByRole("listitem")).toHaveCount(1);

  await page.goto(`/campaigns/${campaignId}`);
  await expect(feedOf(page).getByRole("listitem").filter({ hasText: `${hero}: Presence action roll` })).toHaveCount(2);
  await player.goto(`/campaigns/${campaignId}`);
  await expect(feedOf(player).getByRole("listitem").filter({ hasText: `${hero}: Presence action roll` })).toHaveCount(2);
  await close();
});

test("a GM free roll is hidden from the player until revealed", async ({ page, browser }) => {
  const { campaignId, hero, characterId, player, close } = await campaignWithPlayer(page, browser);
  // A public roll first, so the player's feed is loaded when the secret one lands.
  await (await convexAs(player)).mutation(api.rolls.manualRoll, {
    characterId: characterId as Id<"characters">,
    roll: { kind: "reaction", trait: "agility", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] },
    values: [4, 4],
    idempotencyKey: crypto.randomUUID(),
  });
  await page.goto(`/campaigns/${campaignId}`);
  await player.goto(`/campaigns/${campaignId}`);
  await expect(feedOf(player).getByRole("listitem").filter({ hasText: hero })).toBeVisible();

  const label = unique("Ambush");
  const form = page.getByRole("form", { name: "GM roll" });
  await form.getByLabel("For").fill(label);
  await form.getByRole("button", { name: "Roll in secret" }).click();
  const secret = feedOf(page).getByRole("listitem").filter({ hasText: label });
  await expect(secret.getByText("hidden")).toBeVisible();
  await expect(feedOf(player).getByRole("listitem").filter({ hasText: label })).toHaveCount(0);

  await secret.getByRole("button", { name: "Reveal" }).click();
  await expect(feedOf(player).getByRole("listitem").filter({ hasText: label })).toBeVisible();
  await expect(secret.getByText("hidden")).toHaveCount(0);
  await close();
});

test("a manual entry shows \"manual\", and undoing a Fear roll lowers GM Fear", async ({ page, browser }) => {
  const { campaignId, hero, characterId, player, close } = await campaignWithPlayer(page, browser);
  await player.goto(`/campaigns/${campaignId}/party/${characterId}`);
  const box = player.getByRole("region", { name: "Dice", exact: true });
  await box.getByLabel("Enter physical dice").check();
  await box.getByLabel("Hope die (d12)").fill("3");
  await box.getByLabel("Fear die (d12)").fill("8");
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByTestId("last-roll")).toContainText("manual");

  await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByRole("button", { name: "Fear 1 of 12" })).toHaveAttribute("aria-pressed", "true");
  const row = feedOf(page).getByRole("listitem").filter({ hasText: `${hero}: Agility action roll` });
  await expect(row.getByText("manual", { exact: true })).toBeVisible();

  await row.getByRole("button", { name: "Undo" }).click();
  await expect(row.getByText("undone")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fear 1 of 12" })).toHaveAttribute("aria-pressed", "false");
  await close();
});
