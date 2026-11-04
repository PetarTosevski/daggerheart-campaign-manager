import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { JOURNAL_SCENES, openJournal, seedJournal, type JournalTable } from "./journal/helpers";

// Journal JP1 (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JP1.md): the GM's Plan view on the design's
// campaign (tests/e2e/journal/helpers.ts; scene titles and states set here, as the design shows them: 1-2 Done,
// 3 Combat Playing now, 4 Next). Scenes are read, edited in place, added, played, marked done and removed; the GM
// prep parchment shows bullets and saves on blur. Axe and no sideways scroll at 1440x900 and 390x844.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

let table: JournalTable;

test.describe.configure({ mode: "serial" });

/** Sets the design's scene titles and states on session 6 (the seed has types and texts only). */
async function designScenes(t: JournalTable) {
  const { client, campaignId, liveSessionId: sessionId, sceneIds } = t;
  for (const [i, scene] of JOURNAL_SCENES.entries()) {
    await client.mutation(api.sessionPrep.setScene, { campaignId, sessionId, sceneId: sceneIds[i]!, title: scene.title });
  }
  await client.mutation(api.sessionPrep.setSceneState, { campaignId, sessionId, sceneId: sceneIds[0]!, state: "done" });
  await client.mutation(api.sessionPrep.setSceneState, { campaignId, sessionId, sceneId: sceneIds[1]!, state: "done" });
  await client.mutation(api.sessionPrep.setSceneState, { campaignId, sessionId, sceneId: sceneIds[2]!, state: "playing" });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  table = await seedJournal(browser);
  await designScenes(table);
});

test.afterAll(async () => {
  await table?.close();
});

/** Session 6's prep as the server holds it. */
const serverPrep = () => table.client.query(api.sessionPrep.get, { campaignId: table.campaignId, sessionId: table.liveSessionId });

const plan = (page: Page) => page.getByRole("region", { name: "Planned scenes" });
const scene = (page: Page, n: number) => plan(page).getByRole("listitem", { name: `Scene ${n}`, exact: true });

async function pick(page: Page, n: number, item: string) {
  await scene(page, n).getByRole("button", { name: `Scene ${n} options` }).click();
  await scene(page, n).getByRole("button", { name: item, exact: true }).click();
}

test("GM: the design's scenes, states and GM prep; axe at 1440 and 390", async () => {
  const { gm } = table;
  await gm.setViewportSize(VIEWPORTS[0]);
  await openJournal(gm, table);
  await expect(plan(gm).getByRole("listitem", { name: /^Scene \d+$/ })).toHaveCount(4);
  for (const [i, s] of JOURNAL_SCENES.entries()) {
    await expect(scene(gm, i + 1).getByRole("textbox", { name: `Scene ${i + 1} title` })).toHaveValue(s.title);
    await expect(scene(gm, i + 1).getByRole("textbox", { name: `Scene ${i + 1} description` })).toHaveValue(s.text);
  }
  await expect(scene(gm, 1).getByText("Exploration")).toBeVisible();
  await expect(scene(gm, 1).getByText("Done")).toBeVisible();
  await expect(scene(gm, 2).getByText("Done")).toBeVisible();
  await expect(scene(gm, 3).getByText("Combat", { exact: true })).toBeVisible();
  await expect(scene(gm, 3).getByText("Playing now")).toBeVisible();
  await expect(scene(gm, 4).getByText("Next")).toBeVisible();

  const prep = plan(gm).locator(".jp-prep");
  await expect(prep.getByText("GM prep")).toBeVisible();
  await expect(prep.getByRole("listitem")).toHaveText([
    "Tamsin’s axe is in the Lieutenant’s tent.",
    "If the Sniper escapes, it warns the chapel.",
    "Moss’s player wants a scene with the woodcutter’s grandson.",
  ]);

  for (const viewport of VIEWPORTS) {
    await gm.setViewportSize(viewport);
    await expect(plan(gm)).toBeVisible();
    await expectFitsViewport(gm);
    await expectNoSeriousA11yViolations(gm);
  }
  await gm.setViewportSize(VIEWPORTS[0]);
  // The open scene menu passes axe too.
  await scene(gm, 4).getByRole("button", { name: "Scene 4 options" }).click();
  await expectNoSeriousA11yViolations(gm);
  await gm.keyboard.press("Escape");
  await expect(scene(gm, 4).getByRole("button", { name: "Play this scene" })).toBeHidden();
});

