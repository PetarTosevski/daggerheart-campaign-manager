#!/usr/bin/env node
// Shoots named regions of a Claude Design board (opened from disk) at 1440x900 and 390x844 into
// test-results/visual/board/<region>-<width>.png, for side-by-side comparison with the app shots of
// tests/e2e/visual/<tracer>.spec.ts.
//
//   node scripts/board-shots.mjs                          # list the regions
//   node scripts/board-shots.mjs defence hope             # Party board regions (.omc/plans/sheet-redesign.yaml)
//   node scripts/board-shots.mjs adversaries:statblock    # Adversaries board regions (.omc/plans/d8.yaml)
//   node scripts/board-shots.mjs all                      # every Party region; adversaries:all for every Adversaries one
//   node scripts/board-shots.mjs combat:gm-play           # Combat Map board regions (.omc/plans/d9-combat-map.yaml)
//
// Party: the board seeds a "Test Bard" on its first load, so the script reloads once and then clicks "Open character
// sheet". Images stored as /_blob/... (portrait art, Hope coins, card art) do not load from disk, so those areas
// render blank; that is expected (reference/designs/CLAUDE.md). Adversaries: each region gets a fresh load; Acid
// Burrower is selected by default, `empty` searches for "zzzz". Adversaries shots are saved as adversaries-<region>-<width>.png.
// Combat: shot at 1440x900, 1024x768 and 390x844 (the D9 sizes) as combat-<region>-<width>.png. The board keeps its
// state in localStorage, so each viewport gets a fresh page that walks one fixed story and shoots the wanted regions
// on the way: empty board (gm-empty) → a party of two is seeded and a map drawn by the board's keyword fallback (no
// Claude from disk) → the maps card (map-list) and edit mode (gm-edit) → Play with the party placed (gm-play) →
// the player view as Liriel by day (player-day) and at night carrying a torch (player-night).
//   node scripts/board-shots.mjs sessions:all hub:all     # Sessions and dashboard regions (.omc/plans/d10-sessions.yaml)
// Sessions / hub: shot at the D10 sizes (1440x900, 1024x768, 390x844) as sessions-<region>-<width>.png and
// hub-<region>-<width>.png. Each region gets a fresh page whose localStorage holds one fixed story: a party of two
// (Liriel the Seraph with 2 Wither tokens, Brannoc the Bard with 1) and three sessions (1 played with a recap, 2 and 3
// planned, 2 dated; 3 has scenes, hooks, encounter roles, spotlight counts, a tally, log lines, recap, loot, threads and
// the milestone). `empty` has no sessions; `live` marks Session 3 live; the stages click their tab on Session 3 (the
// board selects the newest session).
//   node scripts/board-shots.mjs notes:all                # Notes regions (.omc/plans/d11-notes.yaml)
// Notes: shot at 1440x900 only (the board has no phone layout) as notes-<region>-1440.png, each region on a fresh page
// whose localStorage holds one story. `empty`: no journal, so the board writes the GM's default pages; `player`: a
// party of one (Liriel the Seraph) and 'Writing as' Liriel, so her default pages; `page`, `threads`, `search` and
// `tear`: the GM journal's 'Session 1' with an entry of every kind and task state, a star and an @mention of Mira (a
// Codex character), plus a second page with an open task and a Fear. `threads` presses Open threads, `search` types
// "ferry", `tear` clicks Tear out twice and shoots mid-rip (animations left running).

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOARD = pathToFileURL(join(ROOT, "reference/designs/project/Party.dc.html")).href;
const OUT = join(ROOT, "test-results/visual/board");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

const DIALOG = '[role="dialog"][aria-labelledby="sheet-title"]';
/** A parchment box by its heading text. */
const box = (heading) => (p) => p.locator(`${DIALOG} section`).filter({ has: p.locator(".sh-h", { hasText: new RegExp(`^\\W*${heading}$`) }) });

const CARDS = /^Domain Cards/;

