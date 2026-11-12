import { expect, test, type Locator, type Page } from "@playwright/test";

import type { FrameId } from "../../../src/lib/frames";
import { expectNoSeriousA11yViolations } from "../a11y";
import { gmAndPlayer } from "../live";
import { TOUCH_FLOOR_ON_SCREEN } from "../zoom";

// Shots for docs/tasks/TASK-GLASS-G4.md (E2E_VISUAL=1): the six frame trackers on the dashboard with glass buttons in
// the viewer's colours. For each frame the GM first fills the tracker through the UI (so its row buttons show), then the
// dashboard is shot as the GM and as a player at 1440 x 900, 1024 x 768 and 390 x 844; one hovered button and one
// keyboard-focused button per frame, each with axe on the tracker cards; every glass button in the cards is 44 px tall
// at 1024 (touch).

const OUT = "test-results/visual/GLASS-G4";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;
/** Every TrackerCard (its heading id starts with tr-). */
const CARDS = 'section[aria-labelledby^="tr-"]';

type Frame = {
  id: FrameId;
  slug: string;
  /** The first card's heading. */
  card: RegExp | string;
  /** Fills the tracker as the GM and shoots its dialogs; returns the button to hover. */
  prepare: (gm: Page) => Promise<Locator>;
  /** The button to focus from the keyboard. */
  focus: (gm: Page) => Locator;
};

async function shoot(page: Page, name: string, full = true) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", fullPage: full });
}

const region = (page: Page, name: RegExp | string) => page.getByRole("region", { name });

