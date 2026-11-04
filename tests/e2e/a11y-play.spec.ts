// D12 H22 (.omc/plans/d12-hardening.yaml): accessibility and tablet pass for the combat map (GM Play and Edit,
// Classic and Sprites, the vision panel with doors and lights, the token card, the player-view menu; the player's
// board), sprite packs, and the Journal (since JX1, which replaced the Sessions and Notes pages: Sessions with Plan,
// Log & recap, the end dialog and the recap; the player's live and played views; and the Notes sub-tab). Bar (user answers Q6/Q7, 2026-10-21): zero serious or critical axe findings on
// every page and dialog, as the GM and as the player where the player can open it; at 768x1024 and 1024x768 no
// sideways scroll, the campaign menu and the page's main action visible, primary controls at least 44 px. Moderate
// and minor findings are attached as test annotations and listed in docs/tasks/TASK-D12-H22.md, not fixed.
// Screenshots: test-results/visual/D12-H22/.
//
// Notes: N9's notes-a11y.spec.ts already scans every Notes view as the GM inside `.bj-root` and drives it by keyboard;
// this file adds only the whole Notes page as the GM, the player's rows and the tablet rows (analysis section 5).

import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import {
  expectFitsViewport,
  expectNoSeriousA11yViolations,
  expectTouchTargets,
  summarizeViolations,
  TABLET_VIEWPORTS,
  type A11yOptions,
} from "./a11y";
import { gmAndPlayer, type LiveTable } from "./live";

test.describe.configure({ timeout: 240_000 });
// The machine runs many tracers at once; live data can take longer than the default 5 s to arrive.
const expect = baseExpect.configure({ timeout: 15_000 });

const MAP_W = 30;
const SHOTS = "test-results/visual/D12-H22";

let table: LiveTable;

/**
 * Scans the page (or `options.include`) and records serious or critical findings under `label` instead of stopping,
 * so one run lists every page's findings; `flush()` fails the test with the whole list. Moderate and minor findings
 * become annotations.
 */
function scanner() {
  const failures: string[] = [];
  return {
    async scan(page: Page, label: string, options: A11yOptions = {}) {
      try {
        const minor = await expectNoSeriousA11yViolations(page, options);
        test.info().annotations.push(...summarizeViolations(minor).map((description) => ({ type: `axe (moderate/minor) ${label}`, description })));
      } catch (error) {
        failures.push(`${label}: ${(error as Error).message.split("\n").slice(0, 40).join("\n")}`);
      }
    },
    flush() {
      expect(failures, failures.join("\n\n")).toEqual([]);
    },
  };
}

/** Runs a seeding call again when the loaded local backend times out a Convex function (rolled back, so safe). */
async function seed<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= 4 || !String(error).includes("timed out")) throw error;
    }
  }
}

const route = (path = "") => `/campaigns/${table.campaignId}${path}`;
const uuid = () => crypto.randomUUID();

/** Opens the Combat Map in Play: the Combat HUD (plan combat-hud H8.1), titled with the live map's name. */
async function openCombat(page: Page) {
  await page.goto(route("/combat-map"));
  await expect(page.getByTestId("combat-hud")).toBeVisible();
  await expect(page.getByTestId("hud-title").getByRole("heading")).toHaveText("Old road");
  await expect(page.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas")).toBeVisible();
}

/** Opens the HUD's left drawer: "Map tools" (the GM's classic column) or "Your character" (the player's view card). */
async function openDrawer(page: Page, name: "Map tools" | "Your character") {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("complementary", { name })).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  table = await seed(() => gmAndPlayer(browser));
  const { client, campaignId, characterName } = table;
  // ---- The combat scene: 'Old road' (30 x 20, live: the first map) and 'Cellar'. Liriel (the player's PC) at (15, 10)
  // facing east, a Bandit in her view at (18, 10), a wall at x = 24 with a door at (24, 10), a wall torch at (20, 12).
  // Night (DAY 1 -> NIGHT 2, Moonrise) so the vision panel shows the lights and the carried-light picker.
  const { mapId } = await seed(() => client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: uuid() }));
  await seed(() => client.mutation(api.combatMaps.create, { campaignId, size: "small", name: "Cellar", idempotencyKey: uuid() }));
  await seed(() => client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: uuid() }));
  const liriel = (await seed(() => client.query(api.combatTokensReads.list, { campaignId, mapId }))).find((t) => t.name === characterName)!;
  const { tokenId: banditId } = await seed(() => client.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Bandit", hp: 3, side: "enemy", idempotencyKey: uuid() }));
  await seed(() => client.mutation(api.combatTokens.move, { campaignId, tokenId: liriel._id, x: 15, y: 10 }));
  await seed(() => client.mutation(api.combatTokens.turn, { campaignId, tokenId: liriel._id, angle: 0 }));
  await seed(() => client.mutation(api.combatTokens.move, { campaignId, tokenId: banditId, x: 18, y: 10 }));
  const wall = [5, 6, 7, 8, 9, 11, 12, 13, 14, 15].map((y) => y * MAP_W + 24);
  await seed(() => client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: wall, paint: "wall" }));
  const { objectId: doorId } = await seed(() => client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "door", x: 24.5, y: 10.5 }));
  await seed(() => client.mutation(api.combatMapEdit.updateObject, { campaignId, objectId: doorId, r: 1, rot: Math.PI / 2 }));
  await seed(() => client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "walltorch", x: 20.5, y: 12.5 }));
  for (let i = 0; i < 8; i++) await seed(() => client.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: uuid() }));
});