/** Region name -> the page (or sub-tab) it is on and how to find it. */
const REGIONS = {
  "sheet-p1": { page: "Character Sheet", find: (p) => p.locator(DIALOG) },
  "sheet-p2": { page: "Story & Advancement", find: (p) => p.locator(DIALOG) },
  "sheet-p3": { page: "Domains", sub: CARDS, find: (p) => p.locator(DIALOG) },
  "sheet-p3-hero": { page: "Domains", sub: /Heritage|Subclass|Hero/i, find: (p) => p.locator(DIALOG) },
  header: { page: "Character Sheet", find: (p) => p.locator(`${DIALOG} > div`).filter({ has: p.getByRole("tablist", { name: "Sheet pages" }) }) },
  "level-circle": { page: "Character Sheet", find: (p) => p.locator(`${DIALOG} .lvl-wrap`) },
  portrait: { page: "Character Sheet", find: (p) => p.locator(`${DIALOG} .pt-frame`) },
  experiences: { page: "Character Sheet", find: box("Experiences") },
  identity: { page: "Character Sheet", find: (p) => p.locator(`${DIALOG} .sh-box`).filter({ has: p.locator(".sh-lbl", { hasText: /^Community$/ }) }) },
  traits: { page: "Character Sheet", find: (p) => p.locator(`${DIALOG} div`).filter({ has: p.locator(".trait-ring") }).filter({ hasNot: p.locator(".sh-box") }).last() },
  transformation: { page: "Character Sheet", find: box("Transformation") },
  defence: { page: "Character Sheet", find: box("Defence") },
  hope: { page: "Character Sheet", find: box("Hope") },
  dice: { page: "Character Sheet", find: (p) => p.locator(`${DIALOG} section[aria-label="Dice"]`) },
  "hp-stress": { page: "Character Sheet", find: box("Hit Points & Stress") },
  weapons: { page: "Character Sheet", find: box("Active Weapons") },
  armor: { page: "Character Sheet", find: box("Active Armor") },
  "class-features": { page: "Character Sheet", find: box("Class Features") },
  downtime: { page: "Character Sheet", find: box("Downtime") },
  wealth: { page: "Story & Advancement", find: box("Wealth") },
  inventory: { page: "Story & Advancement", find: box("Inventory") },
  description: { page: "Story & Advancement", find: box("Character Description") },
  background: { page: "Story & Advancement", find: box("Background Questions") },
  connections: { page: "Story & Advancement", find: box("Connections") },
  "level-up-head": { page: "Story & Advancement", find: (p) => p.locator(`${DIALOG} .adv-head`) },
  "level-up": { page: "Story & Advancement", find: (p) => p.locator(`${DIALOG} .adv-head + div`) },
  domains: { page: "Domains", sub: CARDS, find: (p) => p.locator(`${DIALOG} section.sh-box`).first() },
  loadout: { page: "Domains", sub: CARDS, find: (p) => p.locator(`${DIALOG} section.table-felt`) },
  "domain-deck": { page: "Domains", sub: CARDS, find: box("Domain Deck") },
  "hero-cards": { page: "Domains", sub: /Heritage|Subclass|Hero/i, find: (p) => p.locator(`${DIALOG} .hc-grid`) },
};

const ADVERSARIES_BOARD = pathToFileURL(join(ROOT, "reference/designs/project/Adversaries.dc.html")).href;
/** Adversaries board region -> how to find it, after an optional step on a freshly loaded board. */
const ADVERSARY_REGIONS = {
  page: { find: () => null },
  header: { find: (p) => p.locator(".ad-top") },
  filters: { find: (p) => p.locator(".ad-filters") },
  list: { find: (p) => p.locator(".ad-list") },
  statblock: { find: (p) => p.locator(".ad-detail") },
  empty: { prepare: (p) => p.locator(".ad-search").fill("zzzz"), find: (p) => p.locator(".ad-list") },
};

const COMBAT_BOARD = pathToFileURL(join(ROOT, "reference/designs/project/Combat.dc.html")).href;
const COMBAT_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
/** The board's localStorage keys for the default campaign (Witherwild). */
const COMBAT_KEYS = { data: "dh.witherwild.combat2", party: "dh.witherwild.party", view: "dh.witherwild.combatView", time: "dh.witherwild.time" };
const COMBAT_PARTY = [{ f: { name: "Liriel", instinct: "+1" } }, { f: { name: "Brannoc", instinct: "0" } }];
const COMBAT_SCENE = "A bandit camp in an autumn forest clearing: three tents around a campfire, logs to sit on, a stream on the east side and boulders for cover.";
/** Combat board region -> what to shoot (null = the whole page). Shot in this order, the story above. */
const COMBAT_REGIONS = {
  "gm-empty": { find: () => null },
  "map-list": { find: (p) => p.locator('section[aria-label="Maps"]') },
  "gm-edit": { find: () => null },
  "gm-play": { find: () => null },
  "player-day": { find: () => null },
  "player-night": { find: () => null },
};

