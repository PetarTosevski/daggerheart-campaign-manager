import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";
import { expectNoHorizontalScroll, openSessions } from "./visual/helpers";

// D10 S4: Prep (B3, K6, K10, Q1). The GM plans a Combat and a Social scene, writes hooks, creates the session's D8
// encounter and builds it with D8's Battle Points panel and add dialog; everything survives a reload. A player who
// opens the session with ?stage=prep sees only the read-only session view.

const PLAYER = "e2e-player@example.test";

async function playerJoins(page: Page, browser: Browser, campaignId: string, campaignName: string) {
  await page.goto(`/campaigns/${campaignId}`);
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

async function addBandits(page: Page, count: string) {
  await page.getByRole("button", { name: "+ Add adversary" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to encounter" });
  await dialog.getByPlaceholder("Search by name or type").fill("bandit");
  await dialog.getByRole("list", { name: "Matching adversaries" }).getByRole("button", { name: "Jagged Knife Bandit, Tier 1 Standard" }).click();
  await dialog.getByLabel("How many").fill(count);
  await dialog.getByRole("button", { name: "Add to encounter", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("the GM plans scenes and hooks and builds the session encounter; reload keeps it; a player sees the read-only view", async ({ page, browser }) => {
  const { campaignId, campaignName, url } = await openSessions(page);
  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(page).toHaveURL(/stage=prep$/);
  const sessionUrl = new URL(page.url());
  const prep = page.getByRole("tabpanel");

  // Planned scenes: empty copy, then a Combat and a Social scene.
  await expect(prep.getByText(/^Plan a few scenes/)).toBeVisible();
  await prep.getByRole("button", { name: "+ Scene" }).click();
  await expect(prep.getByLabel("Scene 1 description")).toBeEnabled();
  await prep.getByLabel("Scene 1 description").fill("Ambush at the ford");
  await prep.getByLabel("Scene 1 description").press("Enter");
  await prep.getByRole("button", { name: "+ Scene" }).click();
  await expect(prep.getByLabel("Scene 2 type")).toBeEnabled();
  await prep.getByLabel("Scene 2 type").selectOption("social");
  await prep.getByLabel("Scene 2 description").fill("Bargain with the ferryman");
  await prep.getByLabel("Scene 2 description").blur();
  await expect(prep.getByLabel("Scene 1 type")).toHaveValue("combat");

  // Hooks.
  const hooks = prep.getByRole("textbox", { name: "Hooks & loose threads" });
  await hooks.fill("The miller owes Thane money.");
  await hooks.blur();

  // The session encounter: create it, then two Bandits through D8's add dialog move the verdict (4 PCs: 14 BP).
  await prep.getByRole("button", { name: "Create the session encounter" }).click();
  await expect(prep.getByRole("heading", { name: "Session 1 encounter" })).toBeVisible();
  const spent = prep.getByTestId("bp-spent");
  await expect(spent).toHaveText(/Spent 0 of 14/);
  await expect(spent).toContainText("14 BP left");
  await addBandits(page, "2");
  await expect(spent).toHaveText(/Spent 4 of 14/);
  await expect(spent).toContainText("10 BP left");
  await expect(prep.getByRole("list", { name: "Adversaries in this encounter" }).getByRole("listitem")).toHaveCount(2);
  // D8's adjustments and party stepper work in place.
  await prep.getByRole("button", { name: /Harder or longer fight/ }).click();
  await expect(spent).toHaveText(/Spent 4 of 16/);
  await prep.getByRole("button", { name: "Fewer player characters" }).click();
  await expect(spent).toHaveText(/Spent 4 of 13/);

  // Reload keeps all of it.
  await page.reload();
  await expect(prep.getByLabel("Scene 1 description")).toHaveValue("Ambush at the ford");
  await expect(prep.getByLabel("Scene 2 type")).toHaveValue("social");
  await expect(prep.getByLabel("Scene 2 description")).toHaveValue("Bargain with the ferryman");
  await expect(prep.getByRole("textbox", { name: "Hooks & loose threads" })).toHaveValue("The miller owes Thane money.");
  await expect(prep.getByTestId("bp-spent")).toHaveText(/Spent 4 of 13/);
  await expect(prep.getByTestId("bp-spent")).toContainText("9 BP left");

  // Removing a scene; unlinking keeps the encounter (it can be linked again).
  await prep.getByRole("button", { name: "Remove scene 1" }).click();
  await expect(prep.getByLabel("Scene 1 description")).toHaveValue("Bargain with the ferryman");
  await prep.getByRole("button", { name: "Unlink" }).click();
  await expect(prep.getByRole("button", { name: "Create the session encounter" })).toBeVisible();
  await expect(prep.getByLabel("Link an encounter")).toHaveValue(/.+/);
  await prep.getByRole("button", { name: "Link", exact: true }).click();
  await expect(prep.getByRole("heading", { name: "Session 1 encounter" })).toBeVisible();
  await expect(prep.getByTestId("bp-spent")).toHaveText(/Spent 4 of 13/);

  // A player (the session played, so they may see it) opening ?stage=prep gets the read-only view only (K10, Q4).
  await page.getByRole("region", { name: "Session", exact: true }).getByRole("button", { name: "Mark as played" }).click();
  await expect(page.getByRole("button", { name: "Mark as not played" })).toBeVisible();
  // The button flips optimistically; a reload shows the server has it before the player looks.
  await page.reload();
  await expect(page.getByRole("button", { name: "Mark as not played" })).toBeVisible();
  const { player, close } = await playerJoins(page, browser, campaignId, campaignName);
  try {
    await player.goto(`${url}?s=${sessionUrl.searchParams.get("s")}&stage=prep`);
    const view = player.getByRole("region", { name: "Session detail" }).getByRole("region", { name: "Session", exact: true });
    await expect(view.getByRole("heading", { name: "Recap" })).toBeVisible();
    await expect(player.getByRole("tablist", { name: "Session stage" })).toHaveCount(0);
    await expect(player.getByRole("heading", { name: "Planned scenes" })).toHaveCount(0);
    await expect(player.getByText("The miller owes Thane money.")).toHaveCount(0);
    await expect(player.getByText("Session 1 encounter")).toHaveCount(0);
    await expect(player.getByRole("textbox")).toHaveCount(0);
  } finally {
    await close();
  }
});

test("Prep fits a phone: one column, labelled 44 px controls, no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSessions(page);
  await page.getByRole("button", { name: "+ New session" }).click();
  const prep = page.getByRole("tabpanel");
  await prep.getByRole("button", { name: "+ Scene" }).click();
  await expect(prep.getByLabel("Scene 1 description")).toBeEnabled();
  await prep.getByRole("button", { name: "Create the session encounter" }).click();
  await expect(prep.getByTestId("bp-spent")).toBeVisible();
  await expectNoHorizontalScroll(page);
  for (const control of [
    prep.getByLabel("Scene 1 type"),
    prep.getByLabel("Scene 1 description"),
    prep.getByRole("button", { name: "Remove scene 1" }),
    prep.getByRole("button", { name: "+ Scene" }),
    prep.getByRole("button", { name: "+ Add adversary" }),
    prep.getByRole("button", { name: "Unlink" }),
    prep.getByRole("button", { name: "More player characters" }),
  ]) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // One column: the encounter builder sits under the hooks.
  const hooks = (await prep.getByRole("textbox", { name: "Hooks & loose threads" }).boundingBox())!;
  const builder = (await prep.getByTestId("bp-spent").boundingBox())!;
  expect(builder.y).toBeGreaterThan(hooks.y + hooks.height);
});
