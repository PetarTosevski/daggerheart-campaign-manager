import { expect as baseExpect, test, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./a11y";
import { artHeader, avatar, gotoSettings, openPlayers, preferences, sectionNav, settingsPanel } from "./config/helpers";
import { gmAndPlayer } from "./live";

// Plan config SX: axe (WCAG 2.0-2.2 A/AA, no serious or critical findings) on Campaign settings, every section, for the
// GM, and on the Preferences popover for the GM and the player, at 1440x900 and 820x1180. Only the GM gets the settings;
// the player's `?settings=` link opens nothing. Settings are reached the ways a GM reaches them: the shared link, the
// side nav and the header's Players button (Q10 b).

test.describe.configure({ timeout: 300_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 820, height: 1180 },
] as const;

const SECTIONS = [
  { label: "Table", title: "At the table" },
  { label: "House rules", title: "House rules" },
  { label: "Players", title: "Players" },
  { label: "Lorekeeper", title: "Lorekeeper" },
  { label: "Sessions", title: "Sessions" },
] as const;

const PANEL = { include: "[data-testid=campaign-settings]" };
const PREFS = { include: "[data-testid=preferences]" };

/** Opens Preferences from the art header's avatar, scans it and closes it with Escape. */
async function scanPreferences(page: Page) {
  await avatar(artHeader(page)).click();
  const prefs = preferences(page);
  await expect(prefs).toBeVisible();
  await expect(prefs.getByTestId("preference-rows")).toBeVisible();
  await expectNoSeriousA11yViolations(page, PREFS);
  await page.keyboard.press("Escape");
  await expect(prefs).toBeHidden();
}

test("Campaign settings (every section) and Preferences pass axe for the GM and the player", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId } = table;
  const dashboard = `/campaigns/${campaignId}`;
  try {
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await player.setViewportSize(viewport);

      // GM: the shared link opens Table; the side nav walks every section.
      await gotoSettings(gm, dashboard, "table");
      const panel = settingsPanel(gm);
      await expect(panel).toBeVisible();
      for (const { label, title } of SECTIONS) {
        await sectionNav(gm, label).click();
        await expect(panel.getByRole("heading", { level: 3, name: title })).toBeVisible();
        // Each section's own loading line is gone before the scan.
        await expect(panel.locator(".cfg-secs").getByRole("status").filter({ hasText: /^Loading/ })).toHaveCount(0);
        await expectNoSeriousA11yViolations(gm, PANEL);
      }
      await gm.keyboard.press("Escape");
      await expect(panel).toBeHidden();

      // GM: the Players button lands on the same section.
      await openPlayers(gm);
      await expectNoSeriousA11yViolations(gm, PANEL);
      await gm.keyboard.press("Escape");
      await expect(settingsPanel(gm)).toBeHidden();

      await scanPreferences(gm);

      // Player: no settings, even through the link; Preferences passes axe.
      await gotoSettings(player, dashboard, "table");
      await expect(player.getByRole("heading", { level: 1, name: table.campaignName })).toBeVisible();
      await expect(settingsPanel(player)).toHaveCount(0);
      await scanPreferences(player);
    }
  } finally {
    await table.close();
  }
});