test.afterAll(async () => {
  await table?.close();
});

test("combat map, GM: Play and Edit, Classic and Sprites, vision and doors, token card, player-view menu", async () => {
  const { gm, characterName } = table;
  const { scan, flush } = scanner();
  await openCombat(gm);
  await openDrawer(gm, "Map tools");
  const tools = gm.getByRole("complementary", { name: "Map tools" });
  const board = gm.getByRole("region", { name: "Battle map" });
  await expect(tools.getByRole("region", { name: "Vision and fog" })).toBeVisible();
  await expect(tools.getByRole("button", { name: "Open door 1" })).toBeVisible();
  await scan(gm, "combat Play, Classic, vision and doors (GM)");

  // The selected token's card and the Reveal card.
  // By keyboard: the HUD's panels (the open drawer, the spotlight panel) may cover the token on screen.
  await board.getByRole("button", { name: /^Bandit, Enemy/ }).focus();
  await gm.keyboard.press("Enter");
  await expect(tools.getByRole("region", { name: "Light and reveal" })).toBeVisible();
  await scan(gm, "combat Play, token selected (GM)");

  // The fog brush on.
  const vision = tools.getByRole("region", { name: "Vision and fog" });
  await vision.getByRole("group", { name: "Fog brush" }).getByRole("button", { name: "Hide" }).click();
  await scan(gm, "combat Play, fog brush (GM)");
  await vision.getByRole("group", { name: "Fog brush" }).getByRole("button", { name: "Off" }).click();

  // The player-view menu open, then the GM previewing the PC's view (fog canvas on).
  await gm.getByRole("toolbar", { name: "Map controls" }).getByRole("button", { name: /Player view/ }).click(); // The dock (H9.0).
  const menu = gm.getByRole("menu", { name: "Open the player view as" });
  await expect(menu).toBeVisible();
  await scan(gm, "combat player-view menu open (GM)");
  // By keyboard: the GM's spotlight panel covers the menu on screen (dcm-bxp.99.32.42).
  await menu.getByRole("menuitemradio", { name: characterName }).press("Enter");
  await expect(gm.getByTestId("combat-fog")).toBeVisible();
  await scan(gm, "combat previewing the PC's view (GM)");
  await tools.getByRole("group", { name: "See the map as" }).getByRole("button", { name: "GM (everything)" }).click();

  // Sprites.
  const style = gm.getByRole("group", { name: "Map style" }).first();
  await style.getByRole("button", { name: "Sprites" }).click();
  await expect(board.getByTestId("combat-map-canvas")).toHaveAttribute("data-style", "sprites");
  await scan(gm, "combat Play, Sprites (GM)");

  // Edit: the Scene card, Edit by hand with a tool chosen, an object selected; in Sprites, then Classic.
  const mode = tools.getByRole("group", { name: "Map mode" });
  await mode.getByRole("button", { name: /Edit map/ }).click();
  const card = tools.getByRole("region", { name: "Edit by hand" });
  await expect(card).toBeVisible();
  await scan(gm, "combat Edit, Sprites (GM)");
  await style.getByRole("button", { name: "Classic" }).click();
  await expect(board.getByTestId("combat-map-canvas")).toHaveAttribute("data-style", "classic");
  await scan(gm, "combat Edit, Classic (GM)");
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Terrain/ }).click();
  await scan(gm, "combat Edit, Terrain tool (GM)");
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
  await scan(gm, "combat Edit, Objects tool (GM)");
  await mode.getByRole("button", { name: /Play/ }).click();
  flush();
});

