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

test("the GM flags the party, the player levels to 2 through the guided mode, and undo returns to level 1", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);
  const hero = `Tabby ${crypto.randomUUID().slice(0, 6)}`;
  const characterId = await createCharacter(player, campaignId, hero);
  const card = cardsForDomains(getClass("warrior")!.domains, 2).find((c) => c.level === 2 && c.source === "core")!;

  // Without the GM's flag the player sees no ▲.
  await player.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await expect(player.getByRole("img", { name: "Level 1" })).toBeVisible();
  await expect(player.getByRole("button", { name: "Level up to 2" })).toHaveCount(0);

  // The GM calls for the level-up on the roster.
  await page.goto(`/campaigns/${campaignId}/party`);
  await page.getByRole("button", { name: "Party levels up" }).click();
  await expect(page.getByRole("status").filter({ hasText: "can level up" })).toHaveText("1 character can level up.");
  await expect(page.getByRole("article", { name: hero }).getByTestId("level-up-pending")).toBeVisible();

  // ▲ starts the guided mode: the ribbon opens on the Experiences, where level 2 names a new Experience.
  await player.getByRole("button", { name: "Level up to 2" }).click();
  const ribbon = player.getByRole("region", { name: "Level-up to 2" });
  await expect(ribbon).toBeVisible();
  await expect(player.getByRole("dialog")).toHaveCount(0);
  const steps = ribbon.getByRole("list", { name: "Level-up steps" });
  await expect(steps.getByRole("listitem").first()).toHaveAttribute("aria-current", "step");
  await expect(player.getByRole("heading", { name: "Experiences" })).toBeFocused();
  await player.getByRole("textbox", { name: "New Experience (+2) for level 2" }).fill("Always Land on My Feet");

  // Next: the tier boxes on Story & Advancement. Tick the traits option (inline chooser) and a Stress slot.
  await ribbon.getByRole("button", { name: "Next" }).click();
  const levelUp = player.getByRole("region", { name: "Level Up" });
  await expect(levelUp.getByRole("heading", { name: "Level Up" })).toBeFocused();
  await levelUp.getByRole("checkbox", { name: "Tier 2: +1 to two unmarked traits for level 2" }).check();
  const traits = levelUp.getByRole("group", { name: "Traits to raise for level 2" });
  await traits.getByRole("button", { name: /Agility/ }).click();
  await traits.getByRole("button", { name: /Instinct/ }).click();
  await expect(traits.getByRole("button", { name: /Agility/ })).toHaveAttribute("aria-pressed", "true");
  await expect(traits.getByRole("button", { name: /Instinct/ })).toHaveAttribute("aria-pressed", "true");
  // Ticking the last pick moves to the Domain Deck at once, so click (check() would re-read the box after it left).
  await levelUp.getByRole("checkbox", { name: "Tier 2: +1 Stress slot for level 2" }).click();
  await expect(steps.getByRole("button", { name: "Advancements (2/2) (done)" })).toBeVisible();

  // Completing both picks goes on to the Domain Deck by itself. Choose the level's card.
  const deck = player.getByRole("region", { name: "Domain Deck" });
  await expect(deck.getByRole("heading", { name: "Domain Deck" })).toBeFocused();
  await deck.getByRole("button", { name: `Choose ${card.name} for level 2` }).click();
  await expect(deck.getByRole("button", { name: `Undo choice of ${card.name}` })).toBeVisible();

  // Choosing the card goes on to Finish by itself. The summary lists every choice and nothing is left to do.
  const choices = ribbon.getByRole("list", { name: "Your choices" });
  await expect(choices).toContainText("New Experience “Always Land on My Feet” +2");
  await expect(choices).toContainText("Tier 2: +1 to two unmarked traits: Agility, Instinct");
  await expect(choices).toContainText("Tier 2: +1 Stress slot");
  await expect(choices).toContainText(`Domain card: ${card.name}`);
  await expect(ribbon.getByText("Everything is chosen. Finish to level up.")).toBeVisible();
  await ribbon.getByRole("button", { name: "Finish level-up" }).click();
  await expect(ribbon).toBeHidden();

  // The sheet shows level 2, the card, the Experience, +1 on both traits and their marks.
  await expect(player.getByRole("img", { name: "Level 2" })).toBeVisible();
  await expect(player.getByRole("region", { name: "Loadout and vault" }).getByRole("article", { name: card.name })).toBeVisible();
  await player.getByRole("tab", { name: "Character Sheet", exact: true }).click();
  await expect(player.getByRole("textbox", { name: "Experience 3", exact: true })).toHaveValue("Always Land on My Feet");
  await expect(player.getByRole("textbox", { name: "Experience 3 modifier" })).toHaveValue("+2");
  const grid = player.getByRole("list", { name: "Traits" });
  await expect(grid.getByLabel("Agility +3")).toBeVisible();
  await expect(grid.getByLabel("Instinct +1")).toBeVisible();
  await expect(grid.getByRole("img", { name: "Agility marked this tier" })).toBeVisible();
  await expect(grid.getByRole("img", { name: "Instinct marked this tier" })).toBeVisible();

  // Story & Advancement shows the taken advancements in the Tier 2 box; the player gets no GM correction.
  await player.getByRole("tab", { name: "Story & Advancement", exact: true }).click();
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

  // Undo (the − on the level circle) returns to level 1 with no marks and no new Experience.
  await player.getByRole("button", { name: "Undo level 2" }).click();
  await expect(player.getByRole("img", { name: "Level 1" })).toBeVisible();
  await expect(levelUp.getByText("No advancements yet")).toBeVisible();
  await player.getByRole("tab", { name: "Character Sheet", exact: true }).click();
  await expect(grid.getByLabel("Agility +2")).toBeVisible();
  await expect(grid.getByRole("img", { name: "Agility marked this tier" })).toHaveCount(0);
  await expect(player.getByRole("textbox", { name: "Experience 3", exact: true })).toHaveCount(0);
  await close();
});