/** Writes the board's localStorage (values as JSON) and reloads, waiting for the board to render. */
async function combatStorage(page, entries) {
  await page.evaluate((list) => {
    for (const [key, value] of list) window.localStorage.setItem(key, JSON.stringify(value));
  }, Object.entries(entries));
  await page.reload();
  await page.locator(".cm-main").waitFor({ timeout: 20000 });
}

/** Walks the board's story at one viewport and shoots the wanted regions. Returns the number of failed shots. */
async function shootCombat(browser, viewport, wantedRegions) {
  let failures = 0;
  const page = await browser.newPage({ viewport });
  const shoot = async (name) => {
    if (!wantedRegions.includes(name)) return;
    const path = join(OUT, `combat-${name}-${viewport.width}.png`);
    try {
      const target = COMBAT_REGIONS[name].find(page);
      if (target === null) await page.screenshot({ path, fullPage: true, animations: "disabled" });
      else {
        await target.first().waitFor({ timeout: 5000 });
        await target.first().screenshot({ path, animations: "disabled" });
      }
      console.log(path);
    } catch (error) {
      failures += 1;
      console.error(`combat:${name} @ ${viewport.width}: not found (${error.message.split("\n")[0]})`);
    }
  };
  try {
    await page.goto(COMBAT_BOARD);
    await page.locator(".cm-main").waitFor({ timeout: 20000 });
    await shoot("gm-empty");
    await combatStorage(page, { [COMBAT_KEYS.party]: COMBAT_PARTY, [COMBAT_KEYS.time]: { day: 3, night: false } });
    await page.locator("textarea.cm-ta").fill(COMBAT_SCENE);
    await page.getByRole("button", { name: /Generate map/ }).click();
    await page.getByRole("button", { name: /Regenerate map/ }).waitFor({ timeout: 20000 });
    await shoot("map-list");
    await shoot("gm-edit");
    await page.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Play/ }).click();
    await page.getByRole("button", { name: /Party \(/ }).click();
    await page.locator(".cm-tok").first().waitFor({ timeout: 5000 });
    await shoot("gm-play");
    await combatStorage(page, { [COMBAT_KEYS.view]: { mode: "player", pc: "Liriel" } });
    await shoot("player-day");
    // Night, with Liriel carrying a torch (the board stores the carried light on the token).
    const data = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "null"), COMBAT_KEYS.data);
    for (const map of data?.maps ?? []) for (const token of map.tokens ?? []) if (token.pc === "Liriel") token.light = "torch";
    await combatStorage(page, { [COMBAT_KEYS.data]: data, [COMBAT_KEYS.time]: { day: 3, night: true } });
    await shoot("player-night");
  } catch (error) {
    failures += 1;
    console.error(`combat @ ${viewport.width}: the board story stopped (${error.message.split("\n")[0]})`);
  } finally {
    await page.close();
  }
  return failures;
}

