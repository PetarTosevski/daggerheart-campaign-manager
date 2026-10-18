import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { FrameId } from "../../src/lib/frames";
import { signInAsTestGm } from "./fixtures";

/** A level-1 Bard with 5 Hit Points. */
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

/** Signs in as the GM, creates a `frameId` campaign with a level-1 Bard (Hit Points marked: `hp`) and opens the sheet. */
async function openBard(page: Page, frameId: FrameId, hp: number) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const client = await convexAs(page);
  const name = `Wren ${crypto.randomUUID().slice(0, 8)}`;
  const { campaignId } = await client.mutation(api.campaigns.create, { frameId, name: `Death ${name}`, idempotencyKey: crypto.randomUUID() });
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId: campaignId as Id<"campaigns">,
    draft: bardDraft(name),
    idempotencyKey: crypto.randomUUID(),
  });
  if (hp > 0) await client.mutation(api.characters.adjustResource, { characterId, resource: "hp", delta: hp });
  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name };
}

test("a character at their last Hit Point avoids death, and clearing a Hit Point wakes them", async ({ page }) => {
  await openBard(page, "witherwild", 5);

  const dialog = page.getByRole("dialog", { name: "Death move" });
  await expect(dialog).toBeVisible();
  // Each move is one large option button named by the move, with its reminder as the description.
  await expect(dialog.getByRole("button", { name: "Avoid Death", exact: true })).toHaveAccessibleDescription(/Drop unconscious/);
  await expect(dialog.getByRole("textbox", { name: "Last action (optional)" })).toBeVisible();
  await dialog.getByRole("button", { name: "Avoid Death" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("death-unconscious")).toHaveText("Unconscious");
  await expect(page.getByRole("status").filter({ hasText: /Hope Die \d+ against level 1/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Death moves" }).getByRole("button", { name: "Undo death move" })).toBeVisible();

  // An ally clears one Hit Point: the character wakes up.
  await page.getByRole("button", { name: "Hit Point 5 of 5" }).click();
  await expect(page.getByRole("group", { name: "Hit Point: 4 of 5 marked" })).toBeVisible();
  await expect(page.getByTestId("death-unconscious")).toHaveCount(0);
});

test("Castle High: Blaze of Glory sends the hero home, the banner says so, and the GM returns them to play", async ({ page }) => {
  await openBard(page, "castle-high", 5);

  const dialog = page.getByRole("dialog", { name: "Death move" });
  await dialog.getByRole("button", { name: "Blaze of Glory" }).click();
  // The finish step asks again where the hero goes.
  const finish = dialog.getByRole("button", { name: "End the action" });
  await expect(finish).toBeVisible();
  await dialog.getByRole("radio", { name: "Sent home" }).check();
  await finish.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("character-status")).toHaveText("Away · sent home");

  await page.getByRole("button", { name: "Return to play" }).click();
  await expect(page.getByTestId("character-status")).toHaveCount(0);
});

test("the status row marks a hero dead after a confirm (FALLEN in the banner) and active again", async ({ page }) => {
  await openBard(page, "witherwild", 0);

  const status = page.getByRole("region", { name: "Status" });
  await status.getByRole("button", { name: "Dead", exact: true }).click();
  const confirm = status.getByRole("alertdialog", { name: "Confirm dead" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Mark dead" }).click();
  await expect(page.getByTestId("character-status")).toHaveText("Fallen");
  await expect(status.getByRole("button", { name: "Dead", exact: true })).toHaveAttribute("aria-pressed", "true");

  await status.getByRole("button", { name: "Active", exact: true }).click();
  await expect(page.getByTestId("character-status")).toHaveCount(0);
});
