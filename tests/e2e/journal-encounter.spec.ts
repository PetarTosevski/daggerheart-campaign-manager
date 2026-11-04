import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { openJournal, seedJournal, type JournalTable } from "./journal/helpers";

// Journal JP2 (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JP2.md): on the Plan view, the Combat scene's
// encounter card (chips, 'On the Combat Map', 'Open map', 'Edit in Adversaries', create / link / unlink) and the
// 'Battle points · Scene N' panel (the Adversaries builder's BudgetPanel, journal variant). The components mount in
// JP1's scene cards and right column; the spec finds them by their test ids.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

let table: JournalTable;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  table = await seedJournal(browser);
  // The live map holds the session encounter's tokens: 'On the Combat Map' (JD4 onMap). Placing it plays scene 3.
  const { client, campaignId } = table;
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Forest camp", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
  await client.mutation(api.combatTokens.placeSessionEncounter, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
});

test.afterAll(async () => {
  await table?.close();
});

const card = (page: Page) => page.getByTestId("scene-encounter");
const panel = (page: Page) => page.getByTestId("bp-panel");

async function openPlan(page: Page) {
  await page.setViewportSize(VIEWPORTS[0]);
  await openJournal(page, table, `?s=${table.liveSessionId}&sv=plan`);
}

test("GM: the Combat scene's encounter card and its Battle Points", async () => {
  const { gm, campaignId, encounterId } = table;
  await openPlan(gm);

  await expect(card(gm).getByRole("heading", { name: "Encounter · Jagged Knife ambush" })).toBeVisible();
  const chips = card(gm).getByRole("list", { name: "Adversaries in this encounter" }).getByRole("listitem");
  await expect(chips).toHaveText([/Lieutenant\s*Leader · 3/, /Bandit ×2\s*Standard · 4/, /Sniper\s*Ranged · 2/, /Lackey ×4\s*Minion · 1/]);
  await expect(card(gm).getByTestId("scene-encounter-on-map")).toHaveText("On the Combat Map");
  await expect(card(gm).getByRole("link", { name: "Open map" })).toHaveAttribute("href", `/campaigns/${campaignId}/combat-map`);
  await expect(card(gm).getByRole("link", { name: "Edit in Adversaries" })).toHaveAttribute("href", `/campaigns/${campaignId}/adversaries?tab=encounters&encounter=${encounterId}`);

  await expect(panel(gm).getByRole("heading", { name: "Battle points · Scene 3" })).toBeVisible();
  await expect(panel(gm).getByTestId("bp-spent")).toHaveText(/10\s*of 14 spent\s*4 left/);
  await expect(panel(gm).getByTestId("bp-party")).toHaveText(/Party of 4: 3 × 4 \+ 2\s*14/);
  await expect(panel(gm).getByRole("list", { name: "Battle Point costs" }).getByRole("listitem")).toHaveCount(6);

  for (const viewport of VIEWPORTS) {
    await gm.setViewportSize(viewport);
    await expect(card(gm)).toBeVisible();
    await expectFitsViewport(gm);
    await expectNoSeriousA11yViolations(gm);
  }
});

test("GM: unlink, create for the scene, adjust the budget, open it in Adversaries: the same encounter", async () => {
  const { gm, campaignId } = table;
  await openPlan(gm);

  await card(gm).getByRole("button", { name: "Unlink Jagged Knife ambush from this scene" }).click();
  await expect(card(gm).getByRole("button", { name: "Create encounter" })).toBeVisible();
  await expect(panel(gm)).toHaveCount(0);
  await expect(gm.getByText("No encounter yet. Create or link one on the scene to see its Battle Points.")).toBeVisible();

  await card(gm).getByRole("button", { name: "Create encounter" }).click();
  await expect(card(gm).getByRole("heading", { name: "Encounter · Session 6 · Scene 3" })).toBeVisible();
  await expect(card(gm).getByText(/No adversaries yet/)).toBeVisible();
  await expect(panel(gm).getByTestId("bp-spent")).toHaveText(/0\s*of 14 spent\s*14 left/);

  const harder = panel(gm).getByRole("button", { name: /Harder or longer fight/ });
  await harder.click();
  await expect(harder).toHaveAttribute("aria-pressed", "true");
  await expect(panel(gm).getByTestId("bp-spent")).toHaveText(/0\s*of 16 spent\s*16 left/);
  await expect(panel(gm)).toHaveAttribute("aria-busy", "false");

  await card(gm).getByRole("link", { name: "Edit in Adversaries" }).click();
  await expect(gm).toHaveURL(new RegExp(`/campaigns/${campaignId}/adversaries\\?tab=encounters&encounter=`));
  await expect(gm.getByRole("navigation", { name: "Encounter list" }).getByRole("button", { name: /Session 6 · Scene 3/ })).toHaveAttribute("aria-current", "true");
  const builder = gm.getByTestId("bp-panel").first();
  await expect(builder.getByTestId("bp-spent")).toContainText("Spent 0 of 16");
  await expect(builder.getByRole("button", { name: /Harder or longer fight/ })).toHaveAttribute("aria-pressed", "true");
});

test("GM: link an existing encounter back to the scene", async () => {
  const { gm } = table;
  await openPlan(gm);
  await card(gm).getByRole("button", { name: /^Unlink .* from this scene$/ }).click();
  const select = card(gm).getByRole("combobox", { name: "Link an encounter" });
  await select.selectOption({ label: "Jagged Knife ambush (Running)" });
  await card(gm).getByRole("button", { name: "Link", exact: true }).click();
  await expect(card(gm).getByRole("heading", { name: "Encounter · Jagged Knife ambush" })).toBeVisible();
  await expect(panel(gm).getByTestId("bp-spent")).toHaveText(/10\s*of 14 spent\s*4 left/);
});
