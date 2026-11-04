import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { openSessions } from "./visual/helpers";

// Sessions as the hub (TASK-SESSIONS-HUB, user 2026-10-21; Journal JX1 / JX2): a 'Session N' chip on the encounter
// tracker and the Combat Map header leads back to that session's Log & recap in the Journal. The old Play-stage
// Encounter card is gone (Journal JX2); the Plan view's encounter card covers the session's encounter
// (tests/e2e/journal-encounter.spec.ts) and the nav order is in tests/e2e/journal-redirects.spec.ts.

const uuid = () => crypto.randomUUID();

test("the tracker's and the Combat Map's 'Session N' chips open the session's Log & recap in the Journal", async ({ page }) => {
  const { client, campaignId, url } = await openSessions(page);
  const { sessionId } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: uuid() });
  const { encounterId } = await client.mutation(api.sessionPrep.createEncounter, { campaignId, sessionId, idempotencyKey: uuid() });
  const logUrl = new RegExp(`/journal\\?s=${sessionId}&sv=log$`);
  const logSelected = async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Session view" }).getByRole("tab", { name: "Log & recap" })).toHaveAttribute("aria-selected", "true");
  };

  // The tracker deep link lands on the Encounters tab with this encounter open, and its chip leads to the Journal.
  await page.goto(`/campaigns/${campaignId}/adversaries?tab=encounters&encounter=${encounterId}`);
  await expect(page.getByRole("tab", { name: "Encounters" })).toHaveAttribute("aria-selected", "true");
  const trackerRegion = page.getByRole("region", { name: "Encounter tracker" });
  await expect(trackerRegion.getByRole("heading", { name: "Session 1 encounter" })).toBeVisible();
  const chip = trackerRegion.getByRole("link", { name: "Session 1: open it in the Journal" });
  await expect(chip).toHaveText("Session 1");
  await chip.click();
  await expect(page).toHaveURL(logUrl);
  await logSelected();

  // The Combat Map's header chip appears only while the session is live.
  await page.goto(`/campaigns/${campaignId}/combat-map`);
  await expect(page.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
  await expect(page.getByTestId("session-chip")).toHaveCount(0);
  await client.mutation(api.sessions.start, { campaignId, sessionId, idempotencyKey: uuid() });
  const liveChip = page.getByRole("link", { name: "Session 1, live: open it in the Journal" });
  await expect(liveChip).toBeVisible();
  await liveChip.click();
  await expect(page).toHaveURL(logUrl);
  await logSelected();
  expect(url).toBe(`/campaigns/${campaignId}/journal`);
});

test("without params the Adversaries page opens on the Catalogue, and a tab change leaves the URL alone", async ({ page }) => {
  const { campaignId } = await openSessions(page);
  await page.goto(`/campaigns/${campaignId}/adversaries`);
  const tabs = page.getByRole("tablist", { name: "Adversary views" });
  await expect(tabs.getByRole("tab", { name: "Catalogue" })).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("tab", { name: "Encounters" }).click();
  await expect(tabs.getByRole("tab", { name: "Encounters" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(`/campaigns/${campaignId}/adversaries`);
  // A deep link to a tab with no encounter opens that tab; an unknown tab falls back to the Catalogue.
  await page.goto(`/campaigns/${campaignId}/adversaries?tab=environment`);
  await expect(tabs.getByRole("tab", { name: "Environment" })).toHaveAttribute("aria-selected", "true");
  await page.goto(`/campaigns/${campaignId}/adversaries?tab=nonsense`);
  await expect(tabs.getByRole("tab", { name: "Catalogue" })).toHaveAttribute("aria-selected", "true");
});
