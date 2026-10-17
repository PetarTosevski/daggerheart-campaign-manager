import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ANCESTRIES, ARMOR, cardsForDomains, COMMUNITIES, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd";
import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const PLAYER_NAME = "e2e-player";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

/** A valid level-1 Warrior draft (the wizard is covered by its own spec). */
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

/** Creates a character through the API as the signed-in user of `page`. */
async function createCharacter(page: Page, campaignId: string, name: string) {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  expect(token, "Convex Auth token in localStorage").toBeTruthy();
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(token!);
  await client.mutation(api.characters.create, {
    campaignId: campaignId as Id<"campaigns">,
    draft: draft(name),
    idempotencyKey: crypto.randomUUID(),
  });
}

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Party");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2];
  return { name, campaignId };
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

test("the roster shows a created character", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const hero = unique("Ash");
  await createCharacter(page, campaignId, hero);

  await page.goto(`/campaigns/${campaignId}/party`);
  const card = page.getByRole("article", { name: hero });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("owner-badge")).toHaveText("Unassigned");
  await expect(card.getByRole("link", { name: "Open character sheet" })).toHaveAttribute("href", /\/party\/[a-z0-9]+$/);
  await expect(page.getByRole("link", { name: /Create Character/i }).first()).toHaveAttribute("href", `/campaigns/${campaignId}/party/new`);

  // The dashboard card replaces the empty state.
  await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByRole("article", { name: hero })).toBeVisible();
  await expect(page.getByText("No characters yet.")).toHaveCount(0);
});

test("dashboard tiles change HP live for another viewer; players can't edit others' tiles", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);
  const theirs = unique("Brin");
  const gms = unique("Cato");
  await createCharacter(player, campaignId, theirs);
  await createCharacter(page, campaignId, gms);

  await expect(page.getByRole("img", { name: `${theirs} HP 0 of 6` })).toBeVisible();
  const own = player.getByRole("article", { name: theirs });
  await own.getByRole("button", { name: `Mark one Hit Point for ${theirs}` }).click();
  await expect(own.getByRole("img", { name: `${theirs} HP 1 of 6` })).toBeVisible();
  await expect(page.getByRole("img", { name: `${theirs} HP 1 of 6` })).toBeVisible();

  // The GM's own (unassigned) character is read-only for the player.
  const other = player.getByRole("article", { name: gms });
  await expect(other.getByRole("button", { name: `Mark one Hit Point for ${gms}` })).toBeDisabled();
  await expect(other.getByRole("button", { name: `Kill ${gms}` })).toHaveCount(0);
  await close();
});

test("the GM assigns a character to a player", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);
  const hero = unique("Dara");
  await createCharacter(page, campaignId, hero);

  await page.goto(`/campaigns/${campaignId}/party`);
  const card = page.getByRole("article", { name: hero });
  await card.getByLabel(`Assign ${hero} to`).selectOption({ label: PLAYER_NAME });
  await expect(card.getByTestId("owner-badge")).toHaveText(PLAYER_NAME);

  await player.goto(`/campaigns/${campaignId}/party`);
  await expect(player.getByRole("article", { name: hero }).getByTestId("owner-badge")).toHaveText("Yours");
  await player.goto(`/campaigns/${campaignId}`);
  await expect(player.getByRole("button", { name: `Mark one Hit Point for ${hero}` })).toBeEnabled();
  await close();
});
