import { expect as baseExpect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { closeCampaignSettings, openPlayers, sectionNav, settingsPanel } from "./config/helpers";
import { hudScene } from "./hud/helpers";

// Plan config SX (Q10 b, user 2026-11-04): the old entry points are shortcuts to the same settings. GM and player in two
// browsers: the GM, on the dashboard, opens Campaign settings from the header's Players button (Players section) and
// turns off "Players see the GM's Fear" and hand sharing; the player, on the Combat Map with Brannoc's hand open, sees
// "?" and the private-cards line without a reload, and both come back when the GM turns them on again. The dashboard's
// Campaign Rules panel writes the same field as Settings › House rules, and the hero's Start Session follows "A new
// session opens on". Shots go to test-results/config-sx/.

test.describe.configure({ timeout: 360_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/config-sx/${name}.png`, animations: "disabled" });
const hand = (page: Page) => page.getByTestId("hud-hand");
const PLAYER_NAME = "e2e-player";
const WITHER = "Wither stays across sessions (house rule)";
/** The dashboard checkbox's name also holds the option's description. */
const WITHER_BOX = /^Wither stays across sessions \(house rule\)/;

test("the GM's settings reach the player at once, from every entry point", async ({ browser }) => {
  const s = await hudScene(browser);
  const { gm, player, campaignId, playerClient } = s;
  const dashboard = `/campaigns/${campaignId}`;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await player.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(dashboard);
    await expect(gm.getByRole("heading", { level: 1, name: s.campaignName })).toBeVisible();
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    // The player opens Brannoc's sheet: his hand, view only (hand sharing is on by default), and Fear as a number.
    await player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Brannoc's sheet" }).click();
    await expect(hand(player)).toHaveAttribute("data-mode", "view");
    const fearValue = player.getByTestId("hud-fear-value");
    await expect(fearValue).toHaveText(/^\d+$/);

    // ---- The header's Players button opens Campaign settings at Players (one Players UI).
    const panel = await openPlayers(gm);
    await expect(sectionNav(gm, "Players")).toHaveAttribute("aria-current", "true");
    await expect(panel.getByTestId(`settings-member-${PLAYER_NAME}`)).toBeVisible();
    await shot(gm, "gm-players-from-button-1440");

    // ---- At the table: Fear and hand sharing off reach the player's Combat Map without a reload.
    await sectionNav(gm, "Table").click();
    const rows = panel.getByTestId("settings-table");
    const fear = rows.getByRole("switch", { name: "Players see the GM’s Fear" });
    const hands = rows.getByRole("switch", { name: "Players can see each other’s hands" });
    await fear.click();
    await expect(fear).toHaveAttribute("aria-checked", "false");
    await hands.click();
    await expect(hands).toHaveAttribute("aria-checked", "false");
    await expect(fearValue).toHaveText("?");
    await expect(hand(player)).toHaveAttribute("data-mode", "hidden");
    await expect(hand(player)).toContainText("The GM keeps every player’s cards private.");
    await shot(player, "player-fear-and-hands-hidden-1440");

    // Back on: the number and the hand come back, still without a reload.
    await fear.click();
    await hands.click();
    await expect(fear).toHaveAttribute("aria-checked", "true");
    await expect(hands).toHaveAttribute("aria-checked", "true");
    await expect(fearValue).toHaveText(/^\d+$/);
    await expect(hand(player)).toHaveAttribute("data-mode", "view");
    await closeCampaignSettings(gm);
    await expect(gm).not.toHaveURL(/settings=/);

    // ---- The dashboard's Campaign Rules panel and Settings › House rules write the same field.
    const rulesPanel = gm.getByRole("region", { name: "Campaign Rules" });
    const box = rulesPanel.getByRole("checkbox", { name: WITHER_BOX });
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(box).toBeChecked();
    await expect.poll(async () => (await playerClient.query(api.campaigns.get, { campaignId }))?.options.witherPersists).toBe(true);
    await rulesPanel.getByRole("button", { name: "All house rules" }).click();
    await expect(settingsPanel(gm)).toBeVisible();
    await expect(gm).toHaveURL(/[?&]settings=rules\b/);
    const rule = settingsPanel(gm).getByTestId("settings-rules").getByRole("switch", { name: WITHER });
    await expect(rule).toHaveAttribute("aria-checked", "true");
    await rule.click();
    await expect(rule).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => (await playerClient.query(api.campaigns.get, { campaignId }))?.options.witherPersists).toBe(false);

    // ---- Sessions: "A new session opens on" Combat Map; the hero's Start Session goes there, the player stays put.
    await sectionNav(gm, "Sessions").click();
    const opensOn = settingsPanel(gm).getByRole("group", { name: "A new session opens on" });
    await opensOn.getByRole("button", { name: "Combat Map" }).click();
    await expect(opensOn.getByRole("button", { name: "Combat Map" })).toHaveAttribute("aria-pressed", "true");
    await closeCampaignSettings(gm);
    await expect(rulesPanel.getByRole("checkbox", { name: WITHER_BOX })).not.toBeChecked();
    await gm.getByRole("button", { name: "Start Session", exact: true }).click();
    await gm.getByRole("dialog", { name: "Start the session?" }).getByRole("button", { name: "Start session", exact: true }).click();
    await expect(gm).toHaveURL(`${dashboard}/combat-map`);
    await expect(player).toHaveURL(s.url);
  } finally {
    await s.close();
  }
});
