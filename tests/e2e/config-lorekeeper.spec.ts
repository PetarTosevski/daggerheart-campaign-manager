import { expect as baseExpect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { gotoSettings, settingsPanel } from "./config/helpers";
import { gmAndPlayer } from "./live";

// Plan config U4 (design reference/designs/config/Settings.dc.html, `.s-lore`): Campaign settings, Lorekeeper. The GM
// sees every library book with its switch, the notes book on its own row and the two locked rows. The GM sets "Who can
// ask" to GM only and the player's open composer (second browser) shows "Only the GM can ask the Lorekeeper in this
// campaign." without a reload; the GM turns internet search off and the composer's internet toggle goes away for both.
// The server side is L1's. Needs `pnpm e2e:setup` (the fake model and the mini-book). Shots go to test-results/config-u4/.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/config-u4/${name}.png`, animations: "disabled" });
const composer = (page: Page) => page.getByRole("group", { name: "Ask the Lorekeeper" });
const GM_ONLY = "Only the GM can ask the Lorekeeper in this campaign.";

test("Lorekeeper settings: GM only and internet off reach the player's composer live", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId, campaignName, playerClient } = table;
  try {
    for (const page of [gm, player]) await page.setViewportSize({ width: 1440, height: 900 });
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    await expect(composer(player).getByRole("textbox", { name: "Your question" })).toBeEnabled();
    await expect(composer(player).getByRole("group", { name: "Internet search" })).toBeVisible();

    await gotoSettings(gm, `/campaigns/${campaignId}/lorekeeper`, "lorekeeper");
    const panel = settingsPanel(gm);
    const rows = panel.getByTestId("settings-lorekeeper");
    await expect(rows.getByText("Sources it may search")).toBeVisible();
    await expect(rows.getByRole("switch", { name: "Daggerheart Core Rulebook" })).toHaveAttribute("aria-checked", "true");
    await expect(rows.getByRole("switch", { name: `Your ${campaignName} notes` })).toBeVisible();
    await expect(rows.getByRole("switch", { name: "Table rulings & house rules" })).toBeDisabled();
    await expect(rows.getByRole("switch", { name: "Table rulings & house rules" })).toHaveAttribute("aria-checked", "true");
    await expect(rows.getByRole("switch", { name: "GM-only notes" })).toBeDisabled();
    await expect(rows.getByRole("switch", { name: "GM-only notes" })).toHaveAttribute("aria-checked", "false");
    await expect(rows.getByText("Results are marked “From the internet · unofficial”.")).toBeVisible();
    const web = rows.getByRole("switch", { name: "Search the internet when the books don’t say" });
    const who = rows.getByRole("group", { name: "Who can ask" });
    await expect(web).toHaveAttribute("aria-checked", "true");
    await expect(who.getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "true");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=campaign-settings]" });
    await shot(gm, "gm-lorekeeper-1440");

    // GM only: the player's composer is blocked with the GM-only line, live.
    await who.getByRole("button", { name: "GM only" }).click();
    await expect(who.getByRole("button", { name: "GM only" })).toHaveAttribute("aria-pressed", "true");
    await expect(composer(player).getByRole("alert")).toHaveText(GM_ONLY);
    await expect(composer(player).getByRole("textbox", { name: "Your question" })).toBeDisabled();
    await shot(player, "player-gm-only-1440");

    // Internet off: the composer's internet toggle goes away.
    await web.click();
    await expect(web).toHaveAttribute("aria-checked", "false");
    await expect(composer(player).getByRole("group", { name: "Internet search" })).toHaveCount(0);
    await expect
      .poll(async () => (await playerClient.query(api.campaigns.get, { campaignId }))?.settings)
      .toMatchObject({ lorekeeperAsk: "gm", lorekeeperWeb: false });
    await shot(gm, "gm-lorekeeper-changed-1440");

    // The GM's own composer (behind the panel) also loses the toggle and can still ask.
    await gm.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(composer(gm).getByRole("group", { name: "Internet search" })).toHaveCount(0);
    await expect(composer(gm).getByRole("textbox", { name: "Your question" })).toBeEnabled();

    // Back to the defaults: the player can ask again and sees the toggle.
    await gotoSettings(gm, `/campaigns/${campaignId}/lorekeeper`, "lorekeeper");
    await rows.getByRole("group", { name: "Who can ask" }).getByRole("button", { name: "Everyone" }).click();
    await rows.getByRole("switch", { name: "Search the internet when the books don’t say" }).click();
    await expect(composer(player).getByRole("textbox", { name: "Your question" })).toBeEnabled();
    await expect(composer(player).getByRole("group", { name: "Internet search" })).toBeVisible();

    // A phone-width panel keeps every row usable.
    await gm.setViewportSize({ width: 390, height: 844 });
    await expect(rows).toBeVisible();
    await shot(gm, "gm-lorekeeper-390");
  } finally {
    await table.close();
  }
});