const SESSIONS_BOARD = pathToFileURL(join(ROOT, "reference/designs/project/Sessions.dc.html")).href;
const HUB_BOARD = pathToFileURL(join(ROOT, "reference/designs/project/CampaignHub.dc.html")).href;
const D10_VIEWPORTS = COMBAT_VIEWPORTS;
/** The boards' localStorage keys for the default campaign (Witherwild). */
const D10_KEYS = { sessions: "dh.witherwild.sessions", party: "dh.witherwild.party", live: "dh.witherwild.live" };
const D10_PARTY = [
  { cls: 5, clsName: "Seraph", hpMax: 6, hp: 1, stressMax: 6, stress: 2, hope: 2, wither: 2, f: { name: "Liriel", strength: "+1" } },
  { cls: 0, clsName: "Bard", hpMax: 5, hp: 0, stressMax: 6, stress: 1, hope: 3, wither: 1, f: { name: "Brannoc" } },
];
const D10_SESSIONS = [
  { id: "s1", n: 1, title: "The Bridge at Dawn", date: "2026-10-03", played: true, scenes: [], hooks: "", pcs: 2, roles: {}, adj: [], spot: {}, tally: { fearGain: 4, fearSpent: 3, short: 1 }, log: [], recap: "The party crossed the river at dawn and met the ferryman, who warned them about the wither spreading through the Grove.", loot: "", threads: "", levelUp: false },
  { id: "s2", n: 2, title: "Into the Grove", date: "2026-10-24", played: false, scenes: [], hooks: "", pcs: 2, roles: {}, adj: [], spot: {}, tally: {}, log: [], recap: "", loot: "", threads: "", levelUp: false },
  {
    id: "s3",
    n: 3,
    title: "",
    date: "",
    played: false,
    scenes: [
      { type: "Combat", text: "Bandits at the ford" },
      { type: "Social", text: "Bargain with the ferryman" },
    ],
    hooks: "The ferryman knows who poisoned the well.",
    pcs: 2,
    roles: { bruiser: 1, standard: 1 },
    adj: ["hard"],
    spot: { Liriel: 2, Brannoc: 1 },
    tally: { fearGain: 2, fearSpent: 1, short: 1, long: 0 },
    log: [
      { time: "19:02", text: "Session started." },
      { time: "19:40", text: "Brannoc talked the bandits down." },
    ],
    recap: "The party reached the Grove.",
    loot: "A silver locket, a handful of gold.",
    threads: "The Doom countdown ticked to 3.",
    levelUp: true,
  },
];
/** Sessions / hub region -> board, story and what to shoot (null = the whole page). */
const SESSION_REGIONS = {
  empty: { board: SESSIONS_BOARD, story: {}, find: () => null },
  list: { board: SESSIONS_BOARD, find: (p) => p.locator('aside[aria-label="Session list"]') },
  prep: { board: SESSIONS_BOARD, tab: "Prep", find: (p) => p.locator('section[aria-label="Session detail"]') },
  play: { board: SESSIONS_BOARD, tab: "Play", find: (p) => p.locator('section[aria-label="Session detail"]') },
  wrap: { board: SESSIONS_BOARD, tab: "Wrap-up", find: (p) => p.locator('section[aria-label="Session detail"]') },
  live: { board: SESSIONS_BOARD, live: true, tab: "Play", find: () => null },
};
const HUB_REGIONS = {
  "last-session": { board: HUB_BOARD, find: (p) => p.locator('section[aria-labelledby="log-h"]') },
  "wither-panel": { board: HUB_BOARD, find: (p) => p.locator('section[aria-labelledby="wither-h"]') },
};

const NOTES_BOARD = pathToFileURL(join(ROOT, "reference/designs/project/Notes.dc.html")).href;
const NOTES_VIEWPORTS = [{ width: 1440, height: 900 }];
const NOTES_ENTRIES = [
  { id: "e1", k: "event", text: "Crossed the river at dawn with @Mira", s: "open" },
  { id: "e2", k: "task", text: "Ask the ferryman about the well", s: "open", star: true },
  { id: "e3", k: "task", text: "Pay the toll", s: "done" },
  { id: "e4", k: "task", text: "Map the ford", s: "migrated" },
  { id: "e5", k: "task", text: "Visit the shrine", s: "scheduled" },
  { id: "e6", k: "task", text: "Chase the goat", s: "struck" },
  { id: "e7", k: "note", text: "The ferryman owes Mira a favour", s: "open" },
  { id: "e8", k: "idea", text: "A rival crew on the river?", s: "open" },
  { id: "e9", k: "hope", text: "The grove spirits are friendly", s: "open" },
  { id: "e10", k: "fear", text: "Wither spreading through the Grove", s: "open" },
  { id: "e11", k: "fear", text: "Bandits at the ford", s: "done" },
];
const NOTES_STORY = {
  "dh.witherwild.codex": { chars: [{ id: "c1", name: "Mira", role: "Ferry captain", known: true }], locs: [] },
  "dh.witherwild.journal": {
    pages: [
      { id: "p1", kind: "log", title: "Session 1", tape: 0, created: 1790000000000, entries: NOTES_ENTRIES },
      { id: "p2", kind: "collection", title: "Rumors & hooks", tape: 1, created: 1790000000001, entries: [{ id: "r1", k: "task", text: "Find who poisoned the well", s: "open" }, { id: "r2", k: "fear", text: "The Doom countdown", s: "open" }] },
      { id: "p3", kind: "collection", title: "Loot & debts", tape: 2, created: 1790000000002, entries: [] },
      { id: "p4", kind: "future", title: "Future log", tape: 3, created: 1790000000003, entries: [] },
    ],
  },
};
const PAPER = (p) => p.locator('section[aria-label="Journal page"]');
/** Notes region -> story, what to do first and what to shoot (null = the whole page). */
const NOTES_REGIONS = {
  empty: { story: {}, find: () => null },
  page: { find: PAPER },
  threads: { prepare: (p) => p.getByRole("button", { name: /Open threads/ }).click(), find: PAPER },
  search: { prepare: (p) => p.getByRole("searchbox", { name: "Search the journal" }).fill("ferry"), find: (p) => p.locator("main") },
  player: {
    story: {
      "dh.witherwild.party": [{ cls: 5, clsName: "Seraph", hpMax: 6, hp: 0, stressMax: 6, stress: 0, hope: 2, f: { name: "Liriel" } }],
      "dh.witherwild.journalWho": "pc-liriel",
    },
    find: () => null,
  },
  tear: {
    prepare: async (p) => {
      const button = p.getByRole("button", { name: "Tear out page" });
      await button.click();
      await p.getByRole("button", { name: "Click again to tear out" }).click();
      await p.waitForTimeout(500);
    },
    find: PAPER,
    running: true,
  },
};

