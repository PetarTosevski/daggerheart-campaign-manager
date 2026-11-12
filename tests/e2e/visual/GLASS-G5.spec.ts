import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "../a11y";
import { gmAndPlayer } from "../live";
import { TOUCH_FLOOR_ON_SCREEN } from "../zoom";

// Shots for docs/tasks/TASK-GLASS-G5.md (E2E_VISUAL=1): the Party page, a roster card's delete confirm, the
// new-character wizard, the dashboard's rest launcher (idle, under way, after) and party cards, and the sheet (its
// portrait button; the level-up ▲ stays as it is under Q3 a), as the GM and as a player at 1440 x 900, 1024 x 768 and
// 390 x 844; a hovered confirm and a keyboard-focused button, with axe on the hovered state; small buttons 44 px on a
// tablet. Photo import has no shots: the e2e backend has no ANTHROPIC_API_KEY, so its button stays hidden
// (photo-import.spec.ts); its buttons are covered by the photo-import unit tests.

const OUT = "test-results/visual/GLASS-G5";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

async function shoot(page: Page, name: string, fullPage = false) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", fullPage });
}

/** Keyboard focus on `name` (Tab into it, so :focus-visible applies). */
async function keyboardFocus(page: Page, locator: ReturnType<Page["locator"]>) {
  await locator.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(locator).toBeFocused();
  await page.waitForTimeout(400);
}

