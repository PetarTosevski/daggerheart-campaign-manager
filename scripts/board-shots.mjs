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

const wanted = process.argv.slice(2);
if (wanted.length === 0) {
  console.log(
    `Party regions: ${Object.keys(REGIONS).join(", ")}\n` +
      `Adversaries regions: ${Object.keys(ADVERSARY_REGIONS).map((r) => `adversaries:${r}`).join(", ")}\n` +
      `Combat regions: ${Object.keys(COMBAT_REGIONS).map((r) => `combat:${r}`).join(", ")}\n` +
      "Usage: node scripts/board-shots.mjs <region...> | all | adversaries:all | combat:all",
  );
  process.exit(0);
}
const advWanted = wanted.filter((n) => n.startsWith("adversaries:")).map((n) => n.slice("adversaries:".length));
const combatWanted = wanted.filter((n) => n.startsWith("combat:")).map((n) => n.slice("combat:".length));
const partyWanted = wanted.filter((n) => !n.startsWith("adversaries:") && !n.startsWith("combat:"));
const names = partyWanted.includes("all") ? Object.keys(REGIONS) : partyWanted;
const advNames = advWanted.includes("all") ? Object.keys(ADVERSARY_REGIONS) : advWanted;
const combatNames = combatWanted.includes("all") ? Object.keys(COMBAT_REGIONS) : combatWanted;
const unknown = [
  ...names.filter((n) => !REGIONS[n]),
  ...advNames.filter((n) => !ADVERSARY_REGIONS[n]).map((n) => `adversaries:${n}`),
  ...combatNames.filter((n) => !COMBAT_REGIONS[n]).map((n) => `combat:${n}`),
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