test("combat map, player: the board, Your view with carried light, doors and lights, own token", async () => {
  const { player, characterName } = table;
  const { scan, flush } = scanner();
  await openCombat(player);
  await openDrawer(player, "Your character");
  const yourView = player.getByRole("region", { name: "Your view" });
  await expect(yourView.getByRole("group", { name: "Light you carry" })).toBeVisible();
  const board = player.getByRole("region", { name: "Battle map" });
  await expect(board.getByRole("button", { name: "Open door 1" })).toBeVisible();
  await scan(player, "combat board and Your view (player)");
  await yourView.getByRole("group", { name: "Light you carry" }).getByRole("button", { name: "Torch", exact: true }).click();
  await board.getByRole("button", { name: new RegExp(`^Open ${characterName}’s sheet \\(your character\\)`) }).click();
  await scan(player, "combat torch on, own token selected (player)");
  flush();
});

test("sprite packs (GM): empty, a pack, the player is sent back", async () => {
  const { gm, player, client, campaignId } = table;
  const { scan, flush } = scanner();
  await gm.goto(route("/combat-map/packs"));
  await expect(gm.getByRole("heading", { level: 1, name: "Sprite packs" })).toBeVisible();
  await expect(gm.getByRole("heading", { name: "Your packs" })).toBeVisible();
  await scan(gm, "sprite packs, empty (GM)");
  await seed(() => client.mutation(api.spritePacks.createPack, { campaignId, name: "Moss caves", idempotencyKey: uuid() }));
  await expect(gm.getByText("Moss caves").first()).toBeVisible();
  await scan(gm, "sprite packs, one pack (GM)");
  await player.goto(route("/combat-map/packs"));
  await expect(player).toHaveURL(route("/combat-map"));
  flush();
});

test("sessions in the Journal: no session, Plan, Log & recap live, the end dialog, the recap (GM); live and played (player)", async () => {
  // JX1: the old Sessions page redirects to the Journal, so this scans the Journal's Sessions sub-tab instead of the
  // Prep / Play / Wrap-up stages (the milestone confirm and the Play-stage encounter card are gone from the UI).
  const { gm, player, client, campaignId } = table;
  const { scan, flush } = scanner();
  const url = route("/journal");
  await gm.goto(url);
  await expect(gm.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await expect(gm.getByRole("heading", { name: "No sessions yet" })).toBeVisible();
  await scan(gm, "journal, no session (GM)");
  await player.goto(url);
  await expect(player.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await scan(player, "journal, nothing played (player)");

  // ---- Plan: Session 1 with two scenes, hooks and the session encounter (two Bandits).
  const { sessionId } = await seed(() => client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: uuid() }));
  await seed(() => client.mutation(api.sessionRecords.setTitle, { campaignId, sessionId, title: "The Ford at Dawn" }));
  await seed(() => client.mutation(api.sessionPrep.addScene, { campaignId, sessionId }));
  await seed(() => client.mutation(api.sessionPrep.addScene, { campaignId, sessionId, type: "social" }));
  await seed(() => client.mutation(api.sessionPrep.setHooks, { campaignId, sessionId, hooks: "The ferryman owes the bandits a toll." }));
  const { encounterId } = await seed(() => client.mutation(api.sessionPrep.createEncounter, { campaignId, sessionId, idempotencyKey: uuid() }));
  await seed(() =>
    client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "srd", adversaryId: "jagged-knife-bandit" }, count: 2, summoned: false, idempotencyKey: uuid() }),
  );
  await gm.goto(`${url}?s=${sessionId}&sv=plan`);
  await expect(gm.getByRole("list", { name: "Planned scenes" }).getByRole("listitem")).toHaveCount(2);
  await scan(gm, "journal Plan (GM)");

  // ---- Log & recap while the session is live: a log line in the session log.
  await seed(() => client.mutation(api.sessions.start, { campaignId, sessionId, idempotencyKey: uuid() }));
  await seed(() => client.mutation(api.sessionPlay.addLog, { campaignId, sessionId, text: "Liriel sang at the ford.", idempotencyKey: uuid() }));
  await gm.goto(`${url}?s=${sessionId}&sv=log`);
  const chip = gm.getByTestId("journal-live-chip");
  await expect(chip).toContainText("Session 1 · live");
  await expect(gm.getByRole("region", { name: "Session log" })).toContainText("Liriel sang at the ford.");
  await scan(gm, "journal Log & recap, live (GM)");
  await player.goto(`${url}?s=${sessionId}`);
  await expect(player.getByTestId("journal-live-chip")).toContainText("Session 1 · live");
  await scan(player, "journal while a session is live (player)");

  // ---- The end dialog from the live chip, then the recap.
  await chip.getByRole("button", { name: "End session" }).click();
  const endDialog = gm.getByRole("dialog", { name: "End the session?" });
  await expect(endDialog).toBeVisible();
  await scan(gm, "journal end dialog (GM)");
  await endDialog.getByRole("button", { name: "End session", exact: true }).click();
  await expect(endDialog).toBeHidden();
  await seed(() => client.mutation(api.sessionWrap.setRecap, { campaignId, sessionId, recap: "The party held the ford." }));
  await expect(gm.getByRole("region", { name: "Recap" })).toContainText("The party held the ford.");
  await scan(gm, "journal Log & recap, played, recap (GM)");

  // ---- The player's view of the played session.
  await player.goto(`${url}?s=${sessionId}`);
  await expect(player.getByRole("region", { name: "Recap" })).toContainText("The party held the ford.");
  await scan(player, "journal, a played session (player)");
  flush();
});

