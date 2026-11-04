import { execFileSync } from "node:child_process";

import { expect as baseExpect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";

// Plan config AU5 (server AD10 / AD11): the owner turns read-only mode on from App admin › Maintenance; every page
// shows the banner (sign-in included); a player's write is refused with the banner's message; the owner can still
// write (an export, downloaded with the owner's token) and turns the mode off again.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const OWNER = "e2e-au5-owner@example.test";
const PLAYER = "e2e-au5-player@example.test";
const MESSAGE = "Updating the Combat Map. Back in about 10 minutes.";

/** Names the app owner through the internal setup function (scripts/convex-e2e.mjs targets the e2e backend only). */
function setOwner(email: string) {
  const env = { ...process.env, E2E_CONVEX_PORT: process.env.E2E_CONVEX_PORT ?? "3212" };
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "run", "adminSetup:setOwner", JSON.stringify({ email })], { env, stdio: "pipe" });
}

/** The signed-in user's Convex Auth token from the page. */
async function tokenOf(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
}

const banner = (page: Page) => page.getByTestId("read-only-banner");

test("the owner turns read-only on, a player's write explains why it fails, the owner still writes and turns it off", async ({ browser }) => {
  const ownerContext = await browser.newContext({ acceptDownloads: true });
  const playerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const player = await playerContext.newPage();
  try {
    // Both accounts exist before the mode is on (read-only blocks new accounts, AD4).
    await signInAsTestGm(owner, OWNER);
    await expect(owner).toHaveURL("/");
    setOwner(OWNER);
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");

    await owner.goto("/admin?tab=maintenance");
    const panel = owner.getByRole("tabpanel", { name: "Maintenance" });
    const mode = panel.getByRole("switch", { name: "Read-only for everyone" });
    await expect(mode).toHaveAttribute("aria-checked", "false");
    await expect(panel.getByRole("heading", { level: 3, name: "Backups" })).toBeVisible();
    await expect(panel.getByText("Keys are never shown or changed here. Change them in the deployment settings.")).toBeVisible();
    await expect(panel.getByText("Connected")).toBeVisible();
    await expectNoSeriousA11yViolations(owner);

    await panel.getByLabel("Banner message").fill(MESSAGE);
    await mode.click();
    await expect(mode).toHaveAttribute("aria-checked", "true");
    await expect(banner(owner)).toContainText(MESSAGE);

    // The player sees the banner on every page and a write says why it fails.
    await player.reload();
    await expect(banner(player)).toContainText(MESSAGE);
    await player.getByRole("button", { name: /Join Campaign/ }).click();
    const join = player.getByRole("dialog", { name: "Join a campaign" });
    await join.getByLabel("Join code").fill("ABCD-EFGH");
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(join.getByRole("alert")).toContainText("The app is read-only for maintenance right now.");
    await expect(join.getByRole("alert")).toContainText(MESSAGE);
    await join.getByRole("button", { name: "Cancel" }).click();

    // Signed out, the sign-in page shows it too.
    const visitorContext = await browser.newContext();
    try {
      const visitor = await visitorContext.newPage();
      await visitor.goto("/signin");
      await expect(banner(visitor)).toContainText(MESSAGE);
    } finally {
      await visitorContext.close();
    }

    // The owner is exempt: an export runs and downloads with the owner's token.
    const exportRow = panel.getByText("Export everything", { exact: true }).locator("xpath=ancestor::div[contains(@class,'adm-row')][1]");
    await exportRow.getByRole("button", { name: /^Export( again)?$/ }).click();
    await expect(exportRow.getByTestId("export-status")).toContainText("Ready. The file is deleted at", { timeout: 60_000 });
    const [download] = await Promise.all([owner.waitForEvent("download"), exportRow.getByRole("button", { name: "Download" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^dualityheart-export-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(panel.getByRole("alert")).toHaveCount(0);

    // Off again: the banner goes everywhere and the player's write goes through to the server's answer.
    await mode.click();
    await expect(mode).toHaveAttribute("aria-checked", "false");
    await expect(banner(owner)).toHaveCount(0);
    await expect(banner(player)).toHaveCount(0);
    await player.getByRole("button", { name: /Join Campaign/ }).click();
    await join.getByLabel("Join code").fill("ABCD-EFGH");
    await join.getByRole("button", { name: "Join", exact: true }).click();
    await expect(join.getByRole("alert")).toBeVisible();
    await expect(join.getByRole("alert")).not.toContainText("read-only");
  } finally {
    // Never leave the shared e2e backend read-only for the next spec.
    const token = await tokenOf(owner).catch(() => null);
    if (token) {
      const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
      client.setAuth(token);
      await client.mutation(api.adminMaintenance.setReadOnly, { on: false }).catch(() => {});
    }
    await ownerContext.close();
    await playerContext.close();
  }
});
