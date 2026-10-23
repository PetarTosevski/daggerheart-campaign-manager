import { execFileSync } from "node:child_process";

import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

/** A level-1 Bard (6 Stress slots). */
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

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Rest");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2] as Id<"campaigns"> };
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

test("a short party rest: the player clears Stress twice, the GM finishes, GM Fear rises", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);

  // The player's character, with all 6 Stress marked.
  const playerApi = await convexAs(player);
  const hero = unique("Liriel");
  const { characterId } = await playerApi.mutation(api.characters.create, { campaignId, draft: bardDraft(hero), idempotencyKey: crypto.randomUUID() });
  await playerApi.mutation(api.characters.adjustResource, { characterId, resource: "stress", delta: 6 });

  // The GM starts a short rest from the dashboard.
  const rest = page.getByRole("region", { name: "Rest", exact: true });
  await rest.getByRole("button", { name: "Start short rest" }).click();
  await expect(rest.getByTestId("open-rest")).toContainText("Short rest under way");

  // The player picks Clear Stress twice on their sheet.
  await player.goto(`/campaigns/${campaignId}/party/${characterId}`);
  const picker = player.getByRole("region", { name: "Downtime moves" });
  for (const slot of ["Move 1", "Move 2"]) {
    const chip = picker.getByRole("group", { name: slot }).getByRole("button", { name: "Clear Stress" });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }
  await picker.getByRole("button", { name: "Save moves" }).click();
  await expect(picker.getByText(/^Saved\./)).toBeVisible();
  // The Downtime box's reference text marks the saved move: Clear Stress, picked twice.
  const downtime = player.getByRole("region", { name: "Downtime", exact: true });
  await expect(downtime.getByText("Picked ×2")).toBeVisible();
  await expect(downtime.getByText(/^Picked/)).toHaveCount(1);

  // The GM sees the picks and finishes the rest.
  await expect(rest.getByRole("list", { name: "Downtime choices" })).toContainText(`${hero}: Clear Stress, Clear Stress`);
  await rest.getByRole("button", { name: "Finish rest" }).click();
  await expect(rest.getByText(/Last: Short rest/)).toBeVisible();

  // Stress drops by 2 × (1d4 + tier 1), at least 4; the GM gains 1d4 Fear.
  await expect.poll(async () => (await playerApi.query(api.characters.get, { characterId }))?.sheet.stress).toBeLessThanOrEqual(2);
  await expect(page.getByRole("button", { name: "Fear 1 of 12" })).toHaveAttribute("aria-pressed", "true");
  await expect(picker).toHaveCount(0);
  await close();
});

test("Martial Preparation (CB 48): with a mastery Slayer in the party, an ally takes the move and holds a Slayer Die", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const gmApi = await convexAs(page);
  const slayer = unique("Kael");
  const ally = unique("Liriel");
  const slayerDraft = {
    ...bardDraft(slayer),
    classId: "warrior",
    subclassId: "call-of-the-slayer",
    traits: { agility: 2, strength: 1, finesse: 0, instinct: 1, presence: -1, knowledge: 0 },
    primaryWeaponId: "longsword",
    armorId: "chainmail-armor",
    domainCards: ["get-back-up", "not-good-enough"],
  };
  const slayerId = (await gmApi.mutation(api.characters.create, { campaignId, draft: slayerDraft, idempotencyKey: crypto.randomUUID() })).characterId;
  const allyId = (await gmApi.mutation(api.characters.create, { campaignId, draft: bardDraft(ally), idempotencyKey: crypto.randomUUID() })).characterId;
  // No public call sets a subclass rank directly: the internal e2e seed does (as in session-features-sheet.spec.ts).
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "run", "sessionFeatures:seedForE2e", JSON.stringify({ characterId: slayerId, subclassRank: "mastery", level: 7 })], {
    stdio: "pipe",
  });

  const rest = page.getByRole("region", { name: "Rest", exact: true });
  await rest.getByRole("button", { name: "Start short rest" }).click();
  await expect(rest.getByTestId("open-rest")).toContainText("Short rest under way");

  // The ally's sheet offers the move; picking it explains the die.
  await page.goto(`/campaigns/${campaignId}/party/${allyId}`);
  const picker = page.getByRole("region", { name: "Downtime moves" });
  const chip = picker.getByRole("group", { name: "Move 1" }).getByRole("button", { name: "Martial Preparation" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(picker).toContainText("You gain a d6 Slayer Die, up to your Proficiency");
  await picker.getByRole("group", { name: "Move 2" }).getByRole("button", { name: "Prepare", exact: true }).click();
  await picker.getByRole("button", { name: "Save moves" }).click();
  await expect(picker.getByText(/^Saved\./)).toBeVisible();

  await gmApi.mutation(api.rests.finish, { campaignId, restId: (await gmApi.query(api.rests.current, { campaignId })).open!._id, idempotencyKey: crypto.randomUUID() });
  await expect(picker).toHaveCount(0);
  // The ally holds the die: the sheet shows the pool chip like a Slayer's.
  await expect(page.getByRole("article", { name: ally }).getByRole("list", { name: "Session features" })).toContainText("Slayer Dice 1/1");
});

test("after three short rests the GM's Start short rest is disabled with the rule (CB 105, HF 176)", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const gmApi = await convexAs(page);
  for (let i = 0; i < 3; i++) {
    const { restId } = await gmApi.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: crypto.randomUUID() });
    await gmApi.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: crypto.randomUUID() });
  }

  const rest = page.getByRole("region", { name: "Rest", exact: true });
  await expect(rest.getByTestId("short-rest-count")).toHaveText("3 of 3 short rests");
  const short = rest.getByRole("button", { name: "Start short rest" });
  await expect(short).toBeDisabled();
  await expect(short).toHaveAccessibleDescription("Three short rests taken: the next rest must be a long rest (CB 105).");
  await expect(rest.getByRole("checkbox")).toHaveCount(0);

  // A long rest resets the count.
  await rest.getByRole("button", { name: "Start long rest" }).click();
  await rest.getByRole("button", { name: "Finish rest" }).click();
  await expect(rest.getByTestId("short-rest-count")).toHaveText("0 of 3 short rests");
  await expect(short).toBeEnabled();
});