test("notes: the whole page (GM); page view, sharing dialog and a shared page (player)", async () => {
  const { gm, player, playerClient, client, campaignId } = table;
  const { scan, flush } = scanner();
  await seed(() => playerClient.mutation(api.notesEntries.add, { campaignId, page: { template: 0 }, kind: "event", text: "we crossed the river" }));
  const { pageId } = await seed(() => client.mutation(api.notesEntries.add, { campaignId, page: { template: 0 }, kind: "note", text: "the toll is two silver" }));
  await seed(() => client.mutation(api.notesSharing.setVisibility, { campaignId, page: pageId, visibility: "everyone" }));

  await gm.goto(route("/journal?tab=notes"));
  await expect(gm.getByRole("group", { name: "Writing as" }).getByRole("button", { name: "Game Master", pressed: true })).toBeVisible();
  await expect(gm.getByRole("region", { name: "Journal page" }).getByText("the toll is two silver")).toBeVisible();
  await scan(gm, "notes page view, whole page (GM)");

  await player.goto(route("/journal?tab=notes"));
  const paper = player.getByRole("region", { name: "Journal page" });
  await expect(paper.getByText("we crossed the river")).toBeVisible();
  await scan(player, "notes page view (player)");
  await paper.getByRole("button", { name: /^Sharing:/ }).click();
  const dialog = player.getByRole("dialog", { name: "Share this page" });
  await expect(dialog).toBeVisible();
  await scan(player, "notes sharing dialog (player)");
  await player.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const index = player.getByRole("complementary", { name: "Journal index" });
  const toggle = index.getByRole("button", { name: /^Pages/ });
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await index.getByRole("tablist", { name: "Shared pages" }).getByRole("tab", { name: "Shared by GM" }).click();
  await expect(index.getByRole("tabpanel")).toContainText("Session 1");
  await scan(player, "notes Shared by GM tab (player)");
  flush();
});

/** Scrolls `target` into view (vertical scrolling only) and checks it is visible and inside the viewport's width. */
async function expectInView(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x, "left edge on screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "right edge on screen").toBeLessThanOrEqual(width + 1);
}

