import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H1.2 (docs/tasks/TASK-HUD-H1.2.md): with the HUD on, the Fear banner hangs top-right (− / + on the
// GM view only, no confirm: answer 6a), the day / time disc hangs left of it (the GM's opens the time arc with End day,
// the player's is read only: answer 9b), and the title with the toolbar sits at x = 690. Live: the GM's − / + reach the
// player's banner. The seed is a Witherwild campaign, so the disc shows the campaign day and phase.

function fearBanner(page: Page) {
  return page.locator('[data-hud-region="fear"]').getByRole("group", { name: "GM Fear" });
}

async function expectFear(page: Page, fear: number) {
  await expect(fearBanner(page).getByRole("img", { name: `${fear} of 12 Fear` })).toBeVisible();
  await expect(fearBanner(page).getByTestId("hud-fear-value")).toHaveText(String(fear));
}

test("the GM's Fear − / + reach the player's banner live, without a confirm; disc, title and toolbars", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId } = s;
  try {
    await client.mutation(api.fear.set, { campaignId, value: 5, idempotencyKey: crypto.randomUUID() });
    for (const page of [gm, player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByTestId("combat-hud")).toBeVisible();
      await expectFear(page, 5);
    }

    // The banner sits top-right (right 24), the title at x = 690.
    const fearBox = await gm.locator(".hud-fb").boundingBox();
    expect(fearBox && Math.round(1440 - (fearBox.x + fearBox.width))).toBe(24);
    const titleBox = await gm.getByTestId("hud-title").boundingBox();
    expect(titleBox && Math.round(titleBox.x)).toBe(690);

    // Players read the Fear only.
    await expect(fearBanner(player).getByRole("button")).toHaveCount(0);

    // GM: + then − apply at once, with no confirm (answer 6a), and the player's banner follows live.
    await fearBanner(gm).getByRole("button", { name: "Gain a Fear" }).click();
    await expect(gm.getByRole("dialog")).toHaveCount(0);
    await expectFear(gm, 6);
    await expectFear(player, 6);
    await fearBanner(gm).getByRole("button", { name: "Spend a Fear" }).click();
    await fearBanner(gm).getByRole("button", { name: "Spend a Fear" }).click();
    await expect(gm.getByRole("dialog")).toHaveCount(0);
    await expectFear(gm, 4);
    await expectFear(player, 4);
    await expect.poll(async () => client.query(api.campaigns.fear, { campaignId })).toBe(4);

    // The disc: Witherwild's day and phase. The player's is read only; the GM's opens the time arc with End day.
    const playerDisc = player.getByTestId("hud-disc");
    await expect(playerDisc).toContainText("Day 1");
    await expect(playerDisc.getByRole("button")).toHaveCount(0);
    await expect(player.getByRole("img", { name: /^Week 1, Day 1, .+ light$/ })).toBeVisible();
    const discButton = gm.getByTestId("hud-disc").getByRole("button", { name: /^Week 1, Day 1, .+: open the time arc$/ });
    await discButton.click();
    const arc = gm.getByRole("dialog", { name: "Time of the long cycle" });
    await expect(arc.getByRole("region", { name: "Time of the long cycle" })).toBeVisible();
    await expect(arc.getByRole("button", { name: /End day/ })).toBeVisible();
    await expectNoSeriousA11yViolations(gm);
    await arc.press("Escape");
    await expect(arc).toHaveCount(0);
    await expect(discButton).toBeFocused();

    // The title: map name and the Live line; the GM toolbar per GMDesktop (no Day / Dim / Night: campaign time sets
    // the light) ending with Map tools.
    await expect(gm.getByTestId("hud-title").getByRole("heading", { name: "Forest Camp" })).toBeVisible();
    await expect(gm.getByTestId("hud-title")).toContainText("Live · GM view");
    const gmTools = gm.getByRole("group", { name: "GM tools" });
    for (const name of ["Areas", "Fog", "Dice", "End scene", "Map tools"]) await expect(gmTools.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(gmTools.getByRole("button", { name: /Player view/ })).toBeVisible();
    await expect(gmTools.getByRole("group", { name: "Time of day" })).toHaveCount(0);
    await gmTools.getByRole("button", { name: "Fog", exact: true }).click();
    await expect(gm.getByRole("dialog", { name: "Vision and fog" }).getByRole("group", { name: "Fog brush" })).toBeVisible();
    await gmTools.getByRole("button", { name: "Areas", exact: true }).click();
    await expect(gm.getByRole("dialog", { name: "Areas" }).getByTestId("area-tools")).toBeVisible();
    await expectNoSeriousA11yViolations(gm);
    await gm.getByRole("button", { name: "Close Areas" }).click();
    await expect(gm.getByRole("dialog", { name: "Areas" })).toHaveCount(0);

    // Player: Live, Dice (their dice box) and Sheet.
    await expect(player.getByTestId("hud-title")).toContainText("Live");
    await expect(player.getByTestId("hud-title")).not.toContainText("GM view");
    const playerTools = player.getByRole("group", { name: "Your tools" });
    await expect(playerTools.getByRole("button", { name: "Sheet" })).toHaveAttribute("aria-pressed", "false");
    await playerTools.getByRole("button", { name: "Dice" }).click();
    await expect(player.getByRole("dialog", { name: "Dice" }).getByTestId("hud-dice-box")).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(player, { exclude: "canvas", reason: "WebGL dice canvas: no DOM to check" });
  } finally {
    await s.close();
  }
});