const FRAMES: Frame[] = [
  {
    id: "five-banners-burning",
    slug: "five-banners",
    card: /Five Banners/,
    async prepare(gm) {
      const tracker = region(gm, /Five Banners/);
      const armada = tracker.getByRole("article", { name: "Armada" });
      await armada.getByRole("button", { name: "New Armada objective" }).click();
      const dialog = gm.getByRole("dialog", { name: "Armada objective" });
      await dialog.getByRole("radio", { name: "Minor (4–6 steps)" }).click();
      await dialog.getByRole("radio", { name: "5", exact: true }).click();
      await dialog.getByLabel("Objective", { exact: true }).fill("Acquire airship technology");
      await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveClass(/\bgb-cancel\b/);
      await expect(dialog.getByRole("button", { name: "Start at 5" })).toHaveClass(/\bgb-confirm\b/);
      await shoot(gm, "five-banners-objective-dialog-gm", false);
      await dialog.getByRole("button", { name: "Start at 5" }).click();
      await expect(dialog).toBeHidden();
      await tracker.getByRole("button", { name: /^Armada and Hilltop: Enemies/ }).click();
      await expect(tracker.getByRole("button", { name: "Improve Armada–Hilltop relationship" })).toHaveClass(/\bgb-icon\b/);
      const row = armada.getByRole("listitem", { name: "Acquire airship technology" });
      await expect(row.getByRole("button", { name: "Tick Acquire airship technology down one" })).toHaveClass(/\bgb-confirm\b/);
      await row.getByRole("button", { name: "Abandon objective…" }).click();
      const confirm = row.getByRole("alertdialog");
      await expect(confirm.getByRole("button", { name: "Abandon" })).toHaveClass(/\bgb-danger\b/);
      await expect(confirm.getByRole("button", { name: "Keep it" })).toHaveClass(/\bgb-cancel\b/);
      await armada.screenshot({ path: `${OUT}/five-banners-abandon-gm.png`, animations: "disabled" });
      await confirm.getByRole("button", { name: "Keep it" }).click();
      await tracker.getByRole("button", { name: "Advance week" }).click();
      const advance = gm.getByRole("dialog", { name: "Advance to week 2" });
      await shoot(gm, "five-banners-advance-dialog-gm", false);
      await advance.getByRole("button", { name: "Cancel" }).click();
      return tracker.getByRole("button", { name: "Advance week" });
    },
    focus: (gm) => region(gm, /Five Banners/).getByRole("button", { name: "Edit Armada assets and problems" }),
  },
  {
    id: "colossus-of-the-drylands",
    slug: "colossus",
    card: "The Hunt",
    async prepare(gm) {
      const hunt = region(gm, "The Hunt");
      await expect(hunt.getByRole("radio", { name: "hunt" })).toHaveClass(/\bgb-hope\b/);
      return hunt.getByRole("button", { name: "Colossus defeated" });
    },
    focus: (gm) => region(gm, /Kudamat/).getByRole("button", { name: "Correction: short rest +1" }),
  },
  {
    id: "age-of-umbra",
    slug: "age-of-umbra",
    card: "Sacred Pyres",
    async prepare(gm) {
      const pyres = region(gm, "Sacred Pyres");
      await gm.getByLabel("Settlement", { exact: true }).fill("Brightmoor");
      await pyres.getByRole("button", { name: "Add pyre" }).click();
      await expect(pyres.getByRole("button", { name: "Remove Brightmoor" })).toHaveClass(/\bgb-danger\b/);
      await pyres.getByRole("button", { name: "Add a Blessed Branch" }).click();
      await expect(pyres.getByTestId("blessed-branches")).toHaveText("1");
      await pyres.getByRole("button", { name: "Rename Brightmoor" }).click();
      await pyres.screenshot({ path: `${OUT}/age-of-umbra-rename-gm.png`, animations: "disabled" });
      await pyres.getByRole("listitem", { name: "Brightmoor" }).getByRole("button", { name: "Cancel" }).click();
      const lurking = region(gm, /Lurking Darkness/);
      if (await lurking.getByRole("button", { name: "Roll Lurking Darkness" }).isEnabled()) {
        await lurking.getByRole("button", { name: "Roll Lurking Darkness" }).click();
        const dialog = gm.getByRole("dialog", { name: "Lurking Darkness" });
        await dialog.getByRole("button", { name: "+ Add watcher" }).click();
        await expect(dialog.getByRole("button", { name: "Roll d12" })).toHaveClass(/\bgb-confirm\b/);
        await shoot(gm, "age-of-umbra-lurking-dialog-gm", false);
        await dialog.getByRole("button", { name: "Close lurking darkness" }).click();
      }
      await pyres.getByRole("button", { name: "Ignite a Blessed Branch" }).click();
      const ignite = gm.getByRole("dialog", { name: "Ignite a Blessed Branch" });
      await expect(ignite.getByRole("button", { name: "Ignite", exact: true })).toHaveClass(/\bgb-confirm\b/);
      await shoot(gm, "age-of-umbra-ignite-dialog-gm", false);
      await ignite.getByRole("button", { name: "Close ignite a blessed branch" }).click();
      return pyres.getByRole("button", { name: "Ignite a Blessed Branch" });
    },
    focus: (gm) => region(gm, "Sacred Pyres").getByRole("button", { name: "Rename Brightmoor" }),
  },
  {
    id: "reign-of-the-weredragon",
    slug: "weredragon",
    card: /Revelations/,
    async prepare(gm) {
      const card = region(gm, /Revelations/);
      const roll = card.getByRole("button", { name: "Roll the night sky" });
      await expect(roll).toHaveClass(/\bgb-confirm\b/);
      await roll.click();
      await expect(card.getByRole("button", { name: "Apply reading" })).toHaveClass(/\bgb-confirm\b/);
      return card.getByRole("button", { name: "Apply reading" });
    },
    focus: (gm) => region(gm, /Revelations/).getByRole("button", { name: "Apply reading" }),
  },
  {
    id: "dark-heart-of-andaluria",
    slug: "andaluria",
    card: "The Hunt",
    async prepare(gm) {
      const card = region(gm, "The Hunt");
      await card.getByLabel("New hunt name").fill("The Drowned Bell");
      await card.getByRole("button", { name: "New hunt" }).click();
      const hunt = card.getByRole("listitem", { name: "The Drowned Bell" });
      await hunt.getByLabel("New clue for The Drowned Bell").fill("Wet footprints lead to the bay");
      await hunt.getByRole("button", { name: "Add clue" }).click();
      await expect(hunt.getByLabel("Clue 1", { exact: true })).toHaveValue("Wet footprints lead to the bay");
      await expect(hunt.getByRole("button", { name: "Delete hunt" })).toHaveClass(/\bgb-danger\b/);
      await card.getByLabel("New hunt name").fill("The Salt Choir");
      return card.getByRole("button", { name: "New hunt" });
    },
    focus: (gm) => region(gm, "The Hunt").getByRole("button", { name: "Archive hunt" }),
  },
  {
    id: "journey-to-horizon",
    slug: "horizon",
    card: /Doom Track/,
    async prepare(gm) {
      const doom = region(gm, /Doom Track/);
      await doom.getByRole("checkbox", { name: "Bandits and marauders harry travelers." }).click();
      const occurred = doom.getByRole("button", { name: "Occurred: Bandits and marauders harry travelers." });
      await expect(occurred).toHaveClass(/\bgb-neutral\b/);
      await expect(occurred).toHaveAttribute("aria-pressed", "false");
      return occurred;
    },
    focus: (gm) => region(gm, /Doom Track/).getByRole("button", { name: "Occurred: Bandits and marauders harry travelers." }),
  },
];

