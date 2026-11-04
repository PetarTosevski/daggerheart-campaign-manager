import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "../a11y";
import { openJournal, seedJournal, type JournalTable } from "../journal/helpers";

// Shots for docs/tasks/TASK-GLASS-G12.md (E2E_VISUAL=1): the Journal's buttons as glass buttons (plan
// .omc/plans/glass-buttons.yaml, G12). The GM's Plan and Log & recap, the scene menu and the End dialog, and the
// player's view, at 1440 x 900, 1024 x 768 and 390 x 844; a hovered confirm and a keyboard-focused button pass axe;
// the recap parchment keeps ink-on-paper buttons (Q5 a); every glass button is at least 44 px tall on touch widths.

const OUT = "test-results/visual/GLASS-G12";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

async function shoot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", fullPage: true });
}

/** On tablet and phone widths, every visible glass button in the Journal is at least 44 px tall (and icons wide). */
async function expectTouchTargets(page: Page) {
  const small = await page.locator(".jr-root .gb").evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "", ...el.getBoundingClientRect().toJSON() }))
      .filter((r: { width: number; height: number }) => r.height < 43.5 || r.width < 43.5),
  );
  expect(small).toEqual([]);
}

async function expectRole(button: Locator, role: string) {
  await expect(button).toHaveClass(new RegExp(`\\bgb-${role}\\b`));
}

test("GLASS-G12 the GM's Plan, Log & recap, scene menu and End dialog", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(420_000);
  const table: JournalTable = await seedJournal(browser);
  try {
    const { gm, liveSessionId } = table;
    for (const viewport of VIEWPORTS) {
      const w = viewport.width;
      await gm.setViewportSize(viewport);

      await openJournal(gm, table, `?s=${liveSessionId}&sv=plan`);
      await expect(gm.getByTestId("scene-encounter")).toBeVisible();
      await expectRole(gm.getByRole("button", { name: "End session" }), "danger");
      await expectRole(gm.getByRole("button", { name: /^Plan session \d+$/ }), "confirm");
      await expectRole(gm.getByRole("link", { name: "Play on the Combat Map" }), "confirm");
      await expectRole(gm.getByRole("button", { name: "Add scene" }), "neutral");
      await expectRole(gm.getByRole("button", { name: "Open the Campaign Tome" }), "neutral");
      await shoot(gm, `gm-plan-${w}`);
      if (w < 1100) await expectTouchTargets(gm);

      // The scene menu: neutral items, the chosen type switched on, Remove scene in ember.
      await gm.getByRole("button", { name: "Scene 1 options" }).click();
      const remove = gm.getByRole("button", { name: "Remove scene" });
      await expectRole(remove, "danger");
      await expect(gm.getByRole("button", { name: "Exploration", pressed: true })).toBeVisible();
      await shoot(gm, `gm-scene-menu-${w}`);
      await gm.keyboard.press("Escape");

      await openJournal(gm, table, `?s=${liveSessionId}&sv=log`);
      await expect(gm.getByRole("button", { name: "Add", exact: true })).toBeVisible();
      await expectRole(gm.getByRole("button", { name: "Add", exact: true }), "neutral");
      // Q5 (a): the recap parchment keeps its ink buttons, not glass.
      const write = gm.getByRole("button", { name: /^(Write the recap|Edit recap)$/ });
      await expect(write).toHaveClass(/\bjrr-btn\b/);
      await expect(write).not.toHaveClass(/\bgb\b/);
      await shoot(gm, `gm-log-${w}`);
      if (w < 1100) await expectTouchTargets(gm);
    }

    // The End dialog at 1440: Cancel backs out (Hope for the GM), End session is ember.
    await gm.setViewportSize(VIEWPORTS[0]);
    await openJournal(gm, table, `?s=${liveSessionId}&sv=plan`);
    await gm.getByRole("button", { name: "End session" }).click();
    const dialog = gm.getByRole("dialog", { name: "End the session?" });
    await expect(dialog).toBeVisible();
    await expectRole(dialog.getByRole("button", { name: "Cancel" }), "cancel");
    await expectRole(dialog.getByRole("button", { name: "End session" }), "danger");
    await gm.screenshot({ path: `${OUT}/gm-end-dialog-1440.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // A hovered confirm (the GM's Fear fill) and a keyboard-focused button pass axe.
    const plan = gm.getByRole("button", { name: /^Plan session \d+$/ });
    await plan.hover();
    await gm.waitForTimeout(400);
    await gm.screenshot({ path: `${OUT}/gm-hover-confirm-1440.png`, animations: "disabled" });
    await expectNoSeriousA11yViolations(gm, { include: ".jr-root" });
    await gm.mouse.move(0, 0);
    const addScene = gm.getByRole("button", { name: "Add scene" });
    await addScene.focus();
    await gm.keyboard.press("Shift+Tab");
    await gm.keyboard.press("Tab");
    await expect(addScene).toBeFocused();
    await gm.waitForTimeout(400);
    await gm.screenshot({ path: `${OUT}/gm-focus-add-scene-1440.png`, animations: "disabled" });
    await expectNoSeriousA11yViolations(gm, { include: ".jr-root" });
  } finally {
    await table.close();
  }
});

test("GLASS-G12 the player's Journal", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const table: JournalTable = await seedJournal(browser);
  try {
    const { player, liveSessionId } = table;
    for (const viewport of VIEWPORTS) {
      const w = viewport.width;
      await player.setViewportSize(viewport);
      await openJournal(player, table, `?s=${liveSessionId}`);
      await expect(player.getByTestId("journal-live-chip")).toBeVisible();
      await expectRole(player.getByRole("link", { name: "Play on the Combat Map" }), "confirm");
      await expect(player.getByRole("button", { name: "End session" })).toHaveCount(0);
      await shoot(player, `player-${w}`);
      if (w < 1100) await expectTouchTargets(player);
    }
    await player.setViewportSize(VIEWPORTS[0]);
    await openJournal(player, table, `?s=${liveSessionId}`);
    const play = player.getByRole("link", { name: "Play on the Combat Map" });
    await play.hover();
    await player.waitForTimeout(400);
    await player.screenshot({ path: `${OUT}/player-hover-confirm-1440.png`, animations: "disabled" });
    await expectNoSeriousA11yViolations(player, { include: ".jr-root" });
  } finally {
    await table.close();
  }
});
