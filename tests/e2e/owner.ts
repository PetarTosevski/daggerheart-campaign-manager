import { execFileSync } from "node:child_process";

import { expect, type Page } from "@playwright/test";

/**
 * The one app owner account of the e2e backend (plan config AX). Every spec that needs the owner signs in as this
 * account and names it with `setAppOwner()`, so specs never hand the role between different accounts: running
 * `setOwner` again for the same account changes nothing (beyond an `owner.set` audit row), and no spec has to put a
 * previous owner back. The default test GM (`e2e-gm@example.test`) is never the owner, so its specs (for example
 * admin-shell's 'Not allowed') hold whatever ran before.
 *
 * A spec that changes an app-wide setting as the owner (read-only mode, caps, Lorekeeper limits, feature switches)
 * restores it in `finally`.
 */
export const E2E_OWNER_EMAIL = "e2e-owner@example.test";

/**
 * Names the app owner through the internal setup function (`npx convex run adminSetup:setOwner`, the documented way;
 * scripts/convex-e2e.mjs targets the e2e backend only). The account must exist and be verified: sign it in first.
 */
export function setAppOwner(email = E2E_OWNER_EMAIL) {
  const env = { ...process.env, E2E_CONVEX_PORT: process.env.E2E_CONVEX_PORT ?? "3212" };
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "run", "adminSetup:setOwner", JSON.stringify({ email })], { env, stdio: "pipe" });
}

/**
 * Clicks 'Open <name>' in App admin › Overview › Campaigns, loading more pages until the row shows. The list pages
 * `campaigns.by_deletedAt_archivedAt` descending, so every archived campaign on the shared backend sorts ahead of the
 * live ones and a new campaign is not always on the first page.
 */
export async function openFromOverview(page: Page, name: string) {
  const open = page.getByRole("button", { name: `Open ${name}`, exact: true });
  const more = page.getByRole("button", { name: "Show more campaigns" });
  await expect(open.or(more).first()).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 100 && !(await open.isVisible()); i++) {
    await more.click();
    await expect(open.or(more).first()).toBeVisible({ timeout: 20_000 });
  }
  await open.click();
}
