import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd/index";
import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

/** A level-1 Bard: Rapier (d8), Gambeson (5/11, 3 slots), Deft Deceiver + Book of Ava (Recall 2). */
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

/**
 * Creates the character through the real API as the signed-in user (the
 * wizard has its own spec), returning its id.
 */
async function createCharacter(page: Page, campaignId: string, name: string): Promise<string> {
  const client = await convexAs(page);
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId: campaignId as Id<"campaigns">,
    draft: bardDraft(name),
    idempotencyKey: crypto.randomUUID(),
  });
  return characterId;
}

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Sheet");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
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

test("the GM plays a character sheet: tracks, damage, cards and notes", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const hero = unique("Liriel");
  const characterId = await createCharacter(page, campaignId, hero);
  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await expect(page.getByRole("heading", { level: 1, name: hero })).toBeVisible();

  // Computed values: Gambeson 5/11 + level 1, Rapier d8 at Proficiency 1.
  await expect(page.getByTestId("threshold-major")).toHaveText("Major 6");
  await expect(page.getByTestId("threshold-severe")).toHaveText("Severe 12");
  await expect(page.getByTestId("primary-damage")).toHaveText("1d8 phy");

  // Tap to mark and clear.
  await page.getByRole("button", { name: "Hit Point 2 of 5" }).click();
  await expect(page.getByRole("group", { name: "Hit Point: 2 of 5 marked" })).toBeVisible();
  await page.getByRole("button", { name: "Hit Point 2 of 5" }).click();
  await expect(page.getByRole("group", { name: "Hit Point: 1 of 5 marked" })).toBeVisible();
  await page.getByRole("button", { name: "Stress 3 of 6" }).click();
  await expect(page.getByRole("group", { name: "Stress: 3 of 6 marked" })).toBeVisible();
  await page.getByRole("button", { name: "Hope 3 of 6" }).click();
  await expect(page.getByRole("group", { name: "Hope: 3 of 6 marked" })).toBeVisible();

  // A scar removes a Hope slot.
  await page.getByRole("button", { name: "Increase Scars" }).click();
  await expect(page.getByRole("group", { name: "Hope: 3 of 5 marked, 1 lost to scars" })).toBeVisible();

  // Damage calculator: 13 is Severe; an Armor Slot drops it to Major (2 HP).
  await page.getByLabel("Damage roll").fill("13");
  await expect(page.getByText("Severe damage: mark 3 Hit Points.")).toBeVisible();
  await page.getByLabel(/Use an Armor Slot/).check();
  await expect(page.getByText("Major damage after marking an Armor Slot: mark 2 Hit Points.")).toBeVisible();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("group", { name: "Hit Point: 3 of 5 marked" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Armor Slot: 1 of 3 marked" })).toBeVisible();

  // Domain cards: vault Book of Ava, then recall it (no rest is open, so it costs Stress).
  await page.getByRole("tab", { name: "Domains" }).click();
  await expect(page.getByRole("tab", { name: "Domain Cards" })).toHaveAttribute("aria-selected", "true");
  const loadout = page.getByRole("list", { name: "Loadout cards" });
  await loadout.getByRole("article", { name: "Book of Ava" }).getByRole("button", { name: "Move to vault" }).click();
  const vault = page.getByRole("list", { name: "Vault cards" });
  await expect(vault.getByRole("article", { name: "Book of Ava" })).toBeVisible();
  await expect(vault.getByRole("button", { name: "Move to loadout (2 Stress)" })).toBeVisible();
  await page.getByLabel(/Swapping during a rest \(free only while the GM has a rest open\)/).check();
  // No party rest is open, so the server charges the Recall Cost anyway, and the button says so (polish 31).
  await expect(page.getByTestId("no-open-rest")).toBeVisible();
  await vault.getByRole("button", { name: "Move to loadout (2 Stress)" }).click();
  await expect(loadout.getByRole("article", { name: "Book of Ava" })).toBeVisible();

  // Notes save on blur and survive a reload.
  await page.getByRole("tab", { name: "Heritage & Subclass" }).click();
  await expect(page.getByRole("article", { name: "Subclass: Troubadour Specialization (locked)" })).toBeVisible();
  await page.getByRole("tab", { name: "Story & Advancement" }).click();
  const notes = page.getByRole("textbox", { name: "Notes" });
  await notes.fill("Owes the innkeeper 3 gold.");
  await notes.blur();
  // The blur save is a live mutation: wait until the server has it before reloading.
  const client = await convexAs(page);
  await expect.poll(async () => (await client.query(api.characters.get, { characterId }))?.sheet.notes).toBe("Owes the innkeeper 3 gold.");
  await page.reload();
  await page.getByRole("tab", { name: "Story & Advancement" }).click();
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue("Owes the innkeeper 3 gold.");
});

test("another player reads the full sheet, live, with no edit controls", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const hero = unique("Brannoc");
  const characterId = await createCharacter(page, campaignId, hero);
  const { player, close } = await playerJoins(page, browser, name);
  const url = `/campaigns/${campaignId}/party/${characterId}`;
  await page.goto(url);
  await player.goto(url);

  await expect(player.getByRole("heading", { level: 1, name: hero })).toBeVisible();
  await expect(player.getByTestId("read-only-note")).toBeVisible();
  const paper = player.getByRole("article", { name: hero });
  await expect(paper.getByRole("button", { name: /Hit Point \d+ of/ })).toHaveCount(0);
  await expect(paper.getByLabel("Damage roll")).toHaveCount(0);
  await expect(paper.getByRole("textbox")).toHaveCount(0);
  await expect(paper.getByRole("combobox")).toHaveCount(0);
  await expect(paper.getByRole("button", { name: /^(Dead|Retired|Active)$/ })).toHaveCount(0);

  // The GM marks a Hit Point; the player's sheet updates without reloading.
  await page.getByRole("button", { name: "Hit Point 1 of 5" }).click();
  await expect(player.getByRole("img", { name: "Hit Point: 1 of 5 marked" })).toBeVisible();

  await player.getByRole("tab", { name: "Domains" }).click();
  await expect(paper.getByRole("list", { name: "Loadout cards" })).toBeVisible();
  await expect(paper.getByRole("button", { name: /Move to/ })).toHaveCount(0);
  await player.getByRole("tab", { name: "Heritage & Subclass" }).click();
  await expect(paper.getByRole("list", { name: "Heritage and subclass cards" })).toBeVisible();
  await player.getByRole("tab", { name: "Story & Advancement" }).click();
  await expect(paper.getByRole("region", { name: "Notes" })).toBeVisible();
  await expect(paper.getByRole("textbox")).toHaveCount(0);
  await close();
});

