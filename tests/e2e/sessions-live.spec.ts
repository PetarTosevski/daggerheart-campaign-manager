import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd/index";
import { bardDraft, endFromJournal, expectNoHorizontalScroll, journalLiveChip, journalReport, openSessions } from "./visual/helpers";
import { TOUCH_FLOOR_ON_SCREEN } from "./zoom";

// D10 S3 in the Journal (JH; old live card removed in Journal JX2): the GM selects Session 1 and starts it from the
// header ('Start session 1', B2, B10, K3: a Seraph's Prayer Dice appear on the sheet and in the start report), the list
// marks it Live and the page opens its Log & recap; the GM ends it with a Wither token on a sheet (K4: GM Fear rises;
// 'Session ended.') and the list marks it Played. Then 'Start session 2' names the next planned one.
// Starting a session while another runs (B6) is not offered by the header (End first); the server path stays covered
// by tests/convex/sessions.test.ts.

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

const list = (page: Page) => page.getByRole("complementary", { name: "All sessions" }).getByRole("list", { name: "Sessions" });

test("the GM starts and ends a session from the Journal header; the party sync runs and the list follows", async ({ page }) => {
  const { client, campaignId, url } = await openSessions(page);
  const { characterId } = await client.mutation(api.characters.create, { campaignId, draft: seraphDraft("Seren"), idempotencyKey: crypto.randomUUID() });
  const key = () => crypto.randomUUID();
  const { sessionId: first } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
  await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
  await expect(list(page).getByRole("button")).toHaveCount(2);

  // Session 1 selected: 'Start session 1' asks first, then opens its Log & recap and reports the Prayer Dice.
  await list(page).getByRole("button", { name: /^Session 1: / }).click();
  await page.getByRole("button", { name: "Start session 1" }).click();
  const startDialog = page.getByRole("dialog", { name: "Start session 1?" });
  await expect(startDialog).toContainText("Start-of-session features are given out");
  await startDialog.getByRole("button", { name: "Start session", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`s=${first}`));
  await expect(page).toHaveURL(/sv=log/);
  await expect(page.getByRole("tablist", { name: "Session view" }).getByRole("tab", { name: "Log & recap" })).toHaveAttribute("aria-selected", "true");
  await expect(journalLiveChip(page)).toContainText("Session 1 · live");
  await expect(journalReport(page)).toHaveText(/^Session started\. Seren rolled Prayer Dice: [1-4], [1-4]\.$/);
  await expect(list(page).getByRole("button", { name: /^Session 1: .+, Live$/ })).toBeVisible();
  const sessionUrl = page.url();

  // The Seraph's sheet holds the two Prayer Dice.
  await page.goto(`/campaigns/${campaignId}/party/${characterId}`);
  const held = page.getByRole("list", { name: "Held dice" }).getByRole("listitem");
  await expect(held).toHaveCount(2);
  await expect(held.first()).toHaveText(/^Prayer d4: [1-4]$/);
  await page.goto(sessionUrl);

  // A Wither token on the sheet (Witherwild): Severe Withered damage, until the Fear Die leaves a token (CB 261).
  let tokens = 0;
  for (let attempt = 0; attempt < 5 && tokens === 0; attempt++) {
    const hit = await client.mutation(api.characters.applyDamage, { characterId: characterId as Id<"characters">, damage: 13, useArmorSlot: false, withered: true, idempotencyKey: crypto.randomUUID() });
    tokens = hit.wither && !hit.wither.scarred ? hit.wither.tokens : 0;
  }
  expect(tokens).toBeGreaterThan(0);

  // End: asks first, converts the tokens to GM Fear (K4) and Session 1 is Played; Start now names Session 2.
  await endFromJournal(page);
  await expect(journalReport(page)).toContainText(`Session ended. ${tokens} Wither token${tokens === 1 ? "" : "s"} → +${tokens} Fear.`);
  await expect(list(page).getByRole("button", { name: /^Session 1: / })).not.toHaveAccessibleName(/(Live|Planned)$/);
  await expect(page.getByRole("button", { name: "Start session 2" })).toBeVisible();

  await page.goto(`/campaigns/${campaignId}`);
  await expect(page.getByRole("button", { name: `Fear ${tokens} of 12` })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: `Fear ${tokens + 1} of 12` })).toHaveAttribute("aria-pressed", "false");

  // Phone: the Start button is a 44 px target, no horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  const start = page.getByRole("button", { name: "Start session 2" });
  await expect(start).toBeVisible();
  const box = await start.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(TOUCH_FLOOR_ON_SCREEN);
  await expectNoHorizontalScroll(page);
});
