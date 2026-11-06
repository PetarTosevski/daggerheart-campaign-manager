import { expect as baseExpect, test, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./a11y";
import { artHeader, gear, gotoSettings, settingsPanel } from "./config/helpers";
import { signInAsTestGm } from "./fixtures";
import { gmAndPlayer } from "./live";

// Plan config U3 (design reference/designs/config/Settings.dc.html `.s-players`): Campaign settings, Players. The
// creator makes a player co-GM from the row menu; the co-GM gets the gear, sees the roster and can't manage co-GMs
// (Q7 a); the creator invites an email as co-GM and that account joins as co-GM (Q8 b). Shots: test-results/config-u3/.

test.describe.configure({ timeout: 300_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/config-u3/${name}.png`, animations: "disabled" });
const PLAYER_NAME = "e2e-player";

test("the creator makes a player co-GM; the co-GM gets the gear and can't manage co-GMs", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId, characterName } = table;
  const dashboard = `/campaigns/${campaignId}`;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gotoSettings(gm, dashboard, "players");
    const panel = settingsPanel(gm);
    await expect(panel.getByRole("heading", { level: 3, name: "Players" })).toBeVisible();
    const people = panel.getByRole("list", { name: "People in this campaign" });
    await expect(people.getByText("Owner")).toBeVisible();
    const row = panel.getByTestId(`settings-member-${PLAYER_NAME}`);
    await expect(row).toContainText(`plays ${characterName} · Bard`);
    await expect(panel.getByText("Anyone with the link can join this campaign as a player.")).toBeVisible();
    await expect(panel.getByTestId("settings-join-link")).toContainText("/join/");
    await expect(panel.getByRole("group", { name: "Invite as" })).toBeVisible();
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=campaign-settings]" });
    await shot(gm, "creator-players-1440");

    // The player has no gear yet.
    await expect(gear(artHeader(player))).toHaveCount(0);

    // Make co-GM from the row menu.
    await row.getByRole("button", { name: `Options for ${PLAYER_NAME}` }).click();
    await shot(gm, "creator-row-menu-1440");
    await panel.getByRole("button", { name: "Make co-GM" }).click();
    await expect(row.getByText("Co-GM", { exact: true })).toBeVisible();

    // The co-GM gets the gear live and sees the roster, but no co-GM controls and no 'Invite as'.
    await expect(gear(artHeader(player))).toBeVisible();
    await player.setViewportSize({ width: 1440, height: 900 });
    await gotoSettings(player, dashboard, "players");
    const coPanel = settingsPanel(player);
    await expect(coPanel.getByRole("list", { name: "People in this campaign" })).toContainText("Owner");
    await expect(coPanel.getByTestId(`settings-member-${PLAYER_NAME}`)).toContainText("Co-GM");
    await expect(coPanel.getByRole("button", { name: "Remove co-GM" })).toHaveCount(0);
    await expect(coPanel.getByRole("button", { name: "Make co-GM" })).toHaveCount(0);
    // Their own row (a co-GM) has no menu: only the creator removes co-GMs.
    await expect(coPanel.getByRole("button", { name: `Options for ${PLAYER_NAME}` })).toHaveCount(0);
    await expect(coPanel.getByRole("group", { name: "Invite as" })).toHaveCount(0);
    await expect(coPanel.getByLabel("Player email")).toBeVisible();
    await shot(player, "cogm-players-1440");

    // The creator demotes them again; the gear goes.
    await row.getByRole("button", { name: `Options for ${PLAYER_NAME}` }).click();
    await panel.getByRole("button", { name: "Remove co-GM" }).click();
    await expect(row.getByText("Co-GM", { exact: true })).toHaveCount(0);
    await player.goto(dashboard);
    await expect(gear(artHeader(player))).toHaveCount(0);

    // Remove from campaign asks first; Cancel keeps them.
    await row.getByRole("button", { name: `Options for ${PLAYER_NAME}` }).click();
    await panel.getByRole("button", { name: "Remove from campaign" }).click();
    const confirm = panel.getByRole("group", { name: `Remove ${PLAYER_NAME}?` });
    await expect(confirm).toBeVisible();
    await shot(gm, "creator-remove-confirm-1440");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(row).toBeVisible();

    // Phone width: the section still fits.
    await gm.setViewportSize({ width: 390, height: 844 });
    await expect(row).toBeVisible();
    await shot(gm, "creator-players-390");
  } finally {
    await table.close();
  }
});

test("the creator invites an email as co-GM; that account joins as co-GM", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  const { gm, campaignId } = table;
  const dashboard = `/campaigns/${campaignId}`;
  const email = `e2e-cogm-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const context = await browser.newContext();
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gotoSettings(gm, dashboard, "players");
    const panel = settingsPanel(gm);
    await panel.getByRole("group", { name: "Invite as" }).getByRole("button", { name: "Co-GM" }).click();
    await panel.getByLabel("Player email").fill(email);
    await panel.getByRole("button", { name: "Invite", exact: true }).click();
    const pending = panel.getByRole("list", { name: "Pending invites" }).getByRole("listitem").filter({ hasText: email });
    await expect(pending).toContainText("· invited");
    await expect(pending.getByText("Co-GM", { exact: true })).toBeVisible();
    await shot(gm, "creator-cogm-invite-1440");

    const invitee = await context.newPage();
    await signInAsTestGm(invitee, email);
    await expect(invitee).toHaveURL("/");
    await invitee.goto(dashboard);
    // Opening the campaign accepts the invite (markOpened) as a co-GM: the gear shows.
    await expect(gear(artHeader(invitee))).toBeVisible();
    const name = email.split("@")[0];
    await expect(panel.getByTestId(`settings-member-${name}`)).toContainText("Co-GM");
    await expect(panel.getByRole("list", { name: "Pending invites" })).toHaveCount(0);
  } finally {
    await context.close();
    await table.close();
  }
});