test("GLASS-G5 the Party page, the wizard, the rest launcher and the sheet as the GM and as a player", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(600_000);
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId, characterName, client } = table;
  try {
    // A level-up pending, so the sheet shows the ▲ (unchanged) and the cards their badge.
    await client.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: crypto.randomUUID() });

    // ── Party page ──
    for (const [who, page] of [
      ["gm", gm],
      ["player", player],
    ] as const) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`/campaigns/${campaignId}/party`);
        await expect(page.getByRole("article", { name: characterName })).toBeVisible();
        await shoot(page, `party-${who}-${viewport.width}`, true);
      }
      await page.setViewportSize(VIEWPORTS[0]);
      const create = page.getByRole("link", { name: "+ Create character" });
      await expect(create).toHaveClass(/\bgb-confirm\b/);
      await create.hover();
      await page.waitForTimeout(400);
      await shoot(page, `party-${who}-hover-create`);
      await expectNoSeriousA11yViolations(page, { include: "main" });
      await page.mouse.move(0, 0);
      const open = page.getByRole("link", { name: "Open character sheet" });
      await keyboardFocus(page, open);
      await shoot(page, `party-${who}-focus-open-sheet`);
      await expectNoSeriousA11yViolations(page, { include: "main" });
    }

    // The GM's delete confirm on a roster card: Delete (danger) opens it; Keep is a cancel (Hope for the GM).
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await gm.goto(`/campaigns/${campaignId}/party`);
      const card = gm.getByRole("article", { name: characterName });
      await card.getByRole("button", { name: `Delete ${characterName}` }).click();
      const confirm = card.getByRole("alertdialog", { name: `Delete ${characterName}` });
      await expect(confirm.getByRole("button", { name: "Keep" })).toHaveClass(/\bgb-cancel\b/);
      await expect(confirm.getByRole("button", { name: "Delete character" })).toHaveClass(/\bgb-danger\b/);
      if (viewport.width === 1024) {
        // Touch / tablet width: the small glass buttons are 44 px tall.
        for (const name of ["Keep", "Delete character"]) {
          const box = await confirm.getByRole("button", { name }).boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(TOUCH_FLOOR_ON_SCREEN);
        }
      }
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `${OUT}/roster-delete-gm-${viewport.width}.png`, animations: "disabled" });
      if (viewport.width === 1440) {
        await confirm.getByRole("button", { name: "Delete character" }).hover();
        await gm.waitForTimeout(400);
        await card.screenshot({ path: `${OUT}/roster-delete-gm-hover-danger.png` });
        await expectNoSeriousA11yViolations(gm, { include: "main" });
      }
      await confirm.getByRole("button", { name: "Keep" }).click();
    }

    // ── New-character wizard ──
    for (const [who, page] of [
      ["gm", gm],
      ["player", player],
    ] as const) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`/campaigns/${campaignId}/party/new`);
        await expect(page.getByRole("navigation", { name: "Character creation steps" })).toBeVisible();
        await shoot(page, `wizard-${who}-${viewport.width}`, true);
      }
      await page.setViewportSize(VIEWPORTS[0]);
      // Next while the step is incomplete (aria-disabled: the dark disabled glass on the paper).
      const next = page.getByRole("button", { name: /^Next:/ });
      await expect(next).toHaveAttribute("aria-disabled", "true");
      await next.scrollIntoViewIfNeeded();
      await shoot(page, `wizard-${who}-next-disabled`);
      // Pick a class and a subclass so Next is live, then hover it (the main action) and focus Start over from the keyboard.
      await page.locator(".wz-class").first().click();
      await page.locator(".wz-tile").first().click();
      await expect(next).toHaveAttribute("aria-disabled", "false");
      await next.scrollIntoViewIfNeeded();
      await next.hover();
      await page.waitForTimeout(400);
      await shoot(page, `wizard-${who}-hover-next`);
      await page.mouse.move(0, 0);
      await keyboardFocus(page, page.getByRole("button", { name: "Start over" }));
      await shoot(page, `wizard-${who}-focus-start-over`);
      await expectNoSeriousA11yViolations(page, { include: "main" });
      await page.getByRole("button", { name: "Start over" }).click();
    }

    // ── Dashboard: the rest launcher and the party cards ──
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await gm.goto(`/campaigns/${campaignId}`);
      await expect(gm.getByRole("region", { name: "Rest", exact: true })).toBeVisible();
      await shoot(gm, `dashboard-gm-${viewport.width}`, true);
      await gm.getByRole("region", { name: "Rest", exact: true }).screenshot({ path: `${OUT}/rest-idle-gm-${viewport.width}.png`, animations: "disabled" });
    }
    await gm.setViewportSize(VIEWPORTS[0]);
    const rest = gm.getByRole("region", { name: "Rest", exact: true });
    await expect(rest.getByRole("button", { name: "Start short rest" })).toHaveClass(/\bgb-confirm\b/);
    await rest.getByRole("button", { name: "Start short rest" }).hover();
    await gm.waitForTimeout(400);
    await rest.screenshot({ path: `${OUT}/rest-idle-gm-hover-start.png` });
    await expectNoSeriousA11yViolations(gm, { include: "section[aria-labelledby='rest-h']" });
    // The HP tile's Kill pill (hover reveal) on the GM's party card.
    const card = gm.getByRole("article", { name: characterName });
    await card.getByTestId("tile-hp").hover();
    await gm.waitForTimeout(400);
    await card.screenshot({ path: `${OUT}/party-card-gm-hover-tile.png` });

    await rest.getByRole("button", { name: "Start short rest" }).click();
    await expect(rest.getByTestId("open-rest")).toBeVisible();
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await rest.scrollIntoViewIfNeeded();
      await rest.screenshot({ path: `${OUT}/rest-open-gm-${viewport.width}.png`, animations: "disabled" });
      await player.setViewportSize(viewport);
      await player.goto(`/campaigns/${campaignId}`);
      await expect(player.getByRole("region", { name: "Rest", exact: true })).toBeVisible();
      await shoot(player, `dashboard-player-${viewport.width}`, true);
    }
    await gm.setViewportSize(VIEWPORTS[0]);
    await expect(rest.getByRole("button", { name: "Finish rest" })).toHaveClass(/\bgb-confirm\b/);
    await expect(rest.getByRole("button", { name: "Interrupt" })).toHaveClass(/\bgb-danger\b/);
    await rest.getByRole("button", { name: "Interrupt" }).hover();
    await gm.waitForTimeout(400);
    await rest.screenshot({ path: `${OUT}/rest-open-gm-hover-interrupt.png` });
    await expectNoSeriousA11yViolations(gm, { include: "section[aria-labelledby='rest-h']" });
    await gm.mouse.move(0, 0);
    await keyboardFocus(gm, rest.getByRole("button", { name: "Finish rest" }));
    await rest.screenshot({ path: `${OUT}/rest-open-gm-focus-finish.png` });

    await rest.getByRole("button", { name: "Finish rest" }).click();
    await expect(rest.getByText(/Last: Short rest/)).toBeVisible();
    await expect(rest.getByRole("button", { name: "Undo rest" })).toHaveClass(/\bgb-danger\b/);
    await rest.screenshot({ path: `${OUT}/rest-after-gm-1440.png`, animations: "disabled" });

    // ── The sheet: the portrait button (shared with the roster); the level-up ▲ keeps the sheet's look ──
    for (const viewport of VIEWPORTS) {
      await player.setViewportSize(viewport);
      await player.goto(`/campaigns/${campaignId}/party/${table.characterId}`);
      await expect(player.getByRole("img", { name: "Level 1" })).toBeVisible();
      await shoot(player, `sheet-player-${viewport.width}`);
    }
  } finally {
    await table.close();
  }
});
