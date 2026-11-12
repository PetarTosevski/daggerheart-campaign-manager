import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "../a11y";
import { openPlayers } from "../config/helpers";
import { gmAndPlayer } from "../live";
import { TOUCH_FLOOR_ON_SCREEN } from "../zoom";

// Shots for docs/tasks/TASK-GLASS-G2.md (E2E_VISUAL=1): the dashboard and the campaign shell's own buttons as glass
// buttons in the viewer's colours. A Witherwild campaign (time arc, Wither panel, End scene) and a core one (the day
// card) as the GM and as a player at 1440 x 900, 1024 x 768 and 390 x 844; the Start-session, End-scene, End-session
// and Players dialogs; a hovered confirm and a keyboard-focused button, each with axe; 44 px at 1024 and 390.

const OUT = "test-results/visual/GLASS-G2";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

/** The parts of the page G2 owns (the rest of the dashboard is other tracers'). */
const OWNED = [
  'section[aria-label="Campaign header"]',
  'section[aria-labelledby="scene-h"]',
  'section[aria-labelledby="wither-h"]',
  'section[aria-labelledby="last-h"]',
  'section[aria-labelledby="party-h"] > div:first-child',
];

async function shoot(page: Page, name: string, full = true) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", fullPage: full });
}

async function expectAtLeast44(buttons: Locator[]) {
  for (const button of buttons) {
    const box = await button.boundingBox();
    const name = (await button.textContent()) ?? "";
    expect(box, name).not.toBeNull();
    expect(box!.height, name).toBeGreaterThanOrEqual(TOUCH_FLOOR_ON_SCREEN);
  }
}

