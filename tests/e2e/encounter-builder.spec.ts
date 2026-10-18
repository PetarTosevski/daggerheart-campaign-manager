import { expect, test, type Browser, type Page } from "@playwright/test";
import { ConvexError } from "convex/values";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { convexAs, expectNoHorizontalScroll } from "./visual/helpers";

// D8 A3: the GM builds an encounter on the Adversaries page's Encounters tab and reads its Battle Points budget
// (CB p.197); players cannot reach encounters through the API.

const PLAYER = "e2e-player@example.test";

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Encounters ${crypto.randomUUID().slice(0, 8)}`;
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

async function addAdversary(page: Page, search: string, pick: string, amount?: { label: string; value: string }) {
  await page.getByRole("button", { name: "+ Add adversary" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to encounter" });
  await dialog.getByPlaceholder("Search by name or type").fill(search);
  await dialog.getByRole("list", { name: "Matching adversaries" }).getByRole("button", { name: pick }).click();
  if (amount) {
    await expect(dialog.getByLabel(amount.label)).toBeVisible();
    await dialog.getByLabel(amount.label).fill(amount.value);
  }
  await dialog.getByRole("button", { name: "Add to encounter", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("the GM builds an encounter, reads its Battle Points and starts it; a player gets FORBIDDEN from the API", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  await page.goto(`/campaigns/${campaignId}/adversaries`);
  await page.getByRole("tab", { name: "Encounters" }).click();
  const panel = page.getByRole("tabpanel", { name: "Encounters" });
  await expect(panel.getByText("No encounters yet.")).toBeVisible();

  await panel.getByRole("button", { name: "+ New encounter" }).click();
  const nameField = panel.getByLabel("Encounter name");
  await expect(nameField).toHaveValue("New encounter");
  await nameField.fill("Ambush at the ford");
  await nameField.press("Enter");
  const list = panel.getByRole("navigation", { name: "Encounter list" });
  await expect(list.getByRole("button", { name: /Ambush at the ford/ })).toBeVisible();

  // 2 Bears (Bruiser, 4 BP each) and one Jagged Knife Lackey group of 4 (one group the size of the party: 1 BP).
  await addAdversary(page, "bear", "Bear, Tier 1 Bruiser", { label: "How many", value: "2" });
  await addAdversary(page, "lackey", "Jagged Knife Lackey, Tier 1 Minion");
  const rows = panel.getByRole("list", { name: "Adversaries in this encounter" });
  await expect(rows.getByRole("listitem")).toHaveCount(3);
  for (const label of ["Bear", "Bear 2", "Jagged Knife Lackey ×4"]) await expect(rows.getByText(label, { exact: true })).toBeVisible();

  const spent = panel.getByTestId("bp-spent");
  await expect(spent).toHaveText(/Spent 9 of 14/);
  await expect(spent).toHaveText(/5 BP left/);
  const harder = panel.getByRole("button", { name: /Harder or longer fight/ });
  await harder.click();
  await expect(harder).toHaveAttribute("aria-pressed", "true");
  await expect(spent).toHaveText(/Spent 9 of 16/);

  // The party-size stepper: with 3 PCs the 4 Lackeys are 2 groups (2 BP) and the budget is 11 + 2.
  await panel.getByRole("button", { name: "Fewer player characters" }).click();
  await expect(spent).toHaveText(/Spent 10 of 13/);
  await panel.getByRole("button", { name: "More player characters" }).click();
  await expect(spent).toHaveText(/Spent 9 of 16/);

  await panel.getByRole("button", { name: "▶ Start encounter" }).click();
  await expect(panel.getByText("Encounter running")).toBeVisible();
  await expect(list.getByRole("button", { name: /Ambush at the ford/ })).toContainText("Running");

  const { player, close } = await playerJoins(page, browser, name);
  const client = await convexAs(player);
  const error: unknown = await client.query(api.encounters.list, { campaignId }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe("FORBIDDEN");
  await close();
});

test("at 390 px the builder stacks without horizontal scroll and every control has a 44 px target", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/campaigns/${campaignId}/adversaries`);
  await page.getByRole("tab", { name: "Encounters" }).click();
  const panel = page.getByRole("tabpanel", { name: "Encounters" });
  await panel.getByRole("button", { name: "+ New encounter" }).click();
  await addAdversary(page, "bear", "Bear, Tier 1 Bruiser");
  await expect(panel.getByTestId("bp-spent")).toHaveText(/Spent 4 of 14/);
  await expectNoHorizontalScroll(page);
  for (const control of await panel.getByRole("button").all()) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
