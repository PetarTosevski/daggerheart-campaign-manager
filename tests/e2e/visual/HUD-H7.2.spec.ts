import { expect, test, type Page } from "@playwright/test";

import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H7.2.md (E2E_VISUAL=1): the phone shell at 390 × 844 on the seed's real data, set to
// the PlayerPhone board's states ('Hand tab', 'Sheet, full screen', the Attack / Dice / Feed tabs, edge chips during a
// pick) and the GM at 390 (the tablet layout, the queue as a bottom sheet folded and open). Board render to compare:
// reference/designs/combat-hud/preview/PlayerPhone.dc.html (GMTablet for the GM).

const OUT = "test-results/visual/HUD-H7.2";

async function open(page: Page, url: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await expect(page.getByTestId("combat-hud")).toBeVisible();
  await page.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView({ block: "end" }));
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });

test("HUD-H7.2 the phone shell at 390 × 844", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(360_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  try {
    await open(player, s.url);
    const tabs = player.getByRole("tablist", { name: "Combat actions" });
    await expect(player.getByTestId("hud-phone-resources")).toBeVisible({ timeout: 30_000 });
    await player.waitForTimeout(800);
    await shot(player, "player-main");
    await tabs.getByRole("tab", { name: "Hand" }).click();
    await expect(player.getByTestId("hud-phone-tab-hand").getByTestId("hud-hand-card")).toHaveCount(2, { timeout: 30_000 });
    await player.waitForTimeout(800);
    await shot(player, "player-hand-tab");

    await tabs.getByRole("tab", { name: "Attack" }).click();
    await shot(player, "player-attack-tab");
    await tabs.getByRole("tab", { name: "Dice" }).click();
    await expect(player.getByTestId("hud-dice-box")).toBeVisible({ timeout: 30_000 });
    await shot(player, "player-dice-tab");
    await tabs.getByRole("tab", { name: "Feed" }).click();
    await shot(player, "player-feed-tab");
    await tabs.getByRole("tab", { name: "Feed" }).click();
    await shot(player, "player-sheet-folded");
    await tabs.getByRole("tab", { name: "Hand" }).click();

    await player.getByTestId("hud-phone-sheet-button").click();
    await expect(player.getByRole("complementary", { name: /^Moss.s sheet$/ })).toBeVisible();
    await player.waitForTimeout(600);
    await shot(player, "player-sheet-full-screen");
    await player.keyboard.press("Escape");

    await player.getByTestId("hud-phone-tab-hand").getByRole("button", { name: "Use Vicious Entangle" }).click();
    await expect(player.getByTestId("hud-pick")).toBeVisible();
    for (let i = 0; i < 4; i += 1) await player.getByRole("button", { name: "Zoom in" }).click();
    await expect(player.getByTestId("hud-phone-edge").first()).toBeVisible();
    await player.waitForTimeout(400);
    await shot(player, "player-picking-edge-chips");
    // At 760 px and below the picker's footer Cancel replaces the header's ✕ (H7.3).
    await player.getByTestId("hud-pick").getByTestId("hud-pick-cancel").click();

    await open(gm, s.url);
    await expect(gm.getByTestId("hud-phone-queue")).toBeVisible();
    await gm.waitForTimeout(800);
    await shot(gm, "gm-queue-folded");
    await gm.getByRole("button", { name: "Show the requests" }).click();
    await shot(gm, "gm-queue-open");
  } finally {
    await s.close();
  }
});
