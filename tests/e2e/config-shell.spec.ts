import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations, expectTouchTargets } from "./a11y";
import { appBar, artHeader, avatar, boxSize, gear, gotoSettings, openCampaignSettings, preferences, sectionNav, settingsPanel } from "./config/helpers";
import { gmAndPlayer } from "./live";
import { expectNoHorizontalScroll } from "./visual/helpers";

// Plan config S1 (design reference/designs/config/Settings.dc.html): the gear (GM and co-GM) and the avatar (everyone)
// at the end of the art header and of the Combat Map's app bar. The gear opens the Campaign settings slide-over
// (?settings=<section>, five-section nav, footer; Escape closes, focus comes back), the avatar the Preferences popover
// ('Saved to your account · follows you to every device', Campaign settings for the GM, Sign out). Keyboard only, axe,
// 1440x900, 1024x768 and 390x844 (a phone has the art header only). Shots go to test-results/config-s1/.

test.describe.configure({ timeout: 300_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

/** The popover sits fully inside a `width`-wide viewport. */
async function expectInViewport(locator: Locator, width: number) {
  const box = (await locator.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
}

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/config-s1/${name}.png`, animations: "disabled" });

test("Campaign settings and Preferences from the art header and the Combat Map app bar, GM and player", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId, campaignName } = table;
  const dashboard = `/campaigns/${campaignId}`;
  const combatMap = `${dashboard}/combat-map`;
  try {
    // ---- GM, dashboard, 1440 × 900: gear and avatar at the end of the art header, 40 px.
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(dashboard);
    const header = artHeader(gm);
    await expect(gear(header)).toBeVisible();
    await expect(avatar(header)).toHaveText("GM");
    expect(await boxSize(gear(header))).toEqual({ width: 40, height: 40 });
    expect(await boxSize(avatar(header))).toEqual({ width: 40, height: 40 });
    await expect(gear(header)).toHaveAttribute("aria-expanded", "false");
    // The Players button stays until SX.
    await expect(header.getByRole("button", { name: "Players", exact: true })).toBeVisible();
    await shot(gm, "gm-dashboard-header-1440");

    // Keyboard only: the gear opens the panel on Table, the nav moves through the URL, Escape closes it.
    await gear(header).focus();
    await gm.keyboard.press("Enter");
    const panel = settingsPanel(gm);
    await expect(panel).toBeVisible();
    await expect(gm).toHaveURL(/[?&]settings=table\b/);
    await expect(panel.getByText(`${campaignName} · GM only`)).toBeVisible();
    await expect(panel.getByRole("heading", { level: 2, name: "Campaign settings" })).toBeVisible();
    await expect(panel.getByRole("heading", { level: 3, name: "At the table" })).toBeVisible();
    await expect(panel.getByText("Changes save as you make them and reach every player at once.")).toBeVisible();
    await expect(sectionNav(gm, "Table")).toHaveAttribute("aria-current", "true");
    await expect(sectionNav(gm, "Table")).toBeFocused();
    expect((await boxSize(panel)).width).toBe(640);
    // Flush right once the slide-in has finished.
    await expect.poll(async () => Math.round((await panel.boundingBox())!.x + 640)).toBe(1440);
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=campaign-settings]" });
    await shot(gm, "gm-settings-table-1440");

    await gm.keyboard.press("Tab");
    await expect(sectionNav(gm, "House rules")).toBeFocused();
    await gm.keyboard.press("Enter");
    await expect(gm).toHaveURL(/[?&]settings=rules\b/);
    await expect(panel.getByRole("heading", { level: 3, name: "House rules" })).toBeVisible();
    await expect(sectionNav(gm, "House rules")).toHaveAttribute("aria-current", "true");
    await expect(sectionNav(gm, "Table")).not.toHaveAttribute("aria-current", "true");
    for (const [label, title, id] of [
      ["Players", "Players", "players"],
      ["Lorekeeper", "Lorekeeper", "lorekeeper"],
      ["Sessions", "Sessions", "sessions"],
    ] as const) {
      await sectionNav(gm, label).click();
      await expect(gm).toHaveURL(new RegExp(`[?&]settings=${id}\\b`));
      await expect(panel.getByRole("heading", { level: 3, name: title })).toBeVisible();
    }
    await gm.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(gm).not.toHaveURL(/settings=/);
    await expect(gear(header)).toBeFocused();

    // A shared link opens the panel; a bad value opens Table; the ✕ closes it.
    await gotoSettings(gm, dashboard, "players");
    await expect(settingsPanel(gm).getByRole("heading", { level: 3, name: "Players" })).toBeVisible();
    await gotoSettings(gm, dashboard, "nonsense");
    await expect(settingsPanel(gm).getByRole("heading", { level: 3, name: "At the table" })).toBeVisible();
    await settingsPanel(gm).getByRole("button", { name: "Close campaign settings" }).click();
    await expect(settingsPanel(gm)).toBeHidden();
    await expect(gm).toHaveURL(new RegExp(`${dashboard}$`));

    // The avatar (keyboard): Preferences with the account label, Campaign settings and Sign out; Escape closes.
    await avatar(header).focus();
    await gm.keyboard.press("Enter");
    const prefs = preferences(gm);
    await expect(prefs).toBeVisible();
    await expect(prefs.getByText("Saved to your account · follows you to every device")).toBeVisible();
    await expect(prefs.getByText(/Only on this device/)).toHaveCount(0);
    await expect(prefs.getByText(`Game Master · ${campaignName}`)).toBeVisible();
    await expect(prefs.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=preferences]:popover-open" });
    await shot(gm, "gm-preferences-1440");
    await gm.keyboard.press("Escape");
    await expect(prefs).toBeHidden();
    await expect(avatar(header)).toBeFocused();
    // Its Campaign settings link opens the panel.
    await avatar(header).click();
    await preferences(gm).getByRole("button", { name: "Campaign settings" }).click();
    await expect(preferences(gm)).toBeHidden();
    await expect(settingsPanel(gm)).toBeVisible();
    await gm.keyboard.press("Escape");
    await expect(settingsPanel(gm)).toBeHidden();

    // ---- GM, Combat Map app bar at 1440 and 1024: the same two buttons, 44 px targets on tablet.
    await gm.goto(combatMap);
    const bar = appBar(gm);
    // Exactly one bar once the page has settled (a hard load can briefly hold React's streamed copy as well).
    await expect(bar).toHaveCount(1);
    await expect(bar).toBeVisible();
    await openCampaignSettings(gm, bar);
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=campaign-settings]" });
    await shot(gm, "gm-combat-settings-1440");
    await gm.keyboard.press("Escape");
    await expect(gear(bar)).toBeFocused();
    await avatar(bar).click();
    await expect(preferences(gm).getByRole("button", { name: "Sign out" })).toBeVisible();
    await shot(gm, "gm-combat-preferences-1440");
    await gm.keyboard.press("Escape");

    await gm.setViewportSize({ width: 1024, height: 768 });
    await expect(bar).toBeVisible();
    await expectTouchTargets(gear(bar));
    await expectTouchTargets(avatar(bar));
    await gear(bar).focus();
    await gm.keyboard.press("Enter");
    await expect(settingsPanel(gm)).toBeVisible();
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=campaign-settings]" });
    await shot(gm, "gm-combat-settings-1024");
    await gm.keyboard.press("Escape");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=app-bar]" });

    // ---- GM, phone 390 × 844: the art header only; the panel takes the screen, no sideways scroll.
    await gm.setViewportSize({ width: 390, height: 844 });
    await gm.goto(dashboard);
    await openCampaignSettings(gm, artHeader(gm));
    expect((await boxSize(settingsPanel(gm))).width).toBe(390);
    await expectNoHorizontalScroll(gm);
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=campaign-settings]" });
    await shot(gm, "gm-settings-390");
    await gm.keyboard.press("Escape");
    await avatar(artHeader(gm)).click();
    await expect(preferences(gm).getByRole("button", { name: "Sign out" })).toBeVisible();
    await expectInViewport(preferences(gm), 390);
    await expectNoHorizontalScroll(gm);
    await shot(gm, "gm-preferences-390");
    await gm.keyboard.press("Escape");
    await gm.goto(combatMap);
    await expect(appBar(gm)).toBeHidden();
    await expect(gear(artHeader(gm))).toBeVisible();

    // ---- Player: no gear anywhere, a ?settings= link opens nothing; the avatar opens Preferences.
    await player.setViewportSize({ width: 1440, height: 900 });
    await gotoSettings(player, dashboard, "table");
    const playerHeader = artHeader(player);
    await expect(avatar(playerHeader)).toBeVisible();
    await expect(gear(playerHeader)).toHaveCount(0);
    await expect(settingsPanel(player)).toHaveCount(0);
    await avatar(playerHeader).focus();
    await player.keyboard.press("Enter");
    const playerPrefs = preferences(player);
    await expect(playerPrefs).toBeVisible();
    await expect(playerPrefs.getByText(`Player · ${campaignName}`)).toBeVisible();
    await expect(playerPrefs.getByRole("button", { name: "Campaign settings" })).toHaveCount(0);
    await expect(playerPrefs.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=preferences]:popover-open" });
    await shot(player, "player-preferences-1440");
    await player.keyboard.press("Escape");

    await player.goto(combatMap);
    await expect(appBar(player)).toHaveCount(1);
    await expect(appBar(player)).toBeVisible();
    await expect(gear(appBar(player))).toHaveCount(0);
    await avatar(appBar(player)).click();
    await expect(preferences(player).getByRole("button", { name: "Sign out" })).toBeVisible();
    await shot(player, "player-combat-preferences-1440");
    await player.keyboard.press("Escape");
    await player.setViewportSize({ width: 1024, height: 768 });
    await expectTouchTargets(avatar(appBar(player)));
    await player.setViewportSize({ width: 390, height: 844 });
    await player.goto(dashboard);
    await expect(gear(artHeader(player))).toHaveCount(0);
    await avatar(artHeader(player)).click();
    await expect(preferences(player).getByRole("button", { name: "Sign out" })).toBeVisible();
    await expectInViewport(preferences(player), 390);
    await expectNoHorizontalScroll(player);
    await shot(player, "player-preferences-390");
  } finally {
    await table.close();
  }
});