test("a Motherboard character shows the Ikonis instead of weapons, and installed augments in Armor Score and Evasion (CB 301-303)", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Ikonis sheet");
  await page.goto("/frames/motherboard");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;

  const client = await convexAs(page);
  const warrior = getClass("warrior")!;
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId,
    draft: {
      ...bardDraft(unique("Vex")),
      classId: "warrior",
      subclassId: "call-of-the-brave",
      traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
      primaryWeaponId: "",
      domainCards: cardsForDomains(warrior.domains, 1)
        .filter((c) => c.level === 1)
        .slice(0, 2)
        .map((c) => c.id),
    },
    ikonis: { name: "Spark rod", description: "", trait: "strength", range: "Melee", damageType: "physical" },
    idempotencyKey: crypto.randomUUID(),
  });
  // Block needs Tier 3 (precompile): the GM's level correction puts the Warrior at level 5.
  await client.mutation(api.levelUp.correctLevel, { characterId, level: 5, idempotencyKey: crypto.randomUUID() });

  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await expect(page.getByTestId("ikonis-weapon")).toContainText("Spark rod");
  await expect(page.getByLabel("Primary weapon")).toHaveCount(0);
  const evasion = Number(await page.getByTestId("evasion").textContent());
  const armorLabel = await page.getByLabel(/^Armor Score \d+$/).getAttribute("aria-label");
  const armor = Number(armorLabel!.replace("Armor Score ", ""));

  const scrap = { Crystal: 27, Aluminum: 67, Relay: 33, Capacitor: 4, Battery: 5 };
  await client.mutation(api.characterExtras.correctWallet, { characterId, correction: { scrap }, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characterExtras.craftAugment, { characterId, augmentId: "block", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characterExtras.installAugments, { characterId, augmentIds: ["force", "block"], idempotencyKey: crypto.randomUUID() });

  // Block: +3 Armor Score, -1 Evasion.
  await expect(page.getByTestId("evasion")).toHaveText(String(evasion - 1));
  await expect(page.getByLabel(`Armor Score ${armor + 3}`)).toBeVisible();

  await page.goto(`/campaigns/${campaignId}/party`);
  await expect(page.getByTestId("roster-evasion")).toHaveText(String(evasion - 1));
});
