import { expect as baseExpect, test, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations, expectTouchTargets } from "./a11y";
import { hudScene } from "./hud/helpers";
import { expectNoHorizontalScroll } from "./visual/helpers";

// Plan combat-hud H9.A: the Combat Map's app bar (HANDOFF "App bar"; boards Main, GMDesktop, GMTablet, PlayerTablet).
// User answers 2026-11-04: Q1 (a) the user's nav order and names, Combat Map current with a live dot, the Lorekeeper as
// the gold pill on the right; Q2 (c) the bar on the Combat Map only (56 px, 52 px on tablet; a phone keeps the art
// header) plus a full-screen button that hides it, back with the floating button or Escape; Q3 (c) the GM's gear
// (Players, settings to come) and the avatar (GM initials; a player's character portrait).

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

// The live map adds a screen-reader "(live)" to Combat Map.
const NAV_GM = ["Dashboard", "Party", "Codex", "World Map", /^Combat Map \(live\)$/, "Adversaries", "Sessions", "Notes"];

const bar = (page: Page) => page.getByTestId("app-bar");
const nav = (page: Page) => page.getByRole("navigation", { name: "Campaign sections" });

async function barHeight(page: Page): Promise<number> {
  return Math.round((await bar(page).boundingBox())!.height);
}

test("the GM's and the player's Combat Map app bar: nav, Lorekeeper, full screen, gear and avatar, axe at three sizes", async ({ browser }) => {
  const s = await hudScene(browser);
  const { gm, player } = s;
  try {
    // ---- Another page keeps the tall art header and no bar.
    await expect(gm.getByRole("region", { name: "Campaign header" })).toBeVisible();
    await expect(bar(gm)).toHaveCount(0);

    // ---- GM, desktop 1440 × 900.
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    await expect(bar(gm)).toBeVisible();
    await expect(gm.getByRole("region", { name: "Campaign header" })).toBeHidden();
    expect(await barHeight(gm)).toBe(56);
    await expect(bar(gm).getByText("DAGGERHEART")).toBeVisible();
    await expect(nav(gm).getByRole("link")).toHaveText(NAV_GM);
    const combat = nav(gm).getByRole("link", { name: /^Combat Map/ });
    await expect(combat).toHaveAttribute("aria-current", "page");
    await expect(combat.getByTestId("app-bar-live")).toBeVisible();
    await expect(bar(gm).getByRole("link", { name: "Back to main menu" })).toHaveAttribute("href", "/");
    // The floating pill is gone from the Combat Map: the bar's pill is the only one.
    await expect(gm.getByRole("button", { name: "Ask the Lorekeeper" })).toHaveCount(1);
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=app-bar]" });

    // Keyboard only: the Lorekeeper pill opens the drawer; Escape closes it and focus comes back to the pill.
    const pill = bar(gm).getByRole("button", { name: "Ask the Lorekeeper" });
    await pill.focus();
    await gm.keyboard.press("Enter");
    const drawer = gm.getByRole("dialog", { name: "The Lorekeeper" });
    await expect(drawer).toBeVisible();
    await gm.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(pill).toBeFocused();

    // The gear keeps Players one click away and says settings are coming.
    await bar(gm).getByRole("button", { name: "Campaign settings" }).click();
    const settings = gm.getByRole("dialog", { name: "Campaign settings" });
    await expect(settings.getByText("More campaign settings are on the way.")).toBeVisible();
    await settings.getByRole("button", { name: "Players" }).click();
    const players = gm.getByRole("dialog", { name: "Players" });
    await expect(players).toBeVisible();
    await players.getByRole("button", { name: "Close players" }).click();
    await expect(bar(gm).getByRole("button", { name: "Your preferences" })).toHaveText("GM");

    // Full screen hides the bar; the floating button (focused) and Escape bring it back.
    await bar(gm).getByRole("button", { name: "Full screen: hide the app bar" }).click();
    await expect(bar(gm)).toHaveCount(0);
    const back = gm.getByRole("button", { name: "Show the app bar" });
    await expect(back).toBeFocused();
    await gm.keyboard.press("Escape");
    await expect(bar(gm)).toBeVisible();
    await expect(bar(gm).getByRole("button", { name: "Full screen: hide the app bar" })).toBeFocused();
    await bar(gm).getByRole("button", { name: "Full screen: hide the app bar" }).click();
    await gm.getByRole("button", { name: "Show the app bar" }).click();
    await expect(bar(gm)).toBeVisible();

    // ---- GM, tablet 1024 × 768: 52 px, no wordmark, icon-only Lorekeeper, 44 px targets.
    await gm.setViewportSize({ width: 1024, height: 768 });
    await expect.poll(() => barHeight(gm)).toBe(52);
    await expect(bar(gm).getByText("DAGGERHEART")).toBeHidden();
    await expectTouchTargets(bar(gm).getByRole("link"));
    await expectTouchTargets(bar(gm).getByRole("button"));
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=app-bar]" });

    // ---- GM, phone 390 × 844: today's art header, no bar.
    await gm.setViewportSize({ width: 390, height: 844 });
    await expect(bar(gm)).toBeHidden();
    await expect(gm.getByRole("region", { name: "Campaign header" })).toBeVisible();
    await expect(nav(gm).getByRole("link", { name: "Lorekeeper" })).toBeVisible();
    await expectNoHorizontalScroll(gm);
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=combat-app-frame] > .cab-phone-header" });

    // ---- Player, desktop: no GM-only sections, no gear, the avatar is their character's.
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    // Exactly one bar once the page has settled (a hard load can briefly hold React's streamed copy as well).
    await expect(bar(player)).toHaveCount(1);
    await expect(bar(player)).toBeVisible();
    await expect(nav(player).getByRole("link")).toHaveText(NAV_GM.filter((label) => label !== "Adversaries"));
    await expect(nav(player).getByRole("link", { name: /^Combat Map/ }).getByTestId("app-bar-live")).toBeVisible();
    await expect(bar(player).getByRole("button", { name: "Campaign settings" })).toHaveCount(0);
    const avatar = bar(player).getByRole("button", { name: "Your preferences" });
    await expect(avatar.locator("img")).toHaveCount(1);
    await avatar.click();
    await expect(player.getByRole("dialog", { name: "Your preferences" }).getByText("Your preferences are on the way.")).toBeVisible();
    await player.keyboard.press("Escape");
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=app-bar]" });
  } finally {
    await s.close();
  }
});
