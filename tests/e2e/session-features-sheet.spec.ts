import { execFileSync } from "node:child_process";

import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd";
import { signInAsTestGm } from "./fixtures";

// Plan session-features F3: the Class Features chips (U7), the Lunar Phases section with the bump, and the New Moon's
// "Spend a Hope to negate this Minor damage" in the damage calculator (U6). The moon die, the subclass rank and the
// pools are seeded with the internal sessionFeatures:seedForE2e (no public call sets them directly; F1 rolls the die
// at session start, F2 fills the pools from rolls).

const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

const common = { pronouns: "", description: "", potion: "Minor Health Potion", classItem: "", background: [], connections: [] };
const level1Cards = (classId: string) =>
  cardsForDomains(getClass(classId)!.domains, 1)
    .filter((c) => c.level === 1)
    .slice(0, 2)
    .map((c) => c.id);

const moonWitchDraft = (name: string) => ({
  ...common,
  classId: "witch",
  subclassId: "moon",
  ancestry: { kind: "single", id: "elf" },
  communityId: "loreborne",
  traits: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 0 },
  name,
  primaryWeaponId: "dagger",
  armorId: "gambeson-armor",
  experiences: ["Night walker", "Herbalist"],
  domainCards: level1Cards("witch"),
});

const warriorDraft = (name: string, change: { subclassId?: string; communityId?: string } = {}) => ({
  ...common,
  classId: "warrior",
  subclassId: "call-of-the-brave",
  ancestry: { kind: "single", id: "elf" },
  communityId: "loreborne",
  traits: { agility: 2, strength: 1, finesse: 0, instinct: 1, presence: -1, knowledge: 0 },
  name,
  primaryWeaponId: "longsword",
  armorId: "chainmail-armor",
  experiences: ["Sellsword", "Brawler"],
  domainCards: ["get-back-up", "not-good-enough"],
  ...change,
});

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

type Seed = { characterId: string; subclassRank?: "foundation" | "specialization" | "mastery"; level?: number; hope?: number; slayerDice?: number; tideTokens?: number; moonDie?: number };

/** Seeds a sheet on the local e2e backend through the internal sessionFeatures:seedForE2e (admin key, Convex CLI). */
function seed(args: Seed): void {
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "run", "sessionFeatures:seedForE2e", JSON.stringify(args)], { stdio: "pipe" });
}

/** Signs in as the test GM and starts a Hope & Fear campaign; returns a client and the campaign id. */
async function hopeAndFearCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const campaign = unique("Moon");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(campaign);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: campaign })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const client = await convexAs(page);
  await client.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  return { client, campaignId };
}

test("a Moon Witch negates Minor damage under a New moon and bumps the die; chips show for the Slayer and the Seaborne PC", async ({ page }) => {
  const { client, campaignId } = await hopeAndFearCampaign(page);
  const mira = unique("Mira");
  const bryn = unique("Bryn");
  const kai = unique("Kai");
  const create = async (draft: ReturnType<typeof moonWitchDraft> | ReturnType<typeof warriorDraft>) =>
    (await client.mutation(api.characters.create, { campaignId, draft, idempotencyKey: crypto.randomUUID() })).characterId as Id<"characters">;
  const miraId = await create(moonWitchDraft(mira));
  const brynId = await create(warriorDraft(bryn, { subclassId: "call-of-the-slayer" }));
  const kaiId = await create(warriorDraft(kai, { communityId: "seaborne" }));
  seed({ characterId: miraId, subclassRank: "mastery", level: 7, hope: 3, moonDie: 1 });
  seed({ characterId: brynId, slayerDice: 1 });
  seed({ characterId: kaiId, tideTokens: 1 });

  // Mira: the section with New highlighted, and the moon die chip.
  await page.goto(`/campaigns/${campaignId}/party/${miraId}`);
  const sheet = page.getByRole("article", { name: mira });
  const lunar = sheet.getByRole("region", { name: "Lunar Phases" });
  await expect(lunar).toBeVisible();
  for (const name of ["New moon", "Waxing moon", "Full moon", "Waning moon"]) await expect(lunar.getByRole("img", { name })).toBeVisible();
  const current = lunar.locator("[aria-current='true']");
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("New");
  await expect(lunar.getByLabel("Moon die 1")).toBeVisible();
  await expect(sheet.getByRole("list", { name: "Session features" })).toContainText("Moon die 1: New");

  // Minor damage: the New Moon offers to negate it; Hope -1, no Hit Point.
  const take = sheet.getByRole("group", { name: "Take damage" });
  await take.getByLabel("Damage roll").fill("1");
  await expect(take).toContainText("Minor damage: mark 1 Hit Point. New Moon: or spend a Hope to negate it.");
  await take.getByRole("button", { name: "Spend a Hope to negate this Minor damage" }).click();
  await expect(take).toContainText("The New Moon negates the Minor damage");
  await expect.poll(async () => (await client.query(api.characters.get, { characterId: miraId }))?.sheet).toMatchObject({ hope: 2, hp: 0 });
  await expect(sheet.getByRole("group", { name: "Hope: 2 of 6 marked" })).toBeVisible();

  // The bump: 1 -> 2, Waxing highlighted, the button now disabled for the rest.
  const bump = lunar.getByRole("button", { name: /Spend a Hope: \+1 to the moon die/ });
  await bump.click();
  await expect(current).toContainText("Waxing");
  await expect(lunar.getByLabel("Moon die 2")).toBeVisible();
  await expect(bump).toBeDisabled();
  await expect(lunar).toContainText("Used this rest; it refreshes after a rest.");
  await expect(sheet.getByRole("list", { name: "Session features" })).toContainText("Moon die 2: Waxing");
  // Waxing: the negate button is gone even for Minor damage.
  await take.getByLabel("Damage roll").fill("1");
  await expect(take.getByRole("button", { name: "Spend a Hope to negate this Minor damage" })).toHaveCount(0);

  // Bryn (Slayer): the chip, no Lunar Phases section.
  await page.goto(`/campaigns/${campaignId}/party/${brynId}`);
  const brynSheet = page.getByRole("article", { name: bryn });
  await expect(brynSheet.getByRole("list", { name: "Session features" })).toContainText("Slayer Dice 1/1");
  await expect(brynSheet.getByRole("region", { name: "Lunar Phases" })).toHaveCount(0);

  // Kai (Seaborne): the Tide chip, no Lunar Phases section.
  await page.goto(`/campaigns/${campaignId}/party/${kaiId}`);
  const kaiSheet = page.getByRole("article", { name: kai });
  await expect(kaiSheet.getByRole("list", { name: "Session features" })).toContainText("Tide tokens 1/1");
  await expect(kaiSheet.getByRole("region", { name: "Lunar Phases" })).toHaveCount(0);
});
