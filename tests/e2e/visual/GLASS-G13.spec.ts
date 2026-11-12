import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "../a11y";
import { gmAndPlayer } from "../live";
import { TOUCH_FLOOR_ON_SCREEN } from "../zoom";

// Plan glass-buttons G13 (docs/tasks/TASK-GLASS-G13.md; E2E_VISUAL=1): the Journal's Notes sub-tab as the GM and as a
// player at 1440 x 900, 1024 x 768 and 390 x 844. The dark frame's buttons are glass (New page = confirm, the session
// picker's Cancel and the sharing dialog's Done = cancel, the bin toast's Undo = cancel, Restore / Download / Writing
// as = neutral); the paper page keeps its ink-on-paper buttons (Q5 a). A hovered confirm, a keyboard-focused button and
// a hovered paper button pass axe; the small buttons are 44 px at the touch breakpoint.

const OUT = "test-results/visual/GLASS-G13";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

const HOPE_RIM = "rgb(227, 180, 90)"; // --gb-hope
const FEAR_RIM = "rgb(143, 123, 209)"; // --gb-fear

async function shoot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

const index = (page: Page) => page.getByRole("complementary", { name: "Journal index" });
const paper = (page: Page) => page.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Page" });

/** Opens the index behind its 'Pages' disclosure at phone widths. */
async function openIndex(page: Page) {
  const toggle = index(page).getByRole("button", { name: /^Pages/ });
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

test("GLASS-G13 Notes as the GM and as a player", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(600_000);
  const table = await gmAndPlayer(browser);
  try {
    for (const [who, page, client] of [
      ["gm", table.gm, table.client],
      ["player", table.player, table.playerClient],
    ] as const) {
      const campaignId = table.campaignId;
      // A log page with lines, and a torn-out page so the index shows 'Restore'.
      let pageId: Id<"journalPages"> | null = null;
      for (const [kind, text] of [
        ["event", "Crossed the river at dawn"],
        ["task", "Ask the ferryman about the well"],
        ["note", "The ferryman owes Mira a favour"],
      ] as const) {
        pageId = (await client.mutation(api.notesEntries.add, { campaignId, page: pageId ?? { template: 0 }, kind, text })).pageId;
      }
      const binned = (await client.mutation(api.notesEntries.add, { campaignId, page: { template: 1 }, kind: "note", text: "The mill burned" })).pageId;
      await client.mutation(api.notesBin.binPage, { campaignId, page: binned });

      const url = `/campaigns/${campaignId}/journal?tab=notes&page=${pageId}`;
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(url);
        await expect(paper(page).getByRole("listitem")).toHaveCount(3);
        await openIndex(page);
        await shoot(page, `notes-${who}-${viewport.width}`);
        await page.screenshot({ path: `${OUT}/notes-${who}-${viewport.width}-full.png`, fullPage: true, animations: "disabled" });

        const add = index(page).getByRole("button", { name: "New session log" });
        await expect(add).toHaveClass(/\bgb-confirm\b/);
        const restore = index(page).getByRole("button", { name: /^Restore / });
        await expect(restore).toHaveClass(/\bgb-neutral\b/);
        if (viewport.width <= 1100) {
          // The touch breakpoint: small glass buttons are 44 px tall.
          for (const button of [add, restore]) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(TOUCH_FLOOR_ON_SCREEN);
        }
      }

      // The confirm follows the viewer: Hope rim for a player, Fear rim for the GM.
      await page.setViewportSize(VIEWPORTS[0]);
      await page.goto(url);
      await expect(paper(page).getByRole("listitem")).toHaveCount(3);
      const add = index(page).getByRole("button", { name: "New session log" });
      expect(await add.evaluate((el) => getComputedStyle(el).boxShadow)).toContain(who === "gm" ? FEAR_RIM : HOPE_RIM);

      // A hovered confirm passes axe; then a keyboard-focused button.
      await add.hover();
      await page.waitForTimeout(400);
      await index(page).screenshot({ path: `${OUT}/index-${who}-hover-confirm.png` });
      await expectNoSeriousA11yViolations(page, { include: ".bj-index" });
      await page.mouse.move(0, 0);
      const restore = index(page).getByRole("button", { name: /^Restore / });
      await restore.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(restore).toBeFocused();
      await page.waitForTimeout(300);
      await index(page).screenshot({ path: `${OUT}/index-${who}-focus-restore.png` });
      await expectNoSeriousA11yViolations(page, { include: ".bj-index" });

      // The paper keeps its ink-on-paper buttons (Q5 a); hovered, it still passes axe.
      const tape = paper(page).getByRole("button", { name: /Tape/ });
      await expect(tape).not.toHaveClass(/\bgb\b/);
      await tape.hover();
      await page.waitForTimeout(300);
      await paper(page).screenshot({ path: `${OUT}/paper-${who}-hover-tape.png` });
      await expectNoSeriousA11yViolations(page, { include: ".bj-sheet" });
      await page.mouse.move(0, 0);

      // The session picker: Cancel = cancel, 'Add the page' = confirm.
      await add.click();
      const picker = page.getByRole("dialog", { name: "New session log" });
      await expect(picker).toBeVisible();
      await expect(picker.getByRole("button", { name: "Cancel" })).toHaveClass(/\bgb-cancel\b/);
      const confirm = picker.getByRole("button", { name: "Add the page" });
      await expect(confirm).toHaveClass(/\bgb-confirm\b/);
      await confirm.hover();
      await page.waitForTimeout(400);
      await shoot(page, `picker-${who}-hover-confirm`);
      await expectNoSeriousA11yViolations(page, { include: "dialog[open]" });
      await picker.getByRole("button", { name: "Cancel" }).click();
      await expect(picker).toBeHidden();

      // The sharing dialog: Done = cancel.
      await paper(page).getByRole("button", { name: /^Sharing:/ }).click();
      const share = page.getByRole("dialog", { name: "Share this page" });
      await expect(share).toBeVisible();
      const done = share.getByRole("button", { name: "Done" });
      await expect(done).toHaveClass(/\bgb-cancel\b/);
      expect(await done.evaluate((el) => getComputedStyle(el).boxShadow)).toContain(who === "gm" ? HOPE_RIM : FEAR_RIM);
      await shoot(page, `sharing-${who}`);
      await done.hover();
      await page.waitForTimeout(400);
      await expectNoSeriousA11yViolations(page, { include: "dialog[open]" });
      await done.click();
      await expect(share).toBeHidden();

      // The bin toast (portalled into the Notes root, wrapped in ViewerScope): Undo = cancel in the viewer's colours.
      await paper(page).getByRole("button", { name: "Tear out page" }).click();
      await paper(page).getByRole("button", { name: "Click again to tear out" }).click();
      const toast = page.getByRole("status").filter({ hasText: "Page torn out" });
      const undo = toast.getByRole("button", { name: "Undo" });
      await expect(undo).toHaveClass(/\bgb-cancel\b/);
      await expect(toast.locator("xpath=ancestor::*[@data-viewer][1]")).toHaveAttribute("data-viewer", who);
      expect(await undo.evaluate((el) => getComputedStyle(el).boxShadow)).toContain(who === "gm" ? HOPE_RIM : FEAR_RIM);
      await page.waitForTimeout(1600); // the rip is over
      await toast.screenshot({ path: `${OUT}/toast-${who}.png` });
      await undo.click();
      await expect(paper(page).getByRole("listitem")).toHaveCount(3);
    }

    // The 'Writing as' chips (GM): neutral glass with aria-pressed; the pressed one glows.
    const gm = table.gm;
    await gm.setViewportSize(VIEWPORTS[0]);
    await gm.goto(`/campaigns/${table.campaignId}/journal?tab=notes`);
    const chips = gm.getByRole("group", { name: "Writing as" }).getByRole("button");
    await expect(chips.first()).toHaveClass(/\bgb-neutral\b/);
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
    await gm.getByRole("group", { name: "Writing as" }).screenshot({ path: `${OUT}/writing-as-gm.png` });
  } finally {
    await table.close();
  }
});