/** Shoots one Notes region at one viewport on a fresh page seeded with the region's story. */
async function shootNotes(browser, viewport, name, region) {
  const page = await browser.newPage({ viewport });
  const path = join(OUT, `notes-${name}-${viewport.width}.png`);
  try {
    await page.goto(NOTES_BOARD);
    await page.evaluate((list) => {
      window.localStorage.clear();
      for (const [key, value] of list) window.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    }, Object.entries(region.story ?? NOTES_STORY));
    await page.reload();
    await page.locator("main").first().waitFor({ timeout: 20000 });
    if (region.prepare) await region.prepare(page);
    const target = region.find(page);
    const animations = region.running ? "allow" : "disabled";
    if (target === null) await page.screenshot({ path, fullPage: true, animations });
    else {
      await target.first().waitFor({ timeout: 5000 });
      await target.first().screenshot({ path, animations });
    }
    console.log(path);
    return 0;
  } catch (error) {
    console.error(`notes:${name} @ ${viewport.width}: not found (${error.message.split("\n")[0]})`);
    return 1;
  } finally {
    await page.close();
  }
}

/** Shoots one sessions / hub region at one viewport on a fresh page seeded with the region's story. */
async function shootD10(browser, viewport, prefix, name, region) {
  const page = await browser.newPage({ viewport });
  const path = join(OUT, `${prefix}-${name}-${viewport.width}.png`);
  try {
    const story = region.story ?? {
      [D10_KEYS.party]: D10_PARTY,
      [D10_KEYS.sessions]: D10_SESSIONS,
      ...(region.live ? { [D10_KEYS.live]: { id: "s3", n: 3, at: Date.now() - 40 * 60 * 1000 } } : {}),
    };
    await page.goto(region.board);
    await page.evaluate((list) => {
      window.localStorage.clear();
      for (const [key, value] of list) window.localStorage.setItem(key, JSON.stringify(value));
    }, Object.entries(story));
    await page.reload();
    await page.locator("main").first().waitFor({ timeout: 20000 });
    if (region.tab) await page.getByRole("tab", { name: region.tab, exact: true }).click();
    // The board has no phone layout: below 640 px its detail column collapses to a sliver, so shoot the whole page.
    const target = viewport.width < 640 && region.tab ? null : region.find(page);
    if (target === null) await page.screenshot({ path, fullPage: true, animations: "disabled" });
    else {
      await target.first().waitFor({ timeout: 5000 });
      await target.first().screenshot({ path, animations: "disabled" });
    }
    console.log(path);
    return 0;
  } catch (error) {
    console.error(`${prefix}:${name} @ ${viewport.width}: not found (${error.message.split("\n")[0]})`);
    return 1;
  } finally {
    await page.close();
  }
}

