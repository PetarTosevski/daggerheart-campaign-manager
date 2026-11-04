// Plan hand-fan HF1 (dcm-bxp.99.30), on the Combat HUD since the cut-over (plan combat-hud H8.1): accessibility and
// tablet pass for the player's hand at the bottom of the map. Bar (D12, docs/tasks/TASK-D12-H1.md): zero serious or
// critical axe findings in every state of the hand (the fan, a card's Use focused, the roll options open, the vault
// open, folded with "Show cards (n)"); at 1024x768 no sideways scroll and the map still in view above the hand; at
// 390 px the phone sheet's Hand tab fits with 44 px controls. Known HUD gaps (dcm-bxp.99.32.41, `test.fixme` below): the
// side buttons are 28 px on tablets, and at 768x1024 the map hint covers them. Drag-to-aim is gone
// by design: Use opens the picking panel (tests/e2e/hud-card-pick.spec.ts). The GM's locked view and the full card are
// in tests/e2e/hud-hand.spec.ts.

import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectFitsViewport, expectNoSeriousA11yViolations, expectTouchTargets, TABLET_VIEWPORTS } from "./a11y";
import { hudScene } from "./hud/helpers";

test.describe.configure({ timeout: 300_000 });
// A stuck action names itself instead of running into the test timeout.
test.use({ actionTimeout: 30_000 });

const HAND = { include: '[data-testid="hud-hand"]' };

/** The hand's side buttons: the vault deck (not on the phone's Hand tab), Roll options and Hide / Show cards. */
const sideButtons = (hand: Locator) => hand.locator(".hud-fanside > .hud-deck button, .hud-fanside > button").filter({ visible: true });

/** The hand leaves the map in view: the map's viewport starts well above the hand's top edge. */
async function expectMapAboveHand(page: Page, hand: Locator) {
  const viewport = (await page.locator('.hud-map [data-testid="combat-viewport"]').boundingBox())!;
  const top = (await hand.boundingBox())!.y;
  const visibleTop = Math.max(viewport.y, 0);
  expect(top - visibleTop, "map height left above the hand").toBeGreaterThan(page.viewportSize()!.height * 0.35);
}

test("the HUD hand passes axe in every state, fits tablets and the phone's Hand tab, and keeps 44 px controls", async ({ browser }) => {
  const s = await hudScene(browser);
  const { player } = s;
  try {
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
    const hand = player.getByTestId("hud-hand");
    await expect(hand).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    await expect(hand.getByTestId("hud-hand-card")).toHaveCount(2);

    // The fan, then a card's Use focused, the roll options and the vault open.
    await expectNoSeriousA11yViolations(player, HAND);
    const use = hand.getByRole("button", { name: "Use Vicious Entangle" });
    await use.focus();
    await expect(use).toBeFocused();
    await expectNoSeriousA11yViolations(player, HAND);
    await use.blur();

    const rollsButton = hand.getByRole("button", { name: "Roll options" });
    await rollsButton.click();
    const rolls = player.getByTestId("hud-hand-rolls");
    await expect(rolls.getByRole("group", { name: "Advantage" })).toBeVisible();
    await expectNoSeriousA11yViolations(player, HAND);
    await player.keyboard.press("Escape");
    await expect(rolls).toBeHidden();

    await hand.getByRole("button", { name: "Open vault, 0 cards" }).click();
    const vault = player.getByTestId("hud-hand-vault");
    await expect(vault.getByRole("heading", { name: "Vault (0)" })).toBeVisible();
    await expect(vault).toContainText("The vault is empty.");
    await expectNoSeriousA11yViolations(player, HAND);
    await vault.getByRole("button", { name: "Close vault (0)" }).click();
    await expect(vault).toBeHidden();

    // Folded: the card backs and "Show cards (2)".
    await hand.getByRole("button", { name: "Hide cards" }).click();
    const show = hand.getByRole("button", { name: "Show cards (2)" });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(hand.getByTestId("hud-hand-folded")).toBeVisible();
    await expectNoSeriousA11yViolations(player, HAND);

    // The landscape tablet: no sideways scroll, the map in view above the hand; folded and shown.
    await player.setViewportSize({ width: 1024, height: 768 });
    await player.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView({ block: "end" }));
    await expectFitsViewport(player);
    await expectNoSeriousA11yViolations(player, HAND);
    await show.click();
    await expect(hand.getByTestId("hud-hand-card")).toHaveCount(2);
    await expectFitsViewport(player);
    await expectMapAboveHand(player, hand.getByTestId("hud-hand-fan"));
    await expectNoSeriousA11yViolations(player, HAND);

    // The phone: the bottom sheet's Hand tab holds the hand; its controls are 44 px and the page fits.
    await player.setViewportSize({ width: 390, height: 844 });
    await player.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView({ block: "end" }));
    const tabs = player.getByTestId("hud-phone-sheet").getByRole("tablist", { name: "Combat actions" });
    await tabs.getByRole("tab", { name: "Hand" }).click();
    const handTab = player.getByTestId("hud-phone-tab-hand");
    const phoneHand = handTab.getByTestId("hud-hand");
    await expect(phoneHand).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    await expect(phoneHand.getByTestId("hud-hand-card")).toHaveCount(2);
    await expectFitsViewport(player);
    await expectTouchTargets(sideButtons(phoneHand));
    await expectNoSeriousA11yViolations(player, { include: '[data-testid="hud-phone-tab-hand"]' });
    await phoneHand.getByRole("button", { name: "Roll options" }).click();
    await expect(player.getByTestId("hud-hand-rolls").getByRole("group", { name: "Advantage" })).toBeVisible();
    await expectFitsViewport(player);
    await expectNoSeriousA11yViolations(player, { include: '[data-testid="hud-phone-tab-hand"]' });
  } finally {
    await s.close();
  }
});

// dcm-bxp.99.32.41: the classic hand kept 44 px side buttons on tablets; the HUD's are 28 px (hud/hand/hand.css), and
// at 768x1024 the map's hint line covers them. Unfixme once the HUD hand is fixed.
test.fixme("on tablets the HUD hand's side buttons are 44 px and clear of the map hint, folded and shown", async ({ browser }) => {
  const s = await hudScene(browser);
  const { player } = s;
  try {
    await player.goto(s.url);
    const hand = player.getByTestId("hud-hand");
    await expect(hand).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    for (const viewport of TABLET_VIEWPORTS) {
      await player.setViewportSize(viewport);
      await player.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView({ block: "end" }));
      await expectTouchTargets(sideButtons(hand));
      await hand.getByRole("button", { name: "Hide cards" }).click();
      const show = hand.getByRole("button", { name: /^Show cards/ });
      await expectTouchTargets(sideButtons(hand));
      await show.click();
      await expectMapAboveHand(player, hand.getByTestId("hud-hand-fan"));
    }
  } finally {
    await s.close();
  }
});
