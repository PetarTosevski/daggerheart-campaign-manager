import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";

const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

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

async function newCampaign(page: Page, frame: string, label: string): Promise<Id<"campaigns">> {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto(`/frames/${frame}`);
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const name = unique(label);
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
}

test("a Colossus campaign's long rest marks the GM-only Siphoning Track twice (CB 327)", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/frames/colossus-of-the-drylands");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const name = unique("Drylands rest");
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  const siphon = page.getByTestId("siphon-marked");
  await expect(siphon).toHaveText("1");

  const rest = page.getByRole("region", { name: "Rest", exact: true });
  await rest.getByRole("button", { name: "Start long rest" }).click();
  await expect(rest.getByTestId("open-rest")).toContainText("Long rest under way");
  await rest.getByRole("button", { name: "Finish rest" }).click();
  await expect(rest.getByText(/Last: Long rest/)).toBeVisible();

  await expect(siphon).toHaveText("3");
  // The manual buttons are corrections now that party rests mark the track.
  await expect(page.getByTestId("siphon-rest-note")).toContainText("Party rests mark the track automatically");
  await expect(page.getByRole("button", { name: "Correction: short rest +1" })).toBeVisible();
});

test("a Beast Feast rest offers Make a Feast and hides the moves that clear Stress, HP or gain Hope (CB 278)", async ({ page }) => {
  const campaignId = await newCampaign(page, "beast-feast", "Feast rest");
  const client = await convexAs(page);
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId,
    draft: {
      classId: "bard",
      subclassId: "troubadour",
      ancestry: { kind: "single", id: "elf" },
      communityId: "loreborne",
      traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
      name: "Pip",
      pronouns: "",
      description: "",
      primaryWeaponId: "rapier",
      armorId: "gambeson-armor",
      potion: "Minor Health Potion",
      classItem: "",
      background: [],
      experiences: ["Cook", "Forager"],
      domainCards: ["deft-deceiver", "book-of-ava"],
      connections: [],
    },
    idempotencyKey: crypto.randomUUID(),
  });
  await client.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: crypto.randomUUID() });

  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  const picker = page.getByRole("region", { name: "Downtime moves" });
  const move1 = picker.getByLabel("Move 1");
  await expect(move1.locator("option")).toHaveText(["Repair Armor", "Make a Feast"]);
  await move1.selectOption({ label: "Make a Feast" });
  await picker.getByRole("button", { name: "Save moves" }).click();
  await expect(picker.getByText("Saved.", { exact: false })).toBeVisible();
});
