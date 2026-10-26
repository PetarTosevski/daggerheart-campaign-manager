import { expect, test, type Page } from "@playwright/test";

import { D10_VIEWPORTS, openSessions, visual } from "./helpers";

// D10 S4 visual spec (E2E_VISUAL=1): the Prep stage at 1440, 1024 and 390, empty (no scenes, no encounter: create /
// link) and filled as the board's story Session 3 (Combat 'Bandits at the ford', Social 'Bargain with the ferryman',
// hooks, 2 PCs, a Bruiser and a Standard, 'Harder or longer fight'). Board counterpart:
// `node scripts/board-shots.mjs sessions:prep` (test-results/visual/board/sessions-prep-*.png).

async function add(page: Page, search: string, pick: string) {
  await page.getByRole("button", { name: "+ Add adversary" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to encounter" });
  await dialog.getByPlaceholder("Search by name or type").fill(search);
  await dialog.getByRole("list", { name: "Matching adversaries" }).getByRole("button", { name: pick }).click();
  await dialog.getByRole("button", { name: "Add to encounter", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("D10 S4 prep at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  await openSessions(page);
  await page.getByRole("button", { name: "+ New session" }).click();
  const detail = page.getByRole("region", { name: "Session detail" });
  const prep = page.getByRole("tabpanel");
  await expect(prep.getByRole("button", { name: "Create the session encounter" })).toBeVisible();

  const { shoot } = visual(page, "D10-S4", D10_VIEWPORTS);
  await shoot(prep, "prep-empty");

  for (const [i, [type, text]] of [
    ["combat", "Bandits at the ford"],
    ["social", "Bargain with the ferryman"],
  ].entries()) {
    await prep.getByRole("button", { name: "+ Scene" }).click();
    await expect(prep.getByLabel(`Scene ${i + 1} type`)).toBeEnabled();
    await prep.getByLabel(`Scene ${i + 1} type`).selectOption(type!);
    await prep.getByLabel(`Scene ${i + 1} description`).fill(text!);
    await prep.getByLabel(`Scene ${i + 1} description`).press("Enter");
  }
  const hooks = prep.getByRole("textbox", { name: "Hooks & loose threads" });
  await hooks.fill("The ferryman knows who poisoned the well.");
  await hooks.blur();

  await prep.getByRole("button", { name: "Create the session encounter" }).click();
  await expect(prep.getByTestId("bp-spent")).toHaveText(/Spent 0 of 14/);
  await prep.getByRole("button", { name: "Fewer player characters" }).click();
  await prep.getByRole("button", { name: "Fewer player characters" }).click();
  await add(page, "bear", "Bear, Tier 1 Bruiser");
  await add(page, "bandit", "Jagged Knife Bandit, Tier 1 Standard");
  await prep.getByRole("button", { name: /Harder or longer fight/ }).click();
  await expect(prep.getByTestId("bp-spent")).toHaveText(/Spent 6 of 10/);
  await expect(prep.getByTestId("bp-spent")).toContainText("4 BP left");

  await shoot(prep, "prep");
  await shoot(detail, "detail");
});