const wanted = process.argv.slice(2);
if (wanted.length === 0) {
  console.log(
    `Party regions: ${Object.keys(REGIONS).join(", ")}\n` +
      `Adversaries regions: ${Object.keys(ADVERSARY_REGIONS).map((r) => `adversaries:${r}`).join(", ")}\n` +
      `Combat regions: ${Object.keys(COMBAT_REGIONS).map((r) => `combat:${r}`).join(", ")}\n` +
      `Sessions regions: ${Object.keys(SESSION_REGIONS).map((r) => `sessions:${r}`).join(", ")}\n` +
      `Dashboard regions: ${Object.keys(HUB_REGIONS).map((r) => `hub:${r}`).join(", ")}\n` +
      `Notes regions: ${Object.keys(NOTES_REGIONS).map((r) => `notes:${r}`).join(", ")}\n` +
      "Usage: node scripts/board-shots.mjs <region...> | all | adversaries:all | combat:all | sessions:all | hub:all | notes:all",
  );
  process.exit(0);
}
const PREFIXES = ["adversaries:", "combat:", "sessions:", "hub:", "notes:"];
const prefixed = (prefix, regions) => {
  const list = wanted.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length));
  return list.includes("all") ? Object.keys(regions) : list;
};
const advNames = prefixed("adversaries:", ADVERSARY_REGIONS);
const combatNames = prefixed("combat:", COMBAT_REGIONS);
const sessionNames = prefixed("sessions:", SESSION_REGIONS);
const hubNames = prefixed("hub:", HUB_REGIONS);
const notesNames = prefixed("notes:", NOTES_REGIONS);
const partyWanted = wanted.filter((n) => !PREFIXES.some((p) => n.startsWith(p)));
const names = partyWanted.includes("all") ? Object.keys(REGIONS) : partyWanted;
const unknown = [
  ...names.filter((n) => !REGIONS[n]),
  ...advNames.filter((n) => !ADVERSARY_REGIONS[n]).map((n) => `adversaries:${n}`),
  ...combatNames.filter((n) => !COMBAT_REGIONS[n]).map((n) => `combat:${n}`),
  ...sessionNames.filter((n) => !SESSION_REGIONS[n]).map((n) => `sessions:${n}`),
  ...hubNames.filter((n) => !HUB_REGIONS[n]).map((n) => `hub:${n}`),
  ...notesNames.filter((n) => !NOTES_REGIONS[n]).map((n) => `notes:${n}`),
];
if (unknown.length) {
  console.error(`Unknown region(s): ${unknown.join(", ")}. Run without arguments for the list.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
try {
  for (const viewport of combatNames.length ? COMBAT_VIEWPORTS : []) failed += await shootCombat(browser, viewport, combatNames);
  for (const viewport of notesNames.length ? NOTES_VIEWPORTS : []) {
    for (const name of notesNames) failed += await shootNotes(browser, viewport, name, NOTES_REGIONS[name]);
  }
  for (const viewport of sessionNames.length || hubNames.length ? D10_VIEWPORTS : []) {
    for (const name of sessionNames) failed += await shootD10(browser, viewport, "sessions", name, SESSION_REGIONS[name]);
    for (const name of hubNames) failed += await shootD10(browser, viewport, "hub", name, HUB_REGIONS[name]);
  }
  for (const viewport of advNames.length ? VIEWPORTS : []) {
    const page = await browser.newPage({ viewport });
    for (const name of advNames) {
      const region = ADVERSARY_REGIONS[name];
      await page.goto(ADVERSARIES_BOARD);
      await page.locator(".ad-item").first().waitFor({ timeout: 20000 });
      if (region.prepare) await region.prepare(page);
      const path = join(OUT, `adversaries-${name}-${viewport.width}.png`);
      try {
        const target = region.find(page);
        if (target === null) {
          await page.screenshot({ path, fullPage: true, animations: "disabled" });
        } else {
          await target.first().waitFor({ timeout: 5000 });
          await target.first().screenshot({ path, animations: "disabled" });
        }
        console.log(path);
      } catch (error) {
        failed += 1;
        console.error(`adversaries:${name} @ ${viewport.width}: not found (${error.message.split("\n")[0]})`);
      }
    }
    await page.close();
  }
  for (const viewport of names.length ? VIEWPORTS : []) {
    const page = await browser.newPage({ viewport });
    await page.goto(BOARD);
    await page.waitForLoadState("networkidle");
    // First load seeds the Test Bard; the roster shows it after a reload.
    await page.reload();
    await page.getByRole("button", { name: "Open character sheet" }).first().click();
    await page.locator(DIALOG).waitFor();

    for (const name of names) {
      const region = REGIONS[name];
      await page.getByRole("tab", { name: region.page, exact: true }).click();
      if (region.sub) await page.getByRole("tab", { name: region.sub }).first().click();
      // The sheet is a fixed overlay with its own scroll: make the viewport as tall as the overlay content so the
      // whole region renders in one shot, then restore it.
      const height = await page.locator(DIALOG).evaluate((d) => d.parentElement.scrollHeight);
      await page.setViewportSize({ width: viewport.width, height: Math.min(Math.max(height + 60, viewport.height), 16000) });
      const target = region.find(page).first();
      try {
        await target.waitFor({ timeout: 5000 });
        const path = join(OUT, `${name}-${viewport.width}.png`);
        await target.screenshot({ path, animations: "disabled" });
        console.log(path);
      } catch (error) {
        failed += 1;
        console.error(`${name} @ ${viewport.width}: not found (${error.message.split("\n")[0]})`);
      }
      await page.setViewportSize(viewport);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
