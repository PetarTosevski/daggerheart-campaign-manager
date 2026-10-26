// D12 H24 (.omc/plans/d12-hardening.yaml): one flow across the hardening phase. A signed-out visitor is sent to sign-in,
// the GM backs up and restores their settings through Settings > Saved data, a player joins and sees the GM's Fear
// change without a reload, and the GM's dashboard has no serious or critical axe finding at 1024x768 (tablet,
// landscape). Each part has its own detailed spec (unauthenticated, settings-backup, live-dashboard, a11y-entry); this
// proves they hold together on one backend.

import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { settingsBackupText } from "../../src/lib/validation/settings-backup";
import { expectFitsViewport, expectNoSeriousA11yViolations, summarizeViolations } from "./a11y";
import { openSettings, signInAsTestGm } from "./fixtures";
import { gmAndPlayer } from "./live";
import { convexAs } from "./visual/helpers";

// Three sign-ins, a join and a production build on a loaded machine.
test.setTimeout(180_000);

test("D12 flow: sign-out protection, settings backup, a live Fear change and a tablet axe check", async ({ browser }) => {
  // 1. Signed out, a protected route redirects to sign-in and keeps the destination.
  const anon = await browser.newContext();
  try {
    const page = await anon.newPage();
    await page.goto("/campaigns");
    await expect(page).toHaveURL(`/signin?next=${encodeURIComponent("/campaigns")}`);
    await expect(page.getByRole("form", { name: "Test sign-in" })).toBeVisible();
  } finally {
    await anon.close();
  }

  // 2. The GM's settings backup round trip: show, change, restore from the pasted text.
  const gmContext = await browser.newContext();
  const gmPage = await gmContext.newPage();
  await signInAsTestGm(gmPage);
  await expect(gmPage).toHaveURL("/");
  const gmClient = await convexAs(gmPage);
  const original = await gmClient.query(api.settings.get, {});
  const tableName = `Flow Table ${Date.now().toString(36)}`;
  try {
    await gmClient.mutation(api.settings.update, { tableName });
    await openSettings(gmPage);
    const dialog = gmPage.getByRole("dialog", { name: "Settings" });
    const section = dialog.getByRole("region", { name: "Saved data" });
    await expect(dialog.getByLabel("Table name")).toHaveValue(tableName);
    await section.getByRole("button", { name: "Show backup" }).click();
    const box = section.getByRole("textbox", { name: "Backup data" });
    await expect(section.getByRole("status")).toHaveText(/Backup shown below and selected/);
    const backup = await box.inputValue();
    expect(JSON.parse(backup)).toMatchObject({ kind: "settings", settings: { tableName } });

    await gmClient.mutation(api.settings.update, { tableName: "Changed after the backup" });
    await box.fill(backup);
    await section.getByRole("button", { name: "Restore from pasted backup" }).click();
    await expect(section.getByRole("status")).toHaveText("Settings restored from the backup.");
    await expect(dialog.getByLabel("Table name")).toHaveValue(tableName);
    await expect.poll(async () => (await gmClient.query(api.settings.get, {})).tableName).toBe(tableName);
  } finally {
    // Other specs rely on the GM's own settings.
    await gmClient.mutation(api.settings.restore, { text: settingsBackupText(original) });
    await gmContext.close();
  }

  // 3. A player joins (by code, in a second browser) and sees the GM's Fear change live.
  const { gm, player, close } = await gmAndPlayer(browser, { frame: "beast-feast" });
  try {
    const fear = player.getByTestId("fear-value");
    await expect(fear).toHaveText("—");
    await gm.getByRole("button", { name: "Fear 3 of 12" }).click();
    await expect(fear).toHaveText("III");
    await expect(player.getByRole("button", { name: "Fear 3 of 12" })).toHaveAttribute("aria-pressed", "true");

    // 4. The GM's dashboard at 1024x768: zero serious or critical axe findings, no sideways scroll.
    await gm.setViewportSize({ width: 1024, height: 768 });
    await expect(gm.getByTestId("fear-value")).toHaveText("III");
    const minor = await expectNoSeriousA11yViolations(gm);
    test.info().annotations.push(...summarizeViolations(minor).map((line) => ({ type: "axe dashboard 1024x768", description: line })));
    await expectFitsViewport(gm);
  } finally {
    await close();
  }
});
