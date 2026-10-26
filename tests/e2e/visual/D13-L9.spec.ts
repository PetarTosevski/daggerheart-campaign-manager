import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect as baseExpect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { lorekeeperMessages } from "../../../src/lib/errors/lorekeeper";
import { CAP_CAMPAIGN_TEXT, NOT_SET_UP } from "../../../src/lib/lorekeeper/copy";
import { gmAndPlayer } from "../live";
import { expectNoHorizontalScroll } from "./helpers";

// D13 L9: the closing visual pass of the Lorekeeper at 1440x900 and 390x844: the page with answers, the drawer, and
// the empty, error (a conversation that is no longer readable; the server without a model) and cap states, next to
// the board's page and drawer variants (reference/designs/project/Lorekeeper.dc.html; the drawer from a copy with the
// board's own config switched to `"layout": "drawer"`, written under test-results, never into reference/).
// The e2e fake model answers (scripts/e2e-setup.mjs). Shots land in test-results/visual/D13-L9/:
//   app:   page, drawer (viewport); empty, error-gone, error-unavailable, cap (whole page)   (each -1440 and -390)
//   board: board-page, board-drawer                                  (each -1440 and -390)
// Verdicts per region in docs/tasks/TASK-D13-L9.md.

test.describe.configure({ timeout: 300_000 });
// `configure` returns a new expect; it does not change the imported one.
const expect = baseExpect.configure({ timeout: 30_000 });

const OUT = "test-results/visual/D13-L9";
const BOARD_FILE = join(process.cwd(), "reference/designs/project/Lorekeeper.dc.html");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

function convexEnv(args: string[]) {
  const env = { ...process.env, E2E_CONVEX_PORT: process.env.E2E_CONVEX_PORT ?? "3212" };
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "env", ...args], { env, stdio: "ignore" });
}

/** A copy of the board with its CFG switched to the drawer layout (as D13-L7). */
function boardDrawerUrl(): string {
  const source = readFileSync(BOARD_FILE, "utf8");
  const drawer = source.replace('\\"layout\\": \\"page\\"', '\\"layout\\": \\"drawer\\"');
  if (drawer === source) throw new Error("The board's layout switch was not found");
  mkdirSync(OUT, { recursive: true });
  const file = join(process.cwd(), OUT, "board-drawer.html");
  writeFileSync(file, drawer);
  return pathToFileURL(file).href;
}

/**
 * The screen at both widths (viewport-sized, or the whole page with `fullPage` so a notice below the fold shows);
 * at 390 the page must not scroll sideways.
 */
async function shoot(page: Page, name: string, ready: () => Promise<void>, fullPage = false) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await ready();
    if (viewport.width < 640) await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${OUT}/${name}-${viewport.width}.png`, animations: "disabled", fullPage });
  }
  await page.setViewportSize(VIEWPORTS[0]);
}

test("D13-L9 page, drawer, empty, error and cap states, with the board's", { tag: "@visual" }, async ({ browser, page }) => {
  // The board: page and drawer variants.
  await page.goto(pathToFileURL(BOARD_FILE).href);
  await shoot(page, "board-page", () => expect(page.locator(".lk-chat").getByText("Rules unclear")).toBeVisible());
  await page.goto(boardDrawerUrl());
  await shoot(page, "board-drawer", () => expect(page.locator(".lk-drawer")).toBeVisible());

  const table = await gmAndPlayer(browser);
  try {
    const { gm, player, campaignId, client } = table;
    const column = (p: Page) => p.getByRole("region", { name: "The Lorekeeper" });
    const composer = (p: Page) => column(p).getByRole("group", { name: "Ask the Lorekeeper" });
    const answers = (p: Page) => column(p).getByRole("article", { name: "The Lorekeeper's answer" });
    await client.mutation(api.lorekeeperRulings.pin, { campaignId, title: "Hexes don’t stack", text: "Only the biggest Hex penalty applies to a target." });

    // Empty: no conversation yet.
    await gm.goto(`/campaigns/${campaignId}/lorekeeper`);
    await shoot(gm, "empty", () => expect(column(gm).getByText("Ask me anything about the rules in your books.")).toBeVisible(), true);
    await expect(composer(gm).getByRole("textbox", { name: "Your question" })).toBeEnabled();

    // The page with a 'From the rules' and a 'Rules unclear' answer (checked again, searched online).
    await composer(gm).getByRole("button", { name: "Critical hits" }).click();
    await expect(answers(gm).filter({ hasText: "From the rules" }).getByRole("button", { name: "Copy" })).toBeVisible();
    await composer(gm).getByRole("button", { name: "Do Hexes stack?" }).click();
    await expect(answers(gm).filter({ hasText: "Rules unclear" }).getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 60_000 });
    await shoot(gm, "page", () => expect(answers(gm).filter({ hasText: "Rules unclear" })).toBeVisible());

    // The drawer over the Party page (the same conversation).
    await gm.goto(`/campaigns/${campaignId}/party`);
    await expect(gm.getByRole("article", { name: table.characterName })).toBeVisible(); // hydrated
    await gm.getByRole("button", { name: "Ask the Lorekeeper" }).click();
    const drawer = gm.getByRole("dialog", { name: "The Lorekeeper" });
    await shoot(gm, "drawer", () => expect(drawer.locator(".lk-drawerpanel")).toBeVisible());
    await drawer.getByRole("button", { name: "Close the Lorekeeper" }).click();

    // Error: the player has the GM's shared conversation open; the GM makes it private.
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    await expect(composer(player).getByRole("textbox", { name: "Your question" })).toBeEnabled(); // hydrated
    await column(player).getByRole("button", { name: "Conversations" }).click();
    await column(player).getByRole("region", { name: "Shared in the campaign" }).getByRole("button", { name: /If my Hope and Fear dice match/ }).click();
    await expect(answers(player).filter({ hasText: "From the rules" })).toBeVisible();
    const { mine } = await client.query(api.lorekeeper.listConversations, { campaignId });
    await client.mutation(api.lorekeeper.setVisibility, { campaignId, conversationId: mine[0]!._id, visibility: "private" });
    await shoot(player, "error-gone", () => expect(column(player).getByText(lorekeeperMessages.LOREKEEPER_NOT_FOUND)).toBeVisible(), true);

    // Error: the server has no model (no key, fake model off).
    convexEnv(["remove", "--", "LOREKEEPER_FAKE_MODEL"]);
    try {
      await player.goto(`/campaigns/${campaignId}/lorekeeper`);
      await shoot(player, "error-unavailable", () => expect(composer(player).getByText(NOT_SET_UP)).toBeVisible(), true);
    } finally {
      convexEnv(["set", "--", "LOREKEEPER_FAKE_MODEL", "true"]);
    }

    // Cap: a campaign budget of $0 refuses every question.
    convexEnv(["set", "--", "LOREKEEPER_CAMPAIGN_MONTHLY_USD", "0"]);
    try {
      await player.goto(`/campaigns/${campaignId}/lorekeeper`);
      await shoot(player, "cap", () => expect(composer(player).getByRole("alert")).toHaveText(CAP_CAMPAIGN_TEXT), true);
    } finally {
      convexEnv(["remove", "--", "LOREKEEPER_CAMPAIGN_MONTHLY_USD"]);
    }
  } finally {
    await table.close();
  }
});
