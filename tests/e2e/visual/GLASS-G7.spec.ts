import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "../a11y";
import { gmAndPlayer } from "../live";
import { TOUCH_FLOOR_ON_SCREEN } from "../zoom";

// Plan glass-buttons G7 (docs/tasks/TASK-GLASS-G7.md; E2E_VISUAL=1): the Lorekeeper page as the GM and as a player at
// 1440 x 900, 1024 x 768 and 390 x 844, plus its dialogs, the Conversations menu and the drawer. Ask = confirm,
// Stop / Cancel / Got it / the drawer's ✕ = cancel, Unpin / delete a conversation = danger, Pin a ruling / Dismiss on a
// player's Ask-the-GM = allow / deny, suggestions and switches = neutral (answer-card actions are ink on the parchment,
// bead dcm-jrju), the phones' 'Library &
// rulings' fold = tool. A hovered confirm and a keyboard-focused button pass axe; small buttons are 44 px on touch.
// `pnpm e2e:setup` turns the fake model on (answers to 'Critical hits' and 'Do Hexes stack?').

test.describe.configure({ timeout: 600_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const OUT = "test-results/visual/GLASS-G7";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

const HOPE_RIM = "rgb(227, 180, 90)"; // --gb-hope
const FEAR_RIM = "rgb(143, 123, 209)"; // --gb-fear

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

async function rim(button: Locator) {
  return button.evaluate((el) => getComputedStyle(el).boxShadow);
}

const column = (p: Page) => p.getByRole("region", { name: "The Lorekeeper" });
const composer = (p: Page) => column(p).getByRole("group", { name: "Ask the Lorekeeper" });
const answers = (p: Page) => column(p).getByRole("article", { name: "The Lorekeeper's answer" });
const rulings = (p: Page) => p.getByRole("region", { name: "Table rulings" });

/** At 390 the sidebar sits in the closed 'Library & rulings' fold (a glass tool button). */
async function openFold(page: Page) {
  const fold = page.getByRole("button", { name: "Library & rulings" });
  if (!(await fold.isVisible())) return;
  await expect(fold).toHaveClass(/\bgb-tool\b/);
  if ((await fold.getAttribute("aria-expanded")) === "false") await fold.click();
}

test("GLASS-G7 the Lorekeeper as the GM and as a player", { tag: "@visual" }, async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  try {
    const { gm, player, campaignId, client } = table;
    await client.mutation(api.lorekeeperRulings.pin, { campaignId, title: "Hexes don’t stack", text: "Only the biggest Hex penalty applies to a target." });

    // The player asks two questions (shared with the campaign) and sends the unclear answer to the GM.
    await player.setViewportSize(VIEWPORTS[0]);
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    await composer(player).getByRole("button", { name: "Critical hits" }).click();
    await expect(answers(player).filter({ hasText: "From the rules" }).getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 60_000 });
    await composer(player).getByRole("button", { name: "Do Hexes stack?" }).click();
    const unclear = answers(player).filter({ hasText: "Rules unclear" });
    await expect(unclear.getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 60_000 });
    await unclear.getByRole("button", { name: "Ask the GM" }).click();
    await expect(unclear.getByRole("button", { name: "Sent to the GM" })).toBeDisabled();

    for (const [who, page] of [
      ["player", player],
      ["gm", gm],
    ] as const) {
      const confirmRim = who === "gm" ? FEAR_RIM : HOPE_RIM;
      const cancelRim = who === "gm" ? HOPE_RIM : FEAR_RIM;

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`/campaigns/${campaignId}/lorekeeper`);
        await expect(composer(page).getByRole("textbox", { name: "Your question" })).toBeEnabled();
        if (who === "gm") {
          // The GM opens the player's shared conversation so the answer cards show.
          await column(page).getByRole("button", { name: "Conversations" }).click();
          await column(page).getByRole("region", { name: "Shared in the campaign" }).getByRole("button", { name: /If my Hope and Fear dice match/ }).click();
        }
        await expect(answers(page).filter({ hasText: "Rules unclear" }).getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 40_000 });
        await shoot(page, `page-${who}-${viewport.width}`);

        const ask = composer(page).getByRole("button", { name: "Ask", exact: true });
        await expect(ask).toHaveClass(/\bgb-confirm\b/);
        const suggestion = composer(page).getByRole("button", { name: "Critical hits" });
        await expect(suggestion).toHaveClass(/\bgb-neutral\b/);
        const web = composer(page).getByRole("group", { name: "Internet search" }).getByRole("button");
        await expect(web.first()).toHaveClass(/\bgb-neutral\b/);
        const copy = answers(page).filter({ hasText: "Rules unclear" }).getByRole("button", { name: "Copy" });
        // Bead dcm-jrju: the answer card's actions are ink on the parchment, not glass.
        await expect(copy).toHaveClass(/\binkb\b/);
        await expect(copy).not.toHaveClass(/\bgb\b/);
        await expect(column(page).getByRole("button", { name: "Conversations" })).toHaveClass(/\bgb-neutral\b/);

        await openFold(page);
        if (who === "gm") {
          const side = rulings(page);
          await expect(side.getByRole("button", { name: "Pin a ruling" })).toHaveClass(/\bgb-allow\b/);
          await expect(side.getByRole("button", { name: "Dismiss" })).toHaveClass(/\bgb-deny\b/);
          await expect(side.getByRole("button", { name: "Edit Hexes don’t stack" })).toHaveClass(/\bgb-neutral\b/);
          await expect(side.getByRole("button", { name: "Unpin Hexes don’t stack" })).toHaveClass(/\bgb-danger\b/);
          await expect(page.getByRole("button", { name: "About books" })).toHaveClass(/\bgb-neutral\b/);
          if (viewport.width === 390) await page.screenshot({ path: `${OUT}/side-${who}-390.png`, fullPage: true, animations: "disabled" });
        }

        if (viewport.width <= 1100) {
          // The touch breakpoint: small glass buttons and ink buttons are 44 px tall.
          for (const button of [suggestion, copy, column(page).getByRole("button", { name: "Conversations" })]) {
            expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(TOUCH_FLOOR_ON_SCREEN);
          }
        }
      }

      // Viewer colours: Ask has the viewer's confirm rim.
      await page.setViewportSize(VIEWPORTS[0]);
      const ask = composer(page).getByRole("button", { name: "Ask", exact: true });
      expect(await rim(ask)).toContain(confirmRim);

      // A hovered confirm passes axe; then a keyboard-focused answer action (ink on the parchment).
      await ask.hover();
      await page.waitForTimeout(400);
      await composer(page).screenshot({ path: `${OUT}/composer-${who}-hover-ask.png` });
      await expectNoSeriousA11yViolations(page, { include: ".lk-compose" });
      await page.mouse.move(0, 0);
      const copy = answers(page).filter({ hasText: "Rules unclear" }).getByRole("button", { name: "Copy" });
      await copy.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(copy).toBeFocused();
      await page.waitForTimeout(300);
      await answers(page).filter({ hasText: "Rules unclear" }).screenshot({ path: `${OUT}/answer-${who}-focus-copy.png` });
      await expectNoSeriousA11yViolations(page, { include: ".lk-a" });
      await copy.hover();
      await page.waitForTimeout(400);
      await expectNoSeriousA11yViolations(page, { include: ".lk-a" });
      await page.mouse.move(0, 0);

      // The Conversations menu: New conversation = confirm; the player's own rows carry a danger delete.
      await column(page).getByRole("button", { name: "Conversations" }).click();
      const newConversation = column(page).getByRole("button", { name: /New conversation/ });
      await expect(newConversation).toHaveClass(/\bgb-confirm\b/);
      await shoot(page, `conversations-${who}`);
      if (who === "player") {
        const del = column(page).getByRole("button", { name: /^Delete “/ }).first();
        await expect(del).toHaveClass(/\bgb-danger\b/);
        await del.click();
        const dialog = page.getByRole("dialog", { name: "Delete this conversation?" });
        await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveClass(/\bgb-cancel\b/);
        expect(await rim(dialog.getByRole("button", { name: "Cancel" }))).toContain(cancelRim);
        const confirmDelete = dialog.getByRole("button", { name: "Delete", exact: true });
        await expect(confirmDelete).toHaveClass(/\bgb-danger\b/);
        await confirmDelete.hover();
        await page.waitForTimeout(400);
        await shoot(page, `delete-${who}-hover-danger`);
        await expectNoSeriousA11yViolations(page, { include: "dialog[open]" });
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await expect(dialog).toBeHidden();
      } else {
        await column(page).getByRole("button", { name: "Conversations" }).click();
      }

      if (who === "gm") {
        // Unpin: Cancel = cancel (Hope for the GM), Unpin = danger.
        await rulings(page).getByRole("button", { name: "Unpin Hexes don’t stack" }).click();
        const unpin = page.getByRole("dialog", { name: "Unpin this ruling?" });
        await expect(unpin.getByRole("button", { name: "Cancel" })).toHaveClass(/\bgb-cancel\b/);
        expect(await rim(unpin.getByRole("button", { name: "Cancel" }))).toContain(cancelRim);
        await expect(unpin.getByRole("button", { name: "Unpin", exact: true })).toHaveClass(/\bgb-danger\b/);
        await shoot(page, "unpin-gm");
        await unpin.getByRole("button", { name: "Cancel" }).click();
        await expect(unpin).toBeHidden();

        // Pin a ruling for the player's ask: Pin ruling = confirm (Fear for the GM), hovered.
        await rulings(page).getByRole("button", { name: "Pin a ruling" }).click();
        const pin = page.getByRole("dialog", { name: "Pin a ruling" });
        const pinIt = pin.getByRole("button", { name: "Pin ruling" });
        await expect(pinIt).toHaveClass(/\bgb-confirm\b/);
        expect(await rim(pinIt)).toContain(confirmRim);
        await pinIt.hover();
        await page.waitForTimeout(400);
        await shoot(page, "pin-gm-hover-confirm");
        await expectNoSeriousA11yViolations(page, { include: "dialog[open]" });
        await pin.getByRole("button", { name: "Cancel" }).click();
        await expect(pin).toBeHidden();

        // About books: Got it = cancel.
        await page.getByRole("button", { name: "About books" }).click();
        const about = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Got it" }) });
        await expect(about.getByRole("button", { name: "Got it" })).toHaveClass(/\bgb-cancel\b/);
        await shoot(page, "about-gm");
        await about.getByRole("button", { name: "Got it" }).click();
        await expect(about).toBeHidden();

        // The drawer over the Party page: its ✕ is a round cancel in the GM's colours.
        await page.goto(`/campaigns/${campaignId}/party`);
        await expect(page.getByRole("article", { name: table.characterName })).toBeVisible();
        await page.getByRole("button", { name: "Ask the Lorekeeper" }).click();
        const drawer = page.getByRole("dialog", { name: "The Lorekeeper" });
        const close = drawer.getByRole("button", { name: "Close the Lorekeeper" });
        await expect(close).toHaveClass(/\bgb-cancel\b.*\bgb-round\b/);
        expect(await rim(close)).toContain(cancelRim);
        await shoot(page, "drawer-gm");
        await close.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await page.waitForTimeout(300);
        await shoot(page, "drawer-gm-focus");
        await close.click();
        await expect(drawer).toBeHidden();
      }
    }
  } finally {
    await table.close();
  }
});
