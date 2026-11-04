import { expect as baseExpect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { appBar, openCampaignSettings, settingsPanel } from "./config/helpers";
import { hudScene } from "./hud/helpers";

// Plan config U1 (design reference/designs/config/Settings.dc.html, `.s-table`): Campaign settings, At the table. Every
// switch saves on change. The GM turns hand sharing off in the settings and the player (second browser), looking at
// Brannoc's hand on the Combat Map, sees "The GM keeps every player's cards private." without a reload; the Combat Map's
// own Map tools switch shows the same value (Q10 b, one setting). The GM turns "Players see the GM's Fear" off and the
// player's campaigns.get carries it (what a player then sees is R1's, not built here). Shots go to
// test-results/config-u1/.

test.describe.configure({ timeout: 360_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/config-u1/${name}.png`, animations: "disabled" });
const hand = (page: Page) => page.getByTestId("hud-hand");

test("At the table: the GM's switches save at once and reach the player live", async ({ browser }) => {
  const s = await hudScene(browser);
  const { gm, player, campaignId, client, playerClient } = s;
  try {
    for (const page of [gm, player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByTestId("combat-hud")).toBeVisible();
    }
    // The player opens Brannoc's sheet: his hand, view only (hand sharing is on by default).
    await player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Brannoc's sheet" }).click();
    await expect(hand(player)).toHaveAttribute("data-mode", "view");

    // The GM opens Campaign settings from the Combat Map's app bar: At the table, the board's rows.
    const panel = await openCampaignSettings(gm, appBar(gm));
    const rows = panel.getByTestId("settings-table");
    const hands = rows.getByRole("switch", { name: "Players can see each other’s hands" });
    const fear = rows.getByRole("switch", { name: "Players see the GM’s Fear" });
    const spotlight = rows.getByRole("switch", { name: "Show spotlight balance to players" });
    const locked = rows.getByRole("switch", { name: "Show adversary HP, Stress and Difficulty to players" });
    const range = rows.getByRole("group", { name: "Out-of-range actions" });
    await expect(hands).toHaveAttribute("aria-checked", "true");
    await expect(fear).toHaveAttribute("aria-checked", "true");
    await expect(spotlight).toHaveAttribute("aria-checked", "false");
    await expect(range.getByRole("button", { name: "Ask me" })).toHaveAttribute("aria-pressed", "true");
    await expect(locked).toBeDisabled();
    await expect(rows.getByText("Always off")).toBeVisible();
    await expect(rows.getByText("The bars in the session recap.")).toBeVisible();
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=campaign-settings]" });
    await shot(gm, "gm-table-1440");

    // Hand sharing off: the player's view of Brannoc's hand changes without a reload.
    await hands.click();
    await expect(hands).toHaveAttribute("aria-checked", "false");
    await expect(hand(player)).toHaveAttribute("data-mode", "hidden");
    await expect(hand(player)).toContainText("The GM keeps every player’s cards private.");
    await shot(player, "player-hand-private-1440");

    // Fear off, Refuse, spotlight on: each saves one field, and the player's campaigns.get carries it.
    await fear.click();
    await expect(fear).toHaveAttribute("aria-checked", "false");
    await range.getByRole("button", { name: "Refuse" }).click();
    await expect(range.getByRole("button", { name: "Refuse" })).toHaveAttribute("aria-pressed", "true");
    await spotlight.click();
    await expect(spotlight).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => (await playerClient.query(api.campaigns.get, { campaignId }))?.settings)
      .toMatchObject({ playersSeeFear: false, outOfRange: "refuse", spotlightToPlayers: true });
    await shot(gm, "gm-table-changed-1440");

    // The Combat Map's Map tools switch is the same setting (Q10 b): it shows off, and turning it on there shows on here.
    await gm.keyboard.press("Escape");
    await expect(settingsPanel(gm)).toBeHidden();
    await gm.getByRole("toolbar", { name: "Map controls" }).getByRole("button", { name: "Map tools" }).click();
    const drawer = gm.getByRole("complementary", { name: "Map tools" });
    const toolsSwitch = drawer.getByTestId("combat-hand-sharing").getByRole("switch", { name: "Players can see each other's cards" });
    await expect(toolsSwitch).not.toBeChecked();
    await toolsSwitch.click();
    await expect(toolsSwitch).toBeChecked();
    await expect(hand(player)).toHaveAttribute("data-mode", "view");
    await drawer.press("Escape");
    await openCampaignSettings(gm, appBar(gm));
    await expect(settingsPanel(gm).getByRole("switch", { name: "Players can see each other’s hands" })).toHaveAttribute("aria-checked", "true");

    // Fear back on: back to the default.
    await settingsPanel(gm).getByRole("switch", { name: "Players see the GM’s Fear" }).click();
    await expect.poll(async () => (await client.query(api.campaigns.get, { campaignId }))?.settings.playersSeeFear).toBe(true);

    // A phone-width panel keeps every row usable.
    await gm.setViewportSize({ width: 390, height: 844 });
    await expect(settingsPanel(gm).getByTestId("settings-table")).toBeVisible();
    await shot(gm, "gm-table-390");
  } finally {
    await s.close();
  }
});
