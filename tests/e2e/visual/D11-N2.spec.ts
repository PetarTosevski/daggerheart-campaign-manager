import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { convexAs, visual } from "./helpers";

// D11 N2 shots (E2E_VISUAL=1): hero, index column, empty page and the session picker at 1440x900 and 390x844, saved to
// test-results/visual/D11-N2/. Board counterparts: `node scripts/board-shots.mjs notes:empty notes:player` (1440 only).

test("D11 N2 own journal: hero, index column, empty page and session picker", { tag: "@visual" }, async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const client = await convexAs(page);
  const { sessionId } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.sessionRecords.setDate, { campaignId, sessionId, date: "2026-10-21" });

  await page.goto(`/campaigns/${campaignId}/notes`);
  await expect(page.getByRole("heading", { level: 1, name: "Game Master’s Journal" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Page" }).getByLabel("Page title")).toHaveValue("Session 1");
  const { shoot } = visual(page, "D11-N2");
  await shoot(page.locator(".bj-root"), "journal");
  await shoot(page.locator(".bj-hero"), "hero");
  await shoot(page.getByRole("complementary", { name: "Journal index" }), "index");
  await shoot(page.getByRole("article", { name: "Page" }), "page");

  // The index open at 390 (the 'Pages' disclosure), then the picker at both sizes.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Pages/ }).click();
  await page.screenshot({ path: "test-results/visual/D11-N2/index-open-390.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "New session log" }).click();
  await shoot(page.getByRole("dialog", { name: "New session log" }), "picker");
});