test("GLASS-G2 Witherwild dashboard as the GM and as a player", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(420_000);
  const table = await gmAndPlayer(browser);
  try {
    for (const [who, page] of [
      ["gm", table.gm],
      ["player", table.player],
    ] as const) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`/campaigns/${table.campaignId}`);
        await expect(page.getByRole("heading", { level: 1, name: table.campaignName })).toBeVisible();
        await expect(page.getByRole("button", { name: "Open the Tome" })).toHaveClass(/\bgb-neutral\b/);
        await shoot(page, `dashboard-${who}-${viewport.width}`);
        if (viewport.width < 1440) {
          const owned = [
            page.getByRole("button", { name: "Open the Tome" }),
            page.getByRole("link", { name: "Open the Journal" }),
            page.getByRole("link", { name: "+ Create character" }),
          ];
          if (who === "gm") {
            owned.push(
              page.getByRole("button", { name: "Start Session", exact: true }),
              page.getByRole("button", { name: "Players" }),
              page.getByRole("button", { name: "End scene" }),
              page.getByTestId("end-day"),
              page.getByRole("button", { name: /^End Session/ }),
            );
          }
          await expectAtLeast44(owned);
        }
      }
    }

    const gm = table.gm;
    await gm.setViewportSize(VIEWPORTS[0]);
    await gm.goto(`/campaigns/${table.campaignId}`);
    const start = gm.getByRole("button", { name: "Start Session", exact: true });
    await expect(start).toHaveClass(/\bgb-confirm\b.*\bgb-lg\b/);
    await expect(gm.getByRole("button", { name: "End scene" })).toHaveClass(/\bgb-danger\b/);
    await expect(gm.getByRole("button", { name: /^End Session/ })).toHaveClass(/\bgb-danger\b/);
    await expect(gm.getByTestId("end-day")).toHaveClass(/\bgb-neutral\b/);

    // Hovered confirm (the GM's Fear fill, gold ink) with axe on G2's parts, then a keyboard-focused Open the Tome.
    await start.hover();
    await gm.waitForTimeout(400);
    await expect(start).toHaveCSS("color", "rgb(243, 207, 134)");
    await shoot(gm, "dashboard-gm-hover-start", false);
    await expectNoSeriousA11yViolations(gm, { include: OWNED });
    await gm.mouse.move(0, 0);
    const tome = gm.getByRole("button", { name: "Open the Tome" });
    await tome.focus();
    await gm.keyboard.press("Shift+Tab");
    await gm.keyboard.press("Tab");
    await expect(tome).toBeFocused();
    await gm.waitForTimeout(400);
    await shoot(gm, "dashboard-gm-focus-tome", false);
    await expectNoSeriousA11yViolations(gm, { include: OWNED });

    // The dialogs: Start session (confirm / cancel), End scene (danger / cancel), End session (danger / cancel), Players.
    for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
      await gm.setViewportSize(viewport);
      await gm.goto(`/campaigns/${table.campaignId}`);
      await gm.getByRole("button", { name: "Start Session", exact: true }).click();
      let dialog = gm.getByRole("dialog", { name: "Start the session?" });
      await expect(dialog.getByRole("button", { name: "Start session", exact: true })).toHaveClass(/\bgb-confirm\b/);
      await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveClass(/\bgb-cancel\b/);
      await shoot(gm, `start-dialog-gm-${viewport.width}`, false);
      await dialog.getByRole("button", { name: "Cancel" }).click();

      await gm.getByRole("button", { name: "End scene" }).click();
      dialog = gm.getByRole("dialog", { name: "End the scene?" });
      await expect(dialog.getByRole("button", { name: "End scene" })).toHaveClass(/\bgb-danger\b/);
      await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveClass(/\bgb-cancel\b/);
      if (viewport.width === 1440) {
        await dialog.getByRole("button", { name: "End scene" }).hover();
        await gm.waitForTimeout(400);
        await expectNoSeriousA11yViolations(gm, { include: "dialog[open]" });
      }
      await shoot(gm, `end-scene-dialog-gm-${viewport.width}`, false);
      await dialog.getByRole("button", { name: "Cancel" }).click();

      await gm.getByRole("button", { name: /^End Session/ }).click();
      dialog = gm.getByRole("dialog", { name: "End the session?" });
      await expect(dialog.getByRole("button", { name: "End session" })).toHaveClass(/\bgb-danger\b/);
      await shoot(gm, `end-session-dialog-gm-${viewport.width}`, false);
      await dialog.getByRole("button", { name: "Cancel" }).click();

      // Config SX (Q10 b): the Players button opens Campaign settings at Players.
      dialog = await openPlayers(gm);
      await expect(dialog.getByRole("button", { name: "Invite", exact: true })).toHaveClass(/\bgb-neutral\b/);
      await shoot(gm, `players-dialog-gm-${viewport.width}`, false);
      await dialog.getByRole("button", { name: "Close campaign settings" }).click();
    }
  } finally {
    await table.close();
  }
});

test("GLASS-G2 core day card: End day and its Undo", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const table = await gmAndPlayer(browser, { frame: "custom" });
  try {
    for (const [who, page] of [
      ["gm", table.gm],
      ["player", table.player],
    ] as const) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`/campaigns/${table.campaignId}`);
        await expect(page.getByTestId("campaign-day")).toBeVisible();
        await shoot(page, `core-dashboard-${who}-${viewport.width}`);
      }
    }
    const gm = table.gm;
    for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
      await gm.setViewportSize(viewport);
      await gm.goto(`/campaigns/${table.campaignId}`);
      const day = gm.getByTestId("campaign-day");
      await day.getByTestId("end-day").click();
      const undo = day.getByTestId("undo-end-day");
      await expect(undo).toHaveClass(/\bgb-cancel\b/);
      await expectAtLeast44([day.getByTestId("end-day"), undo, day.getByTestId("time-of-day-cycle")]);
      await day.screenshot({ path: `${OUT}/day-card-gm-undo-${viewport.width}.png`, animations: "disabled" });
      await undo.click();
      await expect(undo).toBeHidden();
    }
  } finally {
    await table.close();
  }
});
