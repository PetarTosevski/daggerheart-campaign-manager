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

    // H9.3: the GM's top centre is the scene title and the Live chip only (GMDesktop `.scn`, top 16); every GM tool is
    // in the dock, so the title row has no buttons, and no Day / Dim / Night (the light is set from the day disc).
    const gmTitle = gm.getByTestId("hud-title");
    await expect(gmTitle.getByRole("heading", { name: "Forest Camp" })).toBeVisible();
    await expect(gm.getByTestId("hud-live")).toHaveText("Live");
    await expect(gmTitle).not.toContainText("GM view");
    await expect(gm.locator(".hud-scene").getByRole("button")).toHaveCount(0);
    await expect(gm.getByRole("group", { name: "GM tools" })).toHaveCount(0);
    await expect(gm.getByRole("group", { name: "Time of day" })).toHaveCount(0);
    const hud = await gm.getByTestId("combat-hud").boundingBox();
    const pill = await gmTitle.boundingBox();
    expect(hud && pill && Math.round(pill.y - hud.y)).toBe(16);
    for (const name of ["Areas", "Fog", "Dice", "End scene"]) await expect(gm.getByRole("button", { name, exact: true })).toHaveCount(1);
    await expectNoSeriousA11yViolations(gm);
    await gm.setViewportSize({ width: 1024, height: 768 });
    const tabletHud = await gm.getByTestId("combat-hud").boundingBox();
    const tabletPill = await gmTitle.boundingBox();
    expect(tabletHud && tabletPill && Math.round(tabletPill.x - tabletHud.x)).toBe(484);
    await expectNoSeriousA11yViolations(gm);
    await gm.setViewportSize({ width: 1440, height: 900 });

    // Player: Live, Dice (their dice box), Sheet and the map controls on a row of their own.
    await expect(player.getByTestId("hud-title")).toContainText("Live");
    await expect(player.getByTestId("hud-title")).not.toContainText("GM view");
    const playerTools = player.getByRole("group", { name: "Your tools" });
    const sheetButton = playerTools.getByRole("button", { name: "Sheet" });
    await expect(sheetButton).toHaveAttribute("aria-pressed", "false");
    const controls = playerTools.getByRole("toolbar", { name: "Map controls" });
    const sheetBox = await sheetButton.boundingBox();
    const controlsBox = await controls.boundingBox();
    expect(sheetBox && controlsBox && controlsBox.y >= sheetBox.y + sheetBox.height).toBe(true);
    await playerTools.getByRole("button", { name: "Dice" }).click();
    await expect(player.getByRole("dialog", { name: "Dice" }).getByTestId("hud-dice-box")).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(player, { exclude: "canvas", reason: "WebGL dice canvas: no DOM to check" });
    await player.getByRole("button", { name: "Close Dice" }).click();
    // With a sheet open the title and the row fade (Main `.sh-open .title, .tr`).
    await sheetButton.click();
    await expect(player.getByTestId("hud-title")).toBeHidden();
    await expect(playerTools).toBeHidden();
  } finally {
    await s.close();
  }
});
