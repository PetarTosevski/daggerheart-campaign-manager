import { expect, test } from "@playwright/test";

import { D9_VIEWPORTS, openCombatMap, visual } from "./helpers";

// Shots for the C4 task doc (E2E_VISUAL=1): the Scene card with no map yet, and after a generation (keyword
// fallback: the e2e backend has no ANTHROPIC_API_KEY). Board counterparts: `node scripts/board-shots.mjs
// combat:gm-empty combat:gm-edit`.

test("C4 Scene card before and after a generation at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  await openCombatMap(page);
  const tools = page.getByRole("complementary", { name: "Map tools" });
  const scene = tools.getByRole("region", { name: "Scene" });
  const { shoot } = visual(page, "C4", D9_VIEWPORTS);

  await expect(scene.getByLabel("Describe the battlefield")).toBeVisible();
  await shoot(page.locator(".cm-root"), "gm-empty");
  await shoot(scene, "scene-empty");

  await scene
    .getByLabel("Describe the battlefield")
    .fill("A bandit camp in an autumn forest clearing: three tents around a campfire, logs to sit on, a stream on the east side and boulders for cover.");
  await scene.getByRole("button", { name: "✦ Generate map" }).click();
  await expect(page.getByTestId("combat-map-canvas")).toBeVisible();
  // The page (C0) leaves Edit once the first map exists; back to Edit, and regenerate so the message line shows.
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
  await scene.getByRole("button", { name: "✦ Regenerate map" }).click();
  await expect(scene.getByText(/^Drawn from keywords in your description\./)).toBeVisible();
  await shoot(page.locator(".cm-root"), "gm-edit");
  await shoot(scene, "scene-generated");
});
