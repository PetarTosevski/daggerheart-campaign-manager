#!/usr/bin/env node
// Shoots named regions of the Party board's character sheet (reference/designs/project/Party.dc.html, opened
// from disk) at 1440x900 and 390x844 into test-results/visual/board/<region>-<width>.png, for side-by-side
// comparison with the app shots of tests/e2e/visual/<tracer>.spec.ts (.omc/plans/sheet-redesign.yaml).
//
//   node scripts/board-shots.mjs                 # list the regions
//   node scripts/board-shots.mjs defence hope    # shoot those regions
//   node scripts/board-shots.mjs all             # shoot every region
//
// The board seeds a "Test Bard" on its first load, so the script reloads once and then clicks "Open character
// sheet". Images stored as /_blob/... (portrait art, Hope coins, card art) do not load from disk, so those areas
// render blank; that is expected (reference/designs/CLAUDE.md).

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

const wanted = process.argv.slice(2);
if (wanted.length === 0) {
  console.log(`Regions: ${Object.keys(REGIONS).join(", ")}\nUsage: node scripts/board-shots.mjs <region...> | all`);
  process.exit(0);
}
const names = wanted.includes("all") ? Object.keys(REGIONS) : wanted;
const unknown = names.filter((n) => !REGIONS[n]);
if (unknown.length) {
  console.error(`Unknown region(s): ${unknown.join(", ")}. Run without arguments for the list.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
try {
  for (const viewport of VIEWPORTS) {
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