for (const viewport of TABLET_VIEWPORTS) {
  const size = `${viewport.width}x${viewport.height}`;
  test(`tablet ${size}: combat map (GM and player), packs, sessions and notes`, async () => {
    const { gm, player } = table;
    await gm.setViewportSize(viewport);
    await player.setViewportSize(viewport);
    const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}-${size}.png`, fullPage: true });
    const nav = (page: Page) => page.getByRole("navigation", { name: "Campaign sections" });

    try {
      // ---- Combat map, GM: the tool rail (maps, mode switch, cards) stays usable beside the board.
      await openCombat(gm);
      await expectFitsViewport(gm);
      await expect(nav(gm)).toBeVisible();
      await openDrawer(gm, "Map tools");
      const tools = gm.getByRole("complementary", { name: "Map tools" });
      const mode = tools.getByRole("group", { name: "Map mode" });
      await expectInView(gm, mode);
      await expectTouchTargets(mode.getByRole("button"));
      await expectTouchTargets(tools.getByRole("list", { name: "Campaign maps" }).getByRole("button"));
      await expectTouchTargets(tools.getByRole("region", { name: "Combatants" }).getByRole("button"));
      await expectTouchTargets(tools.getByRole("region", { name: "Vision and fog" }).getByRole("button"));
      await expectTouchTargets(tools.getByRole("group", { name: "Map style" }).getByRole("button"));
      await expectTouchTargets(tools.getByRole("group", { name: "GM Fear" }).getByRole("button"));
      // The GM's dock (plan combat-hud H9.0): every button, Player view and the zoom included, is a 44 px target.
      const dock = gm.getByRole("toolbar", { name: "Map controls" });
      await expectInView(gm, dock.getByRole("button", { name: "Zoom in" }));
      await expectTouchTargets(dock.getByRole("button"));
      await shot(gm, "combat-gm-play");
      await mode.getByRole("button", { name: /Edit map/ }).click();
      const card = tools.getByRole("region", { name: "Edit by hand" });
      await expect(card).toBeVisible();
      await expectFitsViewport(gm);
      await expectTouchTargets(card.getByRole("group", { name: "Edit tool" }).getByRole("button"));
      await shot(gm, "combat-gm-edit");
      await mode.getByRole("button", { name: /Play/ }).click();

      // ---- Combat map, player.
      await openCombat(player);
      await expectFitsViewport(player);
      await expect(nav(player)).toBeVisible();
      await openDrawer(player, "Your character");
      const yourView = player.getByRole("region", { name: "Your view" });
      await expectInView(player, yourView);
      await expectTouchTargets(yourView.getByRole("button"));
      // The player's map controls in their title row (plan combat-hud H9.0: Measure, Names, zoom).
      const controls = player.getByRole("toolbar", { name: "Map controls" });
      await expectInView(player, controls.getByRole("button", { name: "Zoom in" }));
      await expectTouchTargets(controls.getByRole("button"));
      await shot(player, "combat-player");

      // ---- Sprite packs (GM).
      await gm.goto(route("/combat-map/packs"));
      await expect(gm.getByRole("heading", { level: 1, name: "Sprite packs" })).toBeVisible();
      await expectFitsViewport(gm);
      await expect(nav(gm)).toBeVisible();
      await shot(gm, "packs");

      // ---- Journal Sessions (JX1): the GM's list, the Plan / Log & recap toggle and the sub-tabs; the player's list.
      await gm.goto(route("/journal"));
      await expect(gm.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
      const list = gm.getByRole("complementary", { name: "All sessions" });
      await expect(list.getByRole("button").first()).toBeVisible();
      await list.getByRole("button").filter({ hasText: "The Ford at Dawn" }).click();
      await expect(gm.getByRole("tab", { name: "Plan" })).toBeVisible();
      await expectFitsViewport(gm);
      await expect(nav(gm)).toBeVisible();
      const planNext = gm.getByRole("button", { name: /^Plan session \d+$/ });
      await expectInView(gm, planNext);
      await expectTouchTargets(planNext);
      await expectTouchTargets(gm.getByRole("tab"));
      await expectTouchTargets(list.getByRole("list", { name: "Sessions" }).getByRole("button"));
      await shot(gm, "sessions-gm");
      await gm.getByRole("tab", { name: "Log & recap" }).click();
      await expectFitsViewport(gm);
      await shot(gm, "sessions-gm-play");
      await player.goto(route("/journal"));
      const playerList = player.getByRole("complementary", { name: "All sessions" });
      await expect(playerList.getByRole("button").first()).toBeVisible();
      await expectFitsViewport(player);
      await expect(nav(player)).toBeVisible();
      await expectTouchTargets(playerList.getByRole("list", { name: "Sessions" }).getByRole("button"));
      await shot(player, "sessions-player");

      // ---- Notes, GM and player.
      for (const [page, who] of [
        [gm, "gm"],
        [player, "player"],
      ] as const) {
        await page.goto(route("/journal?tab=notes"));
        const paper = page.getByRole("region", { name: "Journal page" });
        const entry = paper.getByRole("textbox", { name: "New entry" });
        await expect(entry).toBeVisible();
        await expectFitsViewport(page);
        await expect(nav(page)).toBeVisible();
        await expectInView(page, entry);
        await expectTouchTargets(paper.getByRole("button", { name: /^Sharing:/ }));
        await expectTouchTargets(paper.getByRole("button", { name: "Tear out page" }));
        await shot(page, `notes-${who}`);
      }
    } finally {
      await gm.setViewportSize({ width: 1280, height: 720 });
      await player.setViewportSize({ width: 1280, height: 720 });
    }
  });
}
