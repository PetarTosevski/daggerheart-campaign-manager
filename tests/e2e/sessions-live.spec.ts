import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd/index";
import { bardDraft, expectNoHorizontalScroll, openSessions } from "./visual/helpers";

// D10 S3: the live card (B2, B6, B7, B10, K3, K4). The GM starts Session 1 from its card (a Seraph's Prayer Dice
// appear on the sheet and in the start report, which is the session log's line), starts Session 2 (Session 1 becomes
// Played), and ends Session 2 with a Wither token on a sheet (GM Fear rises; 'Session ended.').

/** A level-1 Seraph (Divine Wielder, Strength 2): two Prayer Dice at session start (Spellcast trait, K3). */
function seraphDraft(name: string) {
  const seraph = getClass("seraph")!;
  return {
    ...bardDraft(name),
    classId: "seraph",
    subclassId: "divine-wielder",
    traits: { agility: 0, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 },
    domainCards: cardsForDomains(seraph.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
  };
}

const list = (page: Page) => page.getByRole("complementary", { name: "Session list" });
const liveCard = (page: Page) => page.getByRole("region", { name: "Live session" });

async function newSession(page: Page) {
  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(page).toHaveURL(/stage=prep$/);
}

test("the GM starts and ends sessions from the live card; the party sync runs and the stage follows", async ({ page }) => {
  const { client, campaignId, url } = await openSessions(page);
  const { characterId } = await client.mutation(api.characters.create, { campaignId, draft: seraphDraft("Seren"), idempotencyKey: crypto.randomUUID() });
  await newSession(page);
  await newSession(page);
  const items = list(page).getByRole("button");
  await expect(items).toHaveCount(2);

  // Session 1: not running yet; Start asks first, then switches to Play and reports the Prayer Dice.
  await items.nth(1).click();
  await expect(liveCard(page)).toContainText("Not running");
  await expect(liveCard(page)).toContainText("Start the session when you sit down at the table.");
  await liveCard(page).getByRole("button", { name: "Start session" }).click();
  const startDialog = page.getByRole("dialog", { name: "Start the session?" });
  await startDialog.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/stage=play/);
  await expect(page.getByRole("tab", { name: "Play" })).toHaveAttribute("aria-selected", "true");
  await expect(liveCard(page)).toContainText("Session in progress");
  await expect(liveCard(page)).toContainText(/Live since \d\d:\d\d\./);
  await expect(liveCard(page).getByRole("status")).toHaveText(/^Session started\. Seren rolled Prayer Dice: [1-4], [1-4]\.$/);
  await expect(items.nth(1).locator(".ss-chip")).toHaveText("Live");
  await expect(liveCard(page).getByRole("switch", { name: /Allow extra characters this session/ })).not.toBeChecked();
  const sessionsUrl = page.url();

  // The Seraph's sheet holds the two Prayer Dice.
  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  const held = page.getByRole("list", { name: "Held dice" }).getByRole("listitem");
  await expect(held).toHaveCount(2);
  await expect(held.first()).toHaveText(/^Prayer d4: [1-4]$/);
  await page.goto(sessionsUrl);

  // Session 2 while Session 1 runs: the card warns, Start ends Session 1 first (B6).
  await items.nth(0).click();
  await expect(liveCard(page)).toContainText("Session 1 is still running. Starting this one ends it.");
  await liveCard(page).getByRole("button", { name: "Start session" }).click();
  await expect(startDialog).toContainText("Session 1 is still running. Starting this one ends it.");
  await startDialog.getByRole("button", { name: "Start session" }).click();
  const report = liveCard(page).getByRole("status").locator("p");
  await expect(report.nth(0)).toHaveText("Session 1 ended first.");
  await expect(report.nth(1)).toHaveText("Seren lost 2 unspent dice.");
  await expect(report.nth(2)).toHaveText(/^Session started\. Seren rolled Prayer Dice: [1-4], [1-4]\.$/);
  await expect(items.nth(1).locator(".ss-chip")).toHaveText("Played");
  await expect(items.nth(0).locator(".ss-chip")).toHaveText("Live");

  // A Wither token on the sheet (Witherwild): Severe Withered damage, until the Fear Die leaves a token (CB 261).
  let tokens = 0;
  for (let attempt = 0; attempt < 5 && tokens === 0; attempt++) {
    const hit = await client.mutation(api.characters.applyDamage, { characterId: characterId as Id<"characters">, damage: 13, useArmorSlot: false, withered: true, idempotencyKey: crypto.randomUUID() });
    tokens = hit.wither && !hit.wither.scarred ? hit.wither.tokens : 0;
  }
  expect(tokens).toBeGreaterThan(0);

  // End: asks first, switches to Wrap-up, converts the tokens to GM Fear (K4) and Session 2 is Played.
  await liveCard(page).getByRole("button", { name: "End session" }).click();
  const endDialog = page.getByRole("dialog", { name: "End the session?" });
  await endDialog.getByRole("button", { name: "End session" }).click();
  await expect(page).toHaveURL(/stage=wrap/);
  await expect(page.getByRole("tab", { name: "Wrap-up" })).toHaveAttribute("aria-selected", "true");
  await expect(liveCard(page).getByRole("status")).toContainText(`Session ended. ${tokens} Wither token${tokens === 1 ? "" : "s"} → +${tokens} Fear.`);
  await expect(liveCard(page)).toContainText("This session has been played. Starting it again re-rolls Prayer Dice and refreshes Rally.");
  await expect(items.nth(0).locator(".ss-chip")).toHaveText("Played");

  await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByRole("button", { name: `Fear ${tokens} of 12` })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: `Fear ${tokens + 1} of 12` })).toHaveAttribute("aria-pressed", "false");

  // Phone: the card stacks, the button is a 44 px target, no horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await expect(liveCard(page).getByRole("button", { name: "Start session" })).toBeVisible();
  const box = await liveCard(page).getByRole("button", { name: "Start session" }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalScroll(page);
});