async function expectGlass44(page: Page) {
  const buttons = page.locator(`${CARDS} .gb`);
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    const name = (await button.getAttribute("aria-label")) ?? (await button.textContent()) ?? "";
    expect(box!.height, name).toBeGreaterThanOrEqual(TOUCH_FLOOR_ON_SCREEN);
  }
}

for (const frame of FRAMES) {
  test(`GLASS-G4 ${frame.slug} tracker as the GM and as a player`, { tag: "@visual" }, async ({ browser }) => {
    test.setTimeout(420_000);
    const table = await gmAndPlayer(browser, { frame: frame.id });
    try {
      const gm = table.gm;
      await gm.setViewportSize(VIEWPORTS[0]);
      await expect(region(gm, frame.card).first()).toBeVisible();
      const hover = await frame.prepare(gm);

      for (const [who, page] of [
        ["gm", gm],
        ["player", table.player],
      ] as const) {
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);
          await page.goto(`/campaigns/${table.campaignId}`);
          await expect(page.getByRole("heading", { level: 1, name: table.campaignName })).toBeVisible();
          await expect(page.locator(CARDS).first()).toBeVisible();
          await shoot(page, `${frame.slug}-${who}-${viewport.width}`);
          if (viewport.width === 1024) await expectGlass44(page);
        }
      }

      // A hovered button (the fill swaps the ink) with axe on the tracker cards, then a keyboard-focused one.
      await gm.setViewportSize(VIEWPORTS[0]);
      await gm.goto(`/campaigns/${table.campaignId}`);
      await expect(hover).toBeVisible();
      await hover.scrollIntoViewIfNeeded();
      await hover.hover();
      await gm.waitForTimeout(400);
      await shoot(gm, `${frame.slug}-gm-hover`, false);
      await expectNoSeriousA11yViolations(gm, { include: CARDS });
      await gm.mouse.move(0, 0);
      const focus = frame.focus(gm);
      await focus.focus();
      await gm.keyboard.press("Shift+Tab");
      await gm.keyboard.press("Tab");
      await expect(focus).toBeFocused();
      await gm.waitForTimeout(400);
      await shoot(gm, `${frame.slug}-gm-focus`, false);
      await expectNoSeriousA11yViolations(gm, { include: CARDS });
    } finally {
      await table.close();
    }
  });
}
