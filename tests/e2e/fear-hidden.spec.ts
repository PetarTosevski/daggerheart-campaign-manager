import { expect as baseExpect, test, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./a11y";
import { appBar, openCampaignSettings } from "./config/helpers";
import { hudScene } from "./hud/helpers";

// Plan config R1 (user Q3 changed 2026-11-04): the GM turns "Players see the GM's Fear" off in Campaign settings, and
// the player's Combat Map Fear banner shows "?" without a reload (the flame and banner kept); the GM's banner keeps the
// number. On the dashboard the player's Fear panel core reads "?". Turning it back on brings the number back. Shots go
// to test-results/config-r1/.

test.describe.configure({ timeout: 360_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/config-r1/${name}.png`, animations: "disabled" });

test("Players see the GM's Fear off: the player's banner and dashboard show '?', the GM keeps the number", async ({ browser }) => {
  const s = await hudScene(browser);
  const { gm, player, campaignId } = s;
  try {
    for (const page of [gm, player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByTestId("combat-hud")).toBeVisible();
    }
    const gmValue = gm.getByTestId("hud-fear-value");
    const playerValue = player.getByTestId("hud-fear-value");
    await expect(playerValue).toHaveText(/^\d+$/);
    const number = (await gmValue.textContent())!;

    const panel = await openCampaignSettings(gm, appBar(gm));
    const fear = panel.getByTestId("settings-table").getByRole("switch", { name: "Players see the GM’s Fear" });
    await fear.click();
    await expect(fear).toHaveAttribute("aria-checked", "false");

    // Live, no reload: "?" with the banner and its flame; the GM still reads the number.
    await expect(playerValue).toHaveText("?");
    await expect(player.getByTestId("hud-fear").getByRole("img", { name: "Fear hidden by the GM" })).toBeVisible();
    await expect(player.locator("[data-testid=hud-fear] .hud-fb-ic")).toBeVisible();
    await expect(gmValue).toHaveText(number);
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=hud-fear]" });
    await shot(player, "player-fear-banner-hidden-1440");

    // The dashboard's Fear panel: the core reads "?".
    await player.goto(`/campaigns/${campaignId}`);
    const core = player.getByTestId("fear-value");
    await expect(core).toHaveText("?");
    await expect(core).toHaveAttribute("aria-label", "Fear hidden by the GM");
    await core.scrollIntoViewIfNeeded();
    await shot(player, "player-dashboard-fear-hidden-1440");

    // Back on: the number returns without a reload.
    await fear.click();
    await expect(fear).toHaveAttribute("aria-checked", "true");
    await expect(core).not.toHaveText("?");
  } finally {
    await s.close();
  }
});
