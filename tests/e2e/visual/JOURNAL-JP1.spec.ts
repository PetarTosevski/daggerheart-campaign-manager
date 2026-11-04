import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { JOURNAL_SCENES, openJournal, seedJournal } from "../journal/helpers";
import { visual } from "./helpers";

// Journal JP1 visual spec (E2E_VISUAL=1): the Plan view at 1440x900 and 390x844 (design
// reference/designs/journal/journal_views.jpg, panel 1): the design's scenes (1-2 Done, 3 Combat Playing now with its
// encounter, 4 Next), the GM prep parchment and the Battle Points column; then a scene menu open and the GM prep in
// edit. Shots in test-results/visual/JOURNAL-JP1/.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

test("JP1 Plan view at 1440 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(240_000);
  const table = await seedJournal(browser);
  try {
    const { gm, client, campaignId, liveSessionId: sessionId, sceneIds } = table;
    for (const [i, scene] of JOURNAL_SCENES.entries()) {
      await client.mutation(api.sessionPrep.setScene, { campaignId, sessionId, sceneId: sceneIds[i]!, title: scene.title });
    }
    for (const [i, state] of (["done", "done", "playing"] as const).entries()) {
      await client.mutation(api.sessionPrep.setSceneState, { campaignId, sessionId, sceneId: sceneIds[i]!, state });
    }

    const plan = (page: Page) => page.getByRole("region", { name: "Planned scenes" });
    await openJournal(gm, table);
    await expect(plan(gm).getByText("Playing now")).toBeVisible();
    const shots = visual(gm, "JOURNAL-JP1", VIEWPORTS);
    await shots.shoot(gm.locator("body"), "gm-plan-page");
    await shots.shoot(gm.locator(".jr-cols"), "gm-plan");

    await plan(gm).getByRole("button", { name: "Scene 4 options" }).click();
    await gm.locator(".jr-cols").screenshot({ path: "test-results/visual/JOURNAL-JP1/scene-menu-1440.png", animations: "disabled" });
    await gm.keyboard.press("Escape");

    await plan(gm).getByRole("button", { name: "Edit GM prep" }).click();
    await plan(gm).locator(".jp-prep").screenshot({ path: "test-results/visual/JOURNAL-JP1/gm-prep-edit-1440.png", animations: "disabled" });
  } finally {
    await table.close();
  }
});
