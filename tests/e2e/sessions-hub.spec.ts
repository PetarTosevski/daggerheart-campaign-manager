import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoHorizontalScroll, openSessions } from "./visual/helpers";

// Sessions as the hub (TASK-SESSIONS-HUB, user 2026-10-21): the Play stage's Encounter card pulls in the session's
// D8 encounter (adversaries with HP and Stress, Start / Open in tracker, Open the map); the tracker deep link lands on
// the encounter; a 'Session N' chip on the tracker and the Combat Map header leads back to Play; the nav puts
// Sessions before Combat Map and Adversaries.

const uuid = () => crypto.randomUUID();
const SHOTS = "test-results/visual/SESSIONS-HUB";

test("the nav reads Dashboard · Party · World · Characters & Locations · Sessions · Combat Map · Adversaries · Notes · Lorekeeper", async ({ page }) => {
  await openSessions(page);
  const nav = page.getByRole("navigation", { name: "Campaign sections" });
  await expect(nav.getByRole("link")).toHaveText([
    "Dashboard",
    "Party",
    "World",
    "Characters & Locations",
    "Sessions",
    "Combat Map",
    "Adversaries",
    "Notes",
    "Lorekeeper",
  ]);
  await expect(nav.getByRole("link", { name: "Sessions" })).toHaveAttribute("aria-current", "page");
});

test("the Play stage's Encounter card: none → Prep, the linked encounter, Start (refused while another runs), the tracker deep link and the chips", async ({ page }) => {
  const { client, campaignId, url } = await openSessions(page);
  const { sessionId } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: uuid() });
  const play = `${url}?s=${sessionId}&stage=play`;

  // No encounter linked: a short line that opens Prep.
  await page.goto(play);
  const card = page.getByRole("region", { name: "Encounter", exact: true });
  await expect(card.getByText("No encounter is linked to this session.")).toBeVisible();
  await card.getByRole("link", { name: "Build or link one in Prep" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?s=${sessionId}&stage=prep$`));
  await expect(page.getByRole("tab", { name: "Prep" })).toHaveAttribute("aria-selected", "true");

  // Link the session's encounter (two Bandits) and come back to Play.
  const { encounterId } = await client.mutation(api.sessionPrep.createEncounter, { campaignId, sessionId, idempotencyKey: uuid() });
  await client.mutation(api.encounters.addAdversary, {
    campaignId,
    encounterId,
    source: { kind: "srd", adversaryId: "jagged-knife-bandit" },
    count: 2,
    summoned: false,
    idempotencyKey: uuid(),
  });
  await page.goto(play);
  await expect(card.getByText("Session 1 encounter")).toBeVisible();
  await expect(card.getByText("Draft", { exact: true })).toBeVisible();
  const rows = card.getByRole("list", { name: "Adversaries" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: /HP 0\/\d+/ })).toHaveCount(2);
  await expect(card.getByRole("link", { name: "Open in tracker" })).toHaveCount(0);

  // Another encounter is running: D8's refusal, and the card stays a draft.
  const { encounterId: wolves } = await client.mutation(api.encounters.create, { campaignId, name: "Wolves", idempotencyKey: uuid() });
  await client.mutation(api.encounters.start, { campaignId, encounterId: wolves });
  await card.getByRole("button", { name: "▶ Start encounter" }).click();
  await expect(card.getByRole("alert")).toHaveText("Another encounter is already running. End it first.");
  await expect(card.getByText("Draft", { exact: true })).toBeVisible();
  await client.mutation(api.encounters.end, { campaignId, encounterId: wolves });

  // Start: Running, and 'Open in tracker' takes the button's place.
  await card.getByRole("button", { name: "▶ Start encounter" }).click();
  await expect(card.getByText("Running", { exact: true })).toBeVisible();
  await expect(card.getByRole("alert")).toHaveCount(0);
  const tracker = card.getByRole("link", { name: "Open in tracker" });
  await expect(tracker).toHaveAttribute("href", `/campaigns/${campaignId}/adversaries?tab=encounters&encounter=${encounterId}`);
  await expect(card.getByRole("link", { name: "Open the map" })).toHaveAttribute("href", `/campaigns/${campaignId}/combat-map`);

  // HP marked in the tracker shows up here live (read-only). Wait for the server to run the encounter first.
  await expect.poll(async () => (await client.query(api.encounters.get, { campaignId, encounterId }))?.encounter.status).toBe("running");
  const view = await client.query(api.encounters.get, { campaignId, encounterId });
  // The second Bandit ('Jagged Knife Bandit 2'): its label is not a prefix of the other one's.
  const second = view!.instances[1]!;
  await client.mutation(api.encounterTracking.markHp, { campaignId, instanceId: second._id, delta: 2, idempotencyKey: uuid() });
  await expect(rows.filter({ hasText: second.label })).toContainText(`HP 2/${second.stats.hpMax}`);
  await expect(card.getByRole("button")).toHaveCount(0);

  // Screenshots of the card (1440 and 390); the phone has no horizontal scroll and 44 px targets.
  await page.setViewportSize({ width: 1440, height: 900 });
  await card.screenshot({ path: `${SHOTS}/play-encounter-1440.png`, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  for (const target of await card.getByRole("link").all()) {
    const box = (await target.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await card.screenshot({ path: `${SHOTS}/play-encounter-390.png`, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 900 });

  // The deep link lands on the Encounters tab with this encounter open in the tracker, and its chip leads back.
  await tracker.click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/adversaries?tab=encounters&encounter=${encounterId}`);
  await expect(page.getByRole("tab", { name: "Encounters" })).toHaveAttribute("aria-selected", "true");
  const trackerRegion = page.getByRole("region", { name: "Encounter tracker" });
  await expect(trackerRegion.getByRole("heading", { name: "Session 1 encounter" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Encounter detail" }).getByLabel("Encounter name")).toHaveValue("Session 1 encounter");
  const chip = trackerRegion.getByRole("link", { name: "Session 1: open its Play stage" });
  await expect(chip).toHaveText("Session 1");
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`/sessions\\?s=${sessionId}&stage=play$`));
  await expect(page.getByRole("tab", { name: "Play" })).toHaveAttribute("aria-selected", "true");

  // 'Open the map' opens the Combat Map normally; its header chip appears only while the session is live.
  await card.getByRole("link", { name: "Open the map" }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/combat-map`);
  await expect(page.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
  await expect(page.getByTestId("session-chip")).toHaveCount(0);
  await client.mutation(api.sessions.start, { campaignId, sessionId, idempotencyKey: uuid() });
  const liveChip = page.getByRole("link", { name: "Session 1, live: open its Play stage" });
  await expect(liveChip).toBeVisible();
  await liveChip.click();
  await expect(page).toHaveURL(new RegExp(`/sessions\\?s=${sessionId}&stage=play$`));
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
