import { ConvexHttpClient } from "convex/browser";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { settingsBackupText } from "../../src/lib/validation/settings-backup";
import { E2E_GM_EMAIL, openSettings, signInAsTestGm } from "./fixtures";

/**
 * TitleMenu "Saved data" (D12 H17, option A): a settings backup shown on one account restores on another, a malformed
 * backup changes nothing, and "Reset settings…" asks first. At 1440 and 390 wide.
 */
const PLAYER_EMAIL = "e2e-player@example.test";

const VIEWPORTS = [
  { name: "desktop 1440", viewport: { width: 1440, height: 960 } },
  { name: "phone 390", viewport: { width: 390, height: 844 } },
];

/** A Convex client authenticated as the page's signed-in user. */
async function convexAs(page: Page): Promise<ConvexHttpClient> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  expect(token, "Convex Auth token in localStorage").toBeTruthy();
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(token!);
  return client;
}

async function signedIn(browser: Browser, email: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signInAsTestGm(page, email);
  await expect(page).toHaveURL("/");
  const client = await convexAs(page);
  const original = await client.query(api.settings.get, {});
  await openSettings(page);
  return { context, page, client, original, dialog: page.getByRole("dialog", { name: "Settings" }) };
}

for (const { name, viewport } of VIEWPORTS) {
  test(`settings backup round trip, refusal and reset (${name})`, async ({ browser }) => {
    const gm = await signedIn(browser, E2E_GM_EMAIL, viewport);
    const player = await signedIn(browser, PLAYER_EMAIL, viewport);
    const tableName = `Backup Table ${Date.now().toString(36)}`;
    try {
      // The GM's settings to carry over.
      await gm.client.mutation(api.settings.update, { tableName, gmName: "Ana", accent: "#d9775b" });
      const section = gm.dialog.getByRole("region", { name: "Saved data" });
      await expect(section).toContainText("Your campaigns are saved to your account and sync across devices.");

      // Show backup: the textarea holds the versioned settings backup, selected.
      await expect(gm.dialog.getByRole("radio", { name: "Ember" })).toHaveAttribute("aria-checked", "true");
      await section.getByRole("button", { name: "Show backup" }).click();
      const gmBox = section.getByRole("textbox", { name: "Backup data" });
      await expect(section.getByRole("status")).toHaveText(/Backup shown below and selected/);
      const text = await gmBox.inputValue();
      expect(JSON.parse(text)).toEqual({
        daggerheartBackup: 2,
        kind: "settings",
        schemaVersion: 1,
        settings: { tableName, gmName: "Ana", accent: "#d9775b", expansions: gm.original.expansions },
      });
      expect(
        await gmBox.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd, el.value.length]),
      ).toEqual([0, text.length, text.length]);

      // A malformed paste on the player's account shows the error status and changes nothing.
      const playerSection = player.dialog.getByRole("region", { name: "Saved data" });
      const playerBox = playerSection.getByRole("textbox", { name: "Backup data" });
      const before = await player.client.query(api.settings.get, {});
      await playerBox.fill(text.replace('"schemaVersion":1', '"schemaVersion":1,"extra":true'));
      await playerSection.getByRole("button", { name: "Restore from pasted backup" }).click();
      const status = playerSection.getByRole("status");
      await expect(status).toHaveText(/doesn’t look like a settings backup/);
      await expect(status).toHaveAttribute("data-ok", "false");
      expect(await player.client.query(api.settings.get, {})).toEqual(before);

      // The GM's backup restores on the player's account.
      await playerBox.fill(text);
      await playerSection.getByRole("button", { name: "Restore from pasted backup" }).click();
      await expect(status).toHaveText("Settings restored from the backup.");
      await expect(status).toHaveAttribute("data-ok", "true");
      await expect(player.dialog.getByLabel("Table name")).toHaveValue(tableName);
      await expect(player.dialog.getByLabel("Your name")).toHaveValue("Ana");
      await expect(player.dialog.getByRole("radio", { name: "Ember" })).toHaveAttribute("aria-checked", "true");
      await expect.poll(async () => (await player.client.query(api.settings.get, {})).tableName).toBe(tableName);

      // Reset settings… asks first; Cancel keeps everything.
      await playerSection.getByRole("button", { name: "Reset settings…" }).click();
      const confirm = playerSection.getByRole("alertdialog", { name: "Confirm reset" });
      await expect(confirm).toContainText("Your campaigns are not affected.");
      await confirm.getByRole("button", { name: "Cancel" }).click();
      await expect(confirm).toBeHidden();
      expect((await player.client.query(api.settings.get, {})).tableName).toBe(tableName);

      await playerSection.getByRole("button", { name: "Reset settings…" }).click();
      await confirm.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(status).toHaveText("Settings reset to their defaults.");
      await expect(confirm).toBeHidden();
      await expect(player.dialog.getByLabel("Table name")).toHaveValue("");
      await expect(player.dialog.getByRole("radio", { name: "Gold" })).toHaveAttribute("aria-checked", "true");
      await expect.poll(async () => (await player.client.query(api.settings.get, {})).tableName).toBe("");

      // Nothing about the backup goes to browser storage.
      for (const page of [gm.page, player.page]) {
        const keys = await page.evaluate(() => Object.keys(localStorage));
        expect(keys.filter((k) => /backup|settings|^dh\./i.test(k))).toEqual([]);
        const values = await page.evaluate(() => Object.values(localStorage).join("\n"));
        expect(values).not.toContain("daggerheartBackup");
      }
    } finally {
      // Other specs rely on each account's own settings.
      await gm.client.mutation(api.settings.restore, { text: settingsBackupText(gm.original) });
      await player.client.mutation(api.settings.restore, { text: settingsBackupText(player.original) });
      await gm.context.close();
      await player.context.close();
    }
  });
}
