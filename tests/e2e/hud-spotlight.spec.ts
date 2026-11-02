import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H1.S (docs/tasks/TASK-HUD-H1.S.md; user answer 1c): the GM takes the spotlight from the HUD's
// spotlight menu and the player's HUD shows the GM's turn ("The GM has the spotlight", "Reactions only until the
// spotlight comes back to you") without a reload; the GM hands it back to Moss and the notice goes away. Two browsers,
// switch on for both. axe passes on both views.

test("the GM takes the spotlight and hands it back; the player's HUD follows live", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await player.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await player.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    await expect(player.getByTestId("combat-hud")).toBeVisible();

    // At the start nobody in particular holds it: the player sees no GM's turn, the GM sees the menu.
    const menu = gm.getByRole("region", { name: "Spotlight" });
    await expect(menu).toContainText("The players have the spotlight.");
    await expect(player.getByTestId("hud-gm-turn")).toHaveCount(0);

    // The GM takes it.
    await menu.getByRole("button", { name: "Take the spotlight" }).click();
    await expect(menu).toContainText("You have the spotlight. The GM is making a move.");
    await expect(menu.getByRole("button", { name: "Take the spotlight" })).toHaveCount(0);

    // The player's HUD shows the GM's turn without a reload.
    const card = player.getByTestId("hud-gm-turn");
    await expect(card).toContainText("The GM has the spotlight");
    await expect(card).toContainText("The GM is making a move.");
    await expect(player.getByText("Reactions only until the spotlight comes back to you")).toBeVisible();
    await expect(player.getByRole("region", { name: "Spotlight" })).toHaveCount(0);
    await player.screenshot({ path: "test-results/visual/HUD-H1.S/player-gm-turn-1440.png", animations: "disabled" });
    await gm.screenshot({ path: "test-results/visual/HUD-H1.S/gm-holds-1440.png", animations: "disabled" });
    await expectNoSeriousA11yViolations(player);
    await expectNoSeriousA11yViolations(gm);

    // The GM hands it back to Moss: the notice leaves the player's screen.
    await menu.getByRole("group", { name: "Hand the spotlight back to" }).getByRole("button", { name: "Hand the spotlight to Moss" }).click();
    await expect(menu).toContainText("Moss has the spotlight.");
    await expect(player.getByTestId("hud-gm-turn")).toHaveCount(0);
    await expect(player.getByText("Reactions only until the spotlight comes back to you")).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Hand the spotlight to Moss" })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Take the spotlight" })).toBeVisible();
  } finally {
    await s.close();
  }
});
