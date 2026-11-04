import { expect as baseExpect, test, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./a11y";
import { artHeader, openCampaignSettings, sectionNav, settingsPanel } from "./config/helpers";
import { signInAsTestGm } from "./fixtures";

// Plan config U2 (design reference/designs/config/Settings.dc.html, `.s-rules`): Campaign settings, House rules. The GM
// switches a campaign option here and the dashboard's Campaign Rules panel shows the same value (Q10 b, one field);
// adds a house rule, edits it, and finds it in the Lorekeeper's Table rulings card; unpins it from the settings. Shots
// go to test-results/config-u2/.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/config-u2/${name}.png`, animations: "disabled" });

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Rules ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2]! };
}

test("House rules: campaign options and table rulings, in step with the dashboard and the Lorekeeper", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { campaignId } = await gmCreatesCampaign(page);
  const wither = "Wither stays across sessions (house rule)";
  const panelRule = page.getByRole("region", { name: "Campaign Rules" }).getByRole("checkbox", { name: new RegExp(wither.replace(/[()]/g, "\\$&")) });
  await expect(panelRule).not.toBeChecked();

  // The GM opens Campaign settings → House rules: the hint, the frame's options tagged 'Campaign option'.
  const panel = await openCampaignSettings(page, artHeader(page));
  await sectionNav(page, "House rules").click();
  await expect(page).toHaveURL(/[?&]settings=rules\b/);
  const rules = panel.getByTestId("settings-rules");
  await expect(rules.getByText("The Lorekeeper quotes these as table rulings before it searches anywhere else.")).toBeVisible();
  const options = rules.getByRole("list", { name: "Campaign options" });
  await expect(options.getByText("Campaign option").first()).toBeVisible();
  await expect(rules.getByRole("switch", { name: "Massive damage" })).toHaveCount(0);
  await expect(rules.getByText("No table rulings yet.", { exact: false })).toBeVisible();

  // A campaign option here is the dashboard panel's option.
  const witherSwitch = options.getByRole("switch", { name: wither });
  await expect(witherSwitch).toHaveAttribute("aria-checked", "false");
  await witherSwitch.click();
  await expect(witherSwitch).toHaveAttribute("aria-checked", "true");

  // Add a house rule.
  await rules.getByRole("button", { name: "Add a house rule" }).click();
  const add = rules.getByRole("form", { name: "Add a house rule" });
  await add.getByLabel("Title").fill("Falling damage");
  await add.getByLabel("Ruling").fill("Take 1d10 per 10 feet fallen, at most 4d10.");
  await add.getByRole("button", { name: "Add rule" }).click();
  await expect(add).toBeHidden();
  const list = rules.getByRole("list", { name: "Table rulings" });
  await expect(list.getByText("Falling damage")).toBeVisible();
  await expect(list.getByText("Added here")).toBeVisible();
  await expectNoSeriousA11yViolations(page, { include: "[data-testid=campaign-settings]" });
  await shot(page, "gm-rules-1440");

  // Edit it.
  await list.getByRole("button", { name: "Edit Falling damage" }).click();
  const edit = rules.getByRole("form", { name: "Edit Falling damage" });
  await edit.getByLabel("Ruling").fill("Take 1d10 per 10 feet fallen, at most 5d10.");
  await shot(page, "gm-rules-edit-1440");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(list.getByText("Take 1d10 per 10 feet fallen, at most 5d10.")).toBeVisible();

  // Close: the dashboard's Campaign Rules panel shows the same option on.
  await page.keyboard.press("Escape");
  await expect(settingsPanel(page)).toBeHidden();
  await expect(panelRule).toBeChecked();

  // The Lorekeeper's Table rulings card lists the house rule.
  await page.goto(`/campaigns/${campaignId}/lorekeeper`);
  const card = page.getByRole("region", { name: "Table rulings" });
  await expect(card.getByText("Falling damage")).toBeVisible();
  await expect(card.getByText("Take 1d10 per 10 feet fallen, at most 5d10.")).toBeVisible();
  await shot(page, "gm-lorekeeper-rulings-1440");

  // Unpin it from the settings (inline confirm); the card empties live.
  await page.goto(`/campaigns/${campaignId}/lorekeeper?settings=rules`);
  const rules2 = settingsPanel(page).getByTestId("settings-rules");
  await rules2.getByRole("button", { name: "Unpin Falling damage" }).click();
  await rules2.getByRole("group", { name: "Unpin Falling damage?" }).getByRole("button", { name: "Unpin" }).click();
  await expect(rules2.getByText("No table rulings yet.", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card.getByText("Falling damage")).toHaveCount(0);

  // Phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/campaigns/${campaignId}?settings=rules`);
  await expect(settingsPanel(page).getByTestId("settings-rules")).toBeVisible();
  await shot(page, "gm-rules-390");
});