test("GM: add a scene, edit it in place, play it, mark it done, remove it", async () => {
  const { gm } = table;
  await openJournal(gm, table);
  await plan(gm).getByRole("button", { name: "Add scene" }).click();
  const fifth = scene(gm, 5);
  await expect(fifth.getByRole("button", { name: "Scene 5 options" })).toBeVisible();

  await pick(gm, 5, "Social");
  await expect(fifth.getByText("Social", { exact: true })).toBeVisible();
  await fifth.getByRole("textbox", { name: "Scene 5 title" }).fill("The grandson’s errand");
  await fifth.getByRole("textbox", { name: "Scene 5 title" }).press("Enter");
  await fifth.getByRole("textbox", { name: "Scene 5 description" }).fill("He wants to see the chapel bell.");
  await fifth.getByRole("textbox", { name: "Scene 5 description" }).blur();

  // Playing scene 5 (Q7: the GM plays non-combat scenes) makes the Combat scene Done.
  await pick(gm, 5, "Play this scene");
  await expect(fifth.getByText("Playing now")).toBeVisible();
  await expect(scene(gm, 3).getByText("Done")).toBeVisible();
  await expect(scene(gm, 4).getByText("Next")).toBeHidden();

  // The rows update optimistically: wait for the server before reloading.
  await expect
    .poll(async () => (await serverPrep()).scenes.at(4))
    .toMatchObject({ title: "The grandson’s errand", text: "He wants to see the chapel bell.", state: "playing" });
  await gm.reload();
  await expect(scene(gm, 5).getByRole("textbox", { name: "Scene 5 title" })).toHaveValue("The grandson’s errand");
  await expect(scene(gm, 5).getByRole("textbox", { name: "Scene 5 description" })).toHaveValue("He wants to see the chapel bell.");
  await expect(scene(gm, 5).getByText("Playing now")).toBeVisible();

  await pick(gm, 5, "Mark done");
  await expect(scene(gm, 5).getByText("Done")).toBeVisible();
  // With nothing playing, Next is the first scene that is not done.
  await expect(scene(gm, 4).getByText("Next")).toBeVisible();

  await pick(gm, 5, "Remove scene");
  await expect(plan(gm).getByRole("listitem", { name: /^Scene \d+$/ })).toHaveCount(4);

  // A Combat scene plays from the Combat Map: no 'Play this scene' in its menu.
  await pick(gm, 3, "Back to planned");
  await scene(gm, 3).getByRole("button", { name: "Scene 3 options" }).click();
  await expect(scene(gm, 3).getByText("Plays when its encounter goes on the Combat Map.")).toBeVisible();
  await expect(scene(gm, 3).getByRole("button", { name: "Play this scene" })).toHaveCount(0);
  await gm.keyboard.press("Escape");
});

test("GM: the GM prep note edits on blur", async () => {
  const { gm } = table;
  await openJournal(gm, table);
  const prep = plan(gm).locator(".jp-prep");
  await prep.getByRole("button", { name: "Edit GM prep" }).click();
  const field = prep.getByRole("textbox", { name: "GM prep" });
  await expect(field).toBeFocused();
  await field.fill("- Tamsin’s axe is in the Lieutenant’s tent.\nThe chapel bell rings at dusk.");
  await field.blur();
  await expect(prep.getByRole("listitem")).toHaveText(["Tamsin’s axe is in the Lieutenant’s tent."]);
  await expect(prep.getByText("The chapel bell rings at dusk.")).toBeVisible();
  // The paper updates optimistically: wait for the server before reloading.
  await expect.poll(async () => (await serverPrep()).hooks).toContain("The chapel bell rings at dusk.");
  await gm.reload();
  await expect(plan(gm).locator(".jp-prep").getByText("The chapel bell rings at dusk.")).toBeVisible();
});
