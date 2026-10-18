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
  await picker.getByRole("combobox", { name: "Move 1" }).selectOption({ label: "Clear Stress" });
  await picker.getByRole("combobox", { name: "Move 2" }).selectOption({ label: "Clear Stress" });
  await picker.getByRole("button", { name: "Save moves" }).click();
  await expect(picker.getByText(/^Saved\./)).toBeVisible();

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
