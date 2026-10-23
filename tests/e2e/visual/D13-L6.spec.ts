import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect as baseExpect, test } from "@playwright/test";

import { gmAndPlayer } from "../live";
import { visual } from "./helpers";

// D13 L6: the chat column (stream, answer cards, composer) at 1440x900 and 390x844, next to the board's chat panel
// (reference/designs/project/Lorekeeper.dc.html, page variant) shot at the same sizes. Shots land in
// test-results/visual/D13-L6/ (app: chat-<w>.png, error-<w>.png, board: board-chat-<w>.png). Verdicts in
// docs/tasks/TASK-D13-L6.md. dcm-bxp.82.9: a question containing FAKE-FAIL makes the fake model fail, so the answer
// error card ('couldn't answer just now' + Try again) is shot too.
// `pnpm e2e:setup` (scripts/e2e-setup.mjs) turns the fake model on and ingests the invented mini-book as the core
// book; rerun it once per checkout after pulling (dcm-bxp.82.8).

test.describe.configure({ timeout: 180_000 });
// `configure` returns a new expect; it does not change the imported one (dcm-bxp.82.8).
const expect = baseExpect.configure({ timeout: 20_000 });

const BOARD = pathToFileURL(join(process.cwd(), "reference/designs/project/Lorekeeper.dc.html")).href;

test("D13-L6 chat column at 1440 and 390, with the board's", { tag: "@visual" }, async ({ browser, page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(BOARD);
    const panel = page.locator(".lk-chat");
    await expect(panel.getByText("Rules unclear")).toBeVisible();
    await panel.screenshot({ path: `test-results/visual/D13-L6/board-chat-${viewport.width}.png`, animations: "disabled" });
  }

  const table = await gmAndPlayer(browser);
  try {
    const { player, campaignId } = table;
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    const column = player.getByRole("region", { name: "The Lorekeeper" });
    const composer = column.getByRole("group", { name: "Ask the Lorekeeper" });
    const answers = column.getByRole("article", { name: "The Lorekeeper's answer" });
    await composer.getByRole("button", { name: "Critical hits" }).click();
    await expect(answers.filter({ hasText: "From the rules" }).getByRole("button", { name: "Copy" })).toBeVisible();
    await composer.getByRole("button", { name: "Do Hexes stack?" }).click();
    await expect(answers.filter({ hasText: "Rules unclear" }).getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 40_000 });
    await visual(player, "D13-L6").shoot(column, "chat");

    // The answer error card (dcm-bxp.82.9): the fake model fails any question containing FAKE-FAIL.
    const box = composer.getByRole("textbox", { name: "Your question" });
    await expect(box).toBeEnabled();
    await box.fill("FAKE-FAIL: can I climb while grappled?");
    await box.press("Enter");
    const failed = answers.filter({ hasText: /couldn.t answer just now/ });
    await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible({ timeout: 40_000 });
    await visual(player, "D13-L6").shoot(column, "error");
  } finally {
    await table.close();
  }
});
