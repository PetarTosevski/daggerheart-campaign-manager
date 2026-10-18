import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ANCESTRIES, ARMOR, cardsForDomains, COMMUNITIES, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd";
import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";

/** A valid level-1 Warrior draft: Agility +2, Instinct 0. */
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
    draft: draft(name),
    idempotencyKey: crypto.randomUUID(),
  });
  return characterId;
}

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Levels ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const dialog = page.getByRole("dialog", { name: "Name your campaign" });
  await dialog.getByLabel("Campaign name").fill(name);
  await dialog.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2] };
}

async function playerJoins(page: Page, browser: Browser, campaignName: string) {
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
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close: () => context.close() };
}

test("the GM flags the party, the player levels to 2 with the trait option, and undo returns to level 1", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);
  const hero = `Tabby ${crypto.randomUUID().slice(0, 6)}`;
  const characterId = await createCharacter(player, campaignId, hero);

  // The GM calls for the level-up on the roster.
  await page.goto(`/campaigns/${campaignId}/party`);
  await page.getByRole("button", { name: "Party levels up" }).click();
  await expect(page.getByRole("status").filter({ hasText: "can level up" })).toHaveText("1 character can level up.");
  await expect(page.getByRole("article", { name: hero }).getByTestId("level-up-pending")).toBeVisible();

  // The player levels up on the sheet.
  await player.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await player.getByRole("button", { name: "Level up to 2" }).click();
  const stepper = player.getByRole("dialog", { name: "Level up to 2" });
  await stepper.getByLabel("New Experience").fill("Always Land on My Feet");
  await stepper.getByRole("button", { name: "Next" }).click();
  await stepper.getByRole("button", { name: "Take tier 2: +1 to two unmarked traits" }).click();
  const traits = stepper.getByRole("group", { name: "Traits to raise" });
  await traits.getByRole("button", { name: /Agility/ }).click();
  await traits.getByRole("button", { name: /Instinct/ }).click();
  await stepper.getByRole("button", { name: "Take tier 2: +1 Stress slot" }).click();
  await stepper.getByRole("button", { name: "Next" }).click();
  await expect(stepper.getByLabel("Level 2 domain card")).not.toHaveValue("");
  await stepper.getByRole("button", { name: "Next" }).click();
  await stepper.getByRole("button", { name: "Confirm level 2" }).click();
  await expect(stepper).toBeHidden();

  // The sheet shows level 2, +1 on both traits, and their marks.
  await expect(player.getByRole("img", { name: "Level 2" })).toBeVisible();
  const grid = player.getByRole("list", { name: "Traits" });
  await expect(grid.getByLabel("Agility +3")).toBeVisible();
  await expect(grid.getByLabel("Instinct +1")).toBeVisible();
  await expect(grid.getByRole("img", { name: "Agility marked this tier" })).toBeVisible();
  await expect(grid.getByRole("img", { name: "Instinct marked this tier" })).toBeVisible();

  // Story & Advancement shows the taken advancements in the Tier 2 box; the player gets no GM correction.
  await player.getByRole("tab", { name: "Story & Advancement", exact: true }).click();
  const levelUp = player.getByRole("region", { name: "Level Up" });
  await expect(levelUp.getByText("2 / 2 advancements used")).toBeVisible();
  const tier2 = levelUp.getByRole("region", { name: "Tier 2" });
  await expect(tier2.getByRole("checkbox", { name: "Tier 2: +1 Stress slot (1), taken at level 2" })).toBeChecked();
  await expect(tier2.getByRole("checkbox", { name: "Tier 2: +1 Stress slot (2)" })).not.toBeChecked();
  await expect(tier2.getByRole("checkbox", { name: "Tier 2: +1 to two unmarked traits (1), taken at level 2" })).toBeChecked();
  await expect(levelUp.getByRole("region", { name: "Tier 3" }).getByText("Reach level 5 to unlock")).toBeVisible();
  await expect(player.getByRole("button", { name: "Set level" })).toHaveCount(0);

  // The GM sees the same history with the level correction under the tiers.
  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await page.getByRole("tab", { name: "Story & Advancement", exact: true }).click();
  await expect(page.getByRole("region", { name: "Level Up" }).getByText("2 / 2 advancements used")).toBeVisible();
  await expect(page.getByRole("button", { name: "Set level" })).toBeVisible();

  // Undo (the − on the level circle) returns to level 1 with no marks.
  await player.getByRole("button", { name: "Undo level 2" }).click();
  await expect(player.getByRole("img", { name: "Level 1" })).toBeVisible();
  await expect(levelUp.getByText("No advancements yet")).toBeVisible();
  await player.getByRole("tab", { name: "Character Sheet", exact: true }).click();
  await expect(grid.getByLabel("Agility +2")).toBeVisible();
  await expect(grid.getByRole("img", { name: "Agility marked this tier" })).toHaveCount(0);
  await close();
});
