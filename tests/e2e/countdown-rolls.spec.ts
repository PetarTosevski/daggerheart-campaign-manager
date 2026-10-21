import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";

// countdowns-advanced K1: the GM applies a player's action roll to an unarmed countdown from the roll feed
// ("Tick countdowns"), the row then shows it ticked, and the player's undo takes the tick back (D5, D11, Q1 (c), Q5).

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
  const name = unique("Countdown rolls");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const { joinCode } = await (await convexAs(page)).query(api.members.access, { campaignId });

  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await (await convexAs(player)).mutation(api.members.joinByCode, { code: joinCode! });
  const hero = unique("Liriel");
  const { characterId } = await (await convexAs(player)).mutation(api.characters.create, { campaignId, draft: bardDraft(hero), idempotencyKey: crypto.randomUUID() });
  return { campaignId, hero, characterId, player, close: () => context.close() };
}

const feedOf = (page: Page) => page.getByRole("list", { name: "Rolls" });
const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

test("the GM ticks a countdown from a player's roll in the feed; the player's undo takes it back", async ({ page, browser }) => {
  const { campaignId, hero, characterId, player, close } = await campaignWithPlayer(page, browser);

  // 'Countdown 4' from the existing dialog: unarmed, so the roll doesn't tick it by itself.
  await page.getByRole("button", { name: "+ New countdown" }).click();
  const dialog = page.getByRole("dialog", { name: "New countdown" });
  await dialog.getByLabel("Countdown name").fill("The dam breaks");
  await dialog.getByLabel("What happens at zero").fill("The valley floods.");
  await dialog.getByRole("radio", { name: "4", exact: true }).click();
  await dialog.getByRole("button", { name: "Start at 4" }).click();
  const card = page.getByRole("article", { name: "The dam breaks" });
  await expect(card.getByTestId("countdown-value")).toHaveText("4/4");

  // The player's manual action roll with Hope (Hope 8, Fear 3).
  await (await convexAs(player)).mutation(api.rolls.manualRoll, { characterId, roll: agility, values: [8, 3], idempotencyKey: crypto.randomUUID() });
  const row = feedOf(page).getByRole("listitem").filter({ hasText: `${hero}: Agility action roll` });
  await expect(row).toBeVisible();
  await expect(card.getByTestId("countdown-value")).toHaveText("4/4");

  await row.getByRole("button", { name: /^Tick countdowns/ }).click();
  const tick = page.getByRole("dialog", { name: "Tick countdowns" });
  await expect(tick.getByText("success with Hope")).toBeVisible();
  const option = tick.getByRole("checkbox", { name: /The dam breaks/ });
  await expect(tick.getByRole("listitem").filter({ hasText: "The dam breaks" })).toContainText("−1");
  await option.check();
  await tick.getByRole("button", { name: "Apply" }).click();
  await expect(tick).toBeHidden();
  await expect(card.getByTestId("countdown-value")).toHaveText("3/4");

  // Reload so the server's state, not the optimistic one, is what we read; the row now shows it ticked.
  await page.reload();
  await row.getByRole("button", { name: /^Tick countdowns/ }).click();
  await expect(tick.getByRole("checkbox", { name: /The dam breaks/ })).toBeChecked();
  await expect(tick.getByRole("checkbox", { name: /The dam breaks/ })).toBeDisabled();
  await expect(tick.getByRole("listitem").filter({ hasText: "The dam breaks" })).toContainText("ticked");
  await expect(tick.getByRole("button", { name: "Apply" })).toBeDisabled();
  await tick.getByRole("button", { name: "Close", exact: true }).click();

  // The player undoes the roll within the minute: the tick comes back.
  await player.goto(`/campaigns/${campaignId}`);
  const playerRow = feedOf(player).getByRole("listitem").filter({ hasText: `${hero}: Agility action roll` });
  await expect(playerRow.getByRole("button", { name: /^Tick countdowns/ })).toHaveCount(0);
  await playerRow.getByRole("button", { name: "Undo" }).click();
  await expect(playerRow.getByText("undone")).toBeVisible();
  await expect(card.getByTestId("countdown-value")).toHaveText("4/4");
  // An undone row no longer offers the button.
  await expect(row.getByRole("button", { name: /^Tick countdowns/ })).toHaveCount(0);
  await close();
});
