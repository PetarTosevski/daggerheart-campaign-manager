import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations, expectTouchTargets } from "./a11y";
import { artHeader, avatar, preferences } from "./config/helpers";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs } from "./visual/helpers";

// Plan config U6a (design reference/designs/config/Settings.dc.html, `.pm-pop`): the Preferences popover's rows are
// saved to the account. One fresh account signs in on two browsers: Dice sound, 3D dice and the volume set in A show in
// B's popover and in B's dice box. Keyboard, axe and touch targets on the rows. Shots go to test-results/config-u6a/.

test.describe.configure({ timeout: 300_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/config-u6a/${name}.png`, animations: "disabled" });

async function signedIn(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signInAsTestGm(page, email);
  await expect(page).toHaveURL("/");
  return { context, page };
}

async function openPreferences(page: Page) {
  await avatar(artHeader(page)).click();
  const prefs = preferences(page);
  await expect(prefs).toBeVisible();
  await expect(prefs.getByTestId("preference-rows")).toBeVisible();
  return prefs;
}

test("Preferences rows follow the account to a second browser, and the dice read them", async ({ browser }) => {
  // A fresh account, so no other spec's dice settings leak in or out.
  const email = `e2e-prefs-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const a = await signedIn(browser, email);
  const b = await signedIn(browser, email);
  try {
    const client = await convexAs(a.page);
    const { campaignId } = await client.mutation(api.campaigns.create, {
      frameId: "witherwild",
      name: `Prefs ${crypto.randomUUID().slice(0, 8)}`,
      idempotencyKey: crypto.randomUUID(),
    });
    const { characterId } = await client.mutation(api.characters.create, {
      campaignId,
      draft: bardDraft("Liriel"),
      idempotencyKey: crypto.randomUUID(),
    });
    const dashboard = `/campaigns/${campaignId}`;
    const sheet = `${dashboard}/party/${characterId}`;

    // ---- A: the board's rows with the defaults.
    await a.page.goto(dashboard);
    const prefsA = await openPreferences(a.page);
    const sw = (name: string) => prefsA.getByRole("switch", { name, exact: true });
    await expect(sw("3D dice")).toHaveAttribute("aria-checked", "true");
    await expect(prefsA.getByText("Rolls tumble across the screen.")).toBeVisible();
    await expect(sw("Dice sound")).toHaveAttribute("aria-checked", "false");
    await expect(prefsA.getByRole("slider", { name: "Dice volume" })).toHaveValue("60");
    await expect(sw("Reduce motion")).toHaveAttribute("aria-checked", "false");
    await expect(prefsA.getByText("Calmer sheet and card animations.")).toBeVisible();
    const textSize = prefsA.getByRole("group", { name: "Text size" });
    await expect(textSize.getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
    await expect(sw("Ping me when I get the spotlight")).toHaveAttribute("aria-checked", "true");
    await expectNoSeriousA11yViolations(a.page, { include: "[data-testid=preference-rows]" });
    await expectTouchTargets(prefsA.getByRole("switch"), 24);
    await shot(a.page, "a-preferences-defaults-1440");

    // ---- A: Dice sound on (keyboard), 3D dice off, volume 30 (saved on release).
    await sw("Dice sound").focus();
    await a.page.keyboard.press("Space");
    await expect(sw("Dice sound")).toHaveAttribute("aria-checked", "true");
    await sw("3D dice").click();
    await expect(sw("3D dice")).toHaveAttribute("aria-checked", "false");
    const volume = prefsA.getByRole("slider", { name: "Dice volume" });
    await volume.focus();
    for (let i = 0; i < 3; i++) await a.page.keyboard.press("PageDown");
    await expect(volume).toHaveValue("30");
    await shot(a.page, "a-preferences-changed-1440");
    await expect.poll(async () => (await client.query(api.preferences.get, {})).diceVolume).toBe(30);
    const saved = await client.query(api.preferences.get, {});
    expect({ diceSound: saved.diceSound, dice3d: saved.dice3d }).toEqual({ diceSound: true, dice3d: false });

    // ---- B: same account, another browser: the popover shows A's choices.
    await b.page.goto(dashboard);
    const prefsB = await openPreferences(b.page);
    await expect(prefsB.getByRole("switch", { name: "Dice sound", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(prefsB.getByRole("switch", { name: "3D dice", exact: true })).toHaveAttribute("aria-checked", "false");
    await expect(prefsB.getByRole("slider", { name: "Dice volume" })).toHaveValue("30");
    await shot(b.page, "b-preferences-from-a-1440");
    await b.page.keyboard.press("Escape");
    await expect(prefsB).toBeHidden();

    // ---- B's dice box reads the account; flipping it there reaches A's open popover live.
    await b.page.goto(sheet);
    const box = b.page.getByRole("region", { name: "Dice", exact: true });
    await expect(box.getByRole("checkbox", { name: "3D dice" })).not.toBeChecked();
    await expect(box.getByRole("checkbox", { name: "Dice sound" })).toBeChecked();
    await box.getByRole("checkbox", { name: "3D dice" }).check();
    await expect(sw("3D dice")).toHaveAttribute("aria-checked", "true");
    await shot(b.page, "b-dice-box-1440");
  } finally {
    await Promise.all([a.context.close(), b.context.close()]);
  }
});
