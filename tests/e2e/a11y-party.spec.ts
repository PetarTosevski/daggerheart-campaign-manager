// D12 H21 (.omc/plans/d12-hardening.yaml): accessibility and tablet pass for the party (roster, creation wizard,
// sheet with level-up and dice), the Codex (lightbox open), the world map and the adversaries/encounter tracker.
// Bar (user answers Q6/Q7, 2026-10-21): zero serious or critical axe findings on every page and dialog, as the GM and
// as the player where the player can open it; at 768x1024 and 1024x768 no sideways scroll, the campaign menu and
// the page's main action visible, primary controls at least 44 px. Moderate and minor findings are attached as test
// annotations and listed in docs/tasks/TASK-D12-H21.md, not fixed. Screenshots: test-results/visual/D12-H21/.

import { expect as baseExpect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  expectFitsViewport,
  expectNoSeriousA11yViolations,
  expectTouchTargets,
  summarizeViolations,
  TABLET_VIEWPORTS,
  type A11yOptions,
} from "./a11y";
import { gmAndPlayer, type LiveTable } from "./live";

test.describe.configure({ timeout: 180_000 });
// The machine runs many tracers at once; live data can take longer than the default 5 s to arrive.
const expect = baseExpect.configure({ timeout: 15_000 });

const DICE_CANVAS = { exclude: '[data-testid="dice-3d"]', reason: "WebGL dice canvas: no DOM to check (its rolls are announced by the Last roll list)" };
const MAP_NAME = /^Map of/;

let table: LiveTable;
let codexEntry: { name: string; entryId: Id<"codexEntries"> };

/**
 * Scans the page (or `options.include`) and records serious or critical findings under `label` instead of stopping,
 * so one run lists every page's findings; `flush()` fails the test with the whole list. Moderate and minor
 * findings become annotations.
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

async function testPng(page: Page): Promise<Blob> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(320, 240);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#3a5f8f";
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = "#e8d9a8";
    ctx.fillRect(80, 60, 160, 120);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    let text = "";
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  return new Blob([Buffer.from(base64, "base64")], { type: "image/png" });
}

const sheetUrl = () => `/campaigns/${table.campaignId}/party/${table.characterId}`;
const route = (path = "") => `/campaigns/${table.campaignId}${path}`;

async function openSheet(page: Page) {
  await page.goto(sheetUrl());
  await expect(page.getByRole("heading", { level: 1, name: table.characterName })).toBeVisible();
}

async function openTab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
}

test.beforeAll(async ({ browser }) => {
  table = await gmAndPlayer(browser);
  // A Codex character the party knows, with one revealed image, so both roles can open the lightbox.
  const { client, campaignId } = table;
  const name = "Mira Thornwake";
  const { entryId } = await client.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.codex.update, { entryId, patch: { name, role: "Ferry captain", known: true } });
  const uploadUrl = await client.mutation(api.codex.imageUploadUrl, { entryId });
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/png" }, body: await testPng(table.gm) });
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  expect((await client.mutation(api.codex.attachImage, { entryId, storageId })).error).toBeNull();
  await client.mutation(api.codex.setImageShown, { entryId, storageId, shown: true });
  codexEntry = { name, entryId };
  // The GM calls for a level-up, so the sheet offers the level-up ribbon to both roles.
  await client.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: crypto.randomUUID() });
  // An encounter with one adversary, for the tracker.
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Den of the bear", pcs: 4, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.addAdversary, {
    campaignId,
    encounterId,
    source: { kind: "srd", adversaryId: "bear" },
    count: 1,
    summoned: false,
    idempotencyKey: crypto.randomUUID(),
  });
});

test.afterAll(async () => {
  await table?.close();
});

test("GM: party roster and every step of the creation wizard", async () => {
  const { gm } = table;
  const { scan, flush } = scanner();
  await gm.goto(route("/party"));
  await expect(gm.getByRole("article", { name: table.characterName })).toBeVisible();
  await scan(gm, "roster (GM)");

  await gm.goto(route("/party/new"));
  const next = () => gm.getByRole("button", { name: /^Next:/ }).click();
  await expect(gm.getByRole("heading", { level: 2, name: "Class & Subclass" })).toBeVisible();
  await scan(gm, "wizard 1 class (GM)");
  await gm.getByRole("radio", { name: /^Guardian/ }).check();
  await gm.getByRole("radio", { name: "Stalwart", exact: true }).check();
  await scan(gm, "wizard 1 class chosen (GM)");
  await next();
  await expect(gm.getByRole("heading", { level: 2, name: "Heritage" })).toBeFocused();
  await gm.getByRole("radio", { name: "Dwarf", exact: true }).check();
  await gm.getByRole("radio", { name: "Ridgeborne", exact: true }).check();
  await scan(gm, "wizard 2 heritage (GM)");
  await next();
  await gm.getByRole("button", { name: "Use suggested" }).click();
  await scan(gm, "wizard 3 traits (GM)");
  await next();
  await gm.getByLabel("Character name").fill("Brakka Stonefist");
  await scan(gm, "wizard 4 info (GM)");
  await next();
  await gm.getByRole("button", { name: "Use suggested loadout" }).click();
  await scan(gm, "wizard 5 equipment (GM)");
  await gm.getByRole("radio", { name: /Minor Health Potion/ }).check();
  await gm.getByRole("group", { name: "Class item" }).getByRole("radio").first().check();
  await next();
  await scan(gm, "wizard 6 background (GM)");
  await next();
  await gm.getByLabel("First Experience").fill("Bodyguard");
  await gm.getByRole("button", { name: "Soldier" }).click();
  await scan(gm, "wizard 7 experiences (GM)");
  await next();
  const cards = gm.getByRole("checkbox", { name: /^Choose / });
  await cards.nth(0).check();
  await cards.nth(1).check();
  await scan(gm, "wizard 8 domain cards (GM)");
  await next();
  await expect(gm.getByRole("heading", { level: 2, name: "Connections" })).toBeVisible();
  await scan(gm, "wizard 9 connections (GM)");
  flush();
});

test("GM: the sheet's three pages, the dice box and the level-up ribbon", async () => {
  const { gm } = table;
  const { scan, flush } = scanner();
  await openSheet(gm);
  await scan(gm, "sheet: Character Sheet (GM)", DICE_CANVAS);
  await openTab(gm, "Story & Advancement");
  await scan(gm, "sheet: Story & Advancement (GM)", DICE_CANVAS);
  await openTab(gm, "Domains");
  await scan(gm, "sheet: Domains (GM)", DICE_CANVAS);
  await openTab(gm, "Character Sheet");

  const box = gm.getByRole("region", { name: "Dice", exact: true });
  await box.getByLabel("Difficulty").fill("12");
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByTestId("last-roll")).toBeVisible();
  await scan(gm, "dice box after a roll (GM)", { include: '[aria-label="Dice"]', ...DICE_CANVAS });

  // The GM calls for the level-up on the roster; the sheet then offers it.
  await gm.goto(route("/party"));
  await expect(gm.getByRole("article", { name: table.characterName }).getByTestId("level-up-pending")).toBeVisible();
  await scan(gm, "roster with a level-up pending (GM)");
  await openSheet(gm);
  await gm.getByRole("button", { name: "Level up to 2" }).click();
  await expect(gm.getByRole("region", { name: "Level-up to 2" })).toBeVisible();
  await scan(gm, "level-up ribbon: Experiences (GM)", DICE_CANVAS);
  await gm.getByRole("region", { name: "Level-up to 2" }).getByRole("button", { name: "Next" }).click();
  await scan(gm, "level-up ribbon: tier boxes (GM)", DICE_CANVAS);
  flush();
});

test("player: roster, sheet pages, dice box and level-up ribbon", async () => {
  const { player } = table;
  const { scan, flush } = scanner();
  await player.goto(route("/party"));
  await expect(player.getByRole("article", { name: table.characterName })).toBeVisible();
  await scan(player, "roster (player)");
  await player.goto(route("/party/new"));
  await expect(player.getByTestId("wizard-blocked")).toBeVisible();
  await scan(player, "wizard blocked (player)");

  await openSheet(player);
  await scan(player, "sheet: Character Sheet (player)", DICE_CANVAS);
  await openTab(player, "Story & Advancement");
  await scan(player, "sheet: Story & Advancement (player)", DICE_CANVAS);
  await openTab(player, "Domains");
  await scan(player, "sheet: Domains (player)", DICE_CANVAS);
  await openTab(player, "Character Sheet");
  const box = player.getByRole("region", { name: "Dice", exact: true });
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByTestId("last-roll")).toBeVisible();
  await scan(player, "dice box after a roll (player)", { include: '[aria-label="Dice"]', ...DICE_CANVAS });
  await player.getByRole("button", { name: "Level up to 2" }).click();
  await expect(player.getByRole("region", { name: "Level-up to 2" })).toBeVisible();
  await scan(player, "level-up ribbon (player)", DICE_CANVAS);
  flush();
});

test("Codex as GM and player, with the image lightbox open", async () => {
  const { gm, player } = table;
  const { scan, flush } = scanner();
  for (const [page, role] of [[gm, "GM"], [player, "player"]] as const) {
    await page.goto(route("/codex"));
    await expect(page.getByRole("heading", { level: 1, name: "Characters & Locations" })).toBeVisible();
    await page.getByRole("complementary", { name: "Entries" }).getByRole("button", { name: new RegExp(codexEntry.name) }).click();
    const detail = page.getByRole("region", { name: "Entry detail" });
    const image = detail.getByRole("button", { name: new RegExp(`^Open image of ${codexEntry.name}`) });
    await expect(image).toBeVisible();
    await scan(page, `codex entry (${role})`);
    await image.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, `codex lightbox (${role})`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await gm.getByRole("button", { name: "👁 Player view" }).click();
  await scan(gm, "codex player-view preview (GM)");
  await gm.getByRole("button", { name: "← Back to GM view" }).click();
  flush();
});

test("World map as GM (marker selected, route panel, speeds dialog) and as player", async () => {
  const { gm, player } = table;
  const { scan, flush } = scanner();
  await gm.goto(route("/world"));
  const map = gm.getByRole("application", { name: MAP_NAME });
  await expect(map).toBeVisible();
  await scan(gm, "world (GM)");
  await gm.getByRole("complementary", { name: "Map tokens" }).getByRole("button", { name: "Village", exact: true }).click();
  await map.click({ position: { x: 160, y: 160 } });
  const editor = gm.getByRole("complementary", { name: "Selected token" });
  await editor.getByLabel("Name", { exact: true }).fill("Oakhollow");
  await editor.getByLabel("Name", { exact: true }).press("Enter");
  await expect(map.getByRole("button", { name: /^Oakhollow, Village/ })).toBeVisible();
  await scan(gm, "world with a marker selected (GM)");
  await gm.getByRole("button", { name: /Measure/ }).click();
  await expect(gm.getByRole("region", { name: "Measure and plan a route" })).toBeVisible();
  await scan(gm, "world route panel (GM)");
  await gm.getByRole("region", { name: "Measure and plan a route" }).getByRole("button", { name: "Done" }).click();
  await gm.getByRole("region", { name: "Travel speeds" }).getByRole("button", { name: "Edit speeds…" }).click();
  await expect(gm.getByRole("dialog", { name: "Travel speeds" })).toBeVisible();
  await scan(gm, "world travel speeds dialog (GM)");
  await gm.keyboard.press("Escape");

  await player.goto(route("/world"));
  await expect(player.getByRole("application", { name: MAP_NAME })).toBeVisible();
  await expect(player.getByRole("application", { name: MAP_NAME }).getByRole("button", { name: /^Oakhollow, Village/ })).toBeVisible();
  await scan(player, "world (player)");
  flush();
});

test("Adversaries as GM (catalogue, encounters with the tracker running, environment) and the player's refusal", async () => {
  const { gm, player } = table;
  const { scan, flush } = scanner();
  await gm.goto(route("/adversaries"));
  await expect(gm.getByRole("heading", { level: 1, name: "Adversaries" })).toBeVisible();
  await scan(gm, "adversaries catalogue (GM)");
  await gm.getByRole("tab", { name: "Encounters" }).click();
  const panel = gm.getByRole("tabpanel", { name: "Encounters" });
  await expect(panel.getByRole("button", { name: "▶ Start encounter" })).toBeVisible();
  await scan(gm, "encounter builder (GM)");
  await panel.getByRole("button", { name: "▶ Start encounter" }).click();
  await expect(panel.getByRole("region", { name: "Encounter tracker" }).getByRole("heading", { name: "Den of the bear" })).toBeVisible();
  await scan(gm, "encounter tracker running (GM)");
  await gm.getByRole("tab", { name: "Environment" }).click();
  await expect(gm.getByRole("tabpanel", { name: "Environment" })).toBeVisible();
  await scan(gm, "environment (GM)");

  await player.goto(route("/adversaries"));
  await expect(player.getByText("Only the GM can see adversaries and encounters.")).toBeVisible();
  await scan(player, "adversaries refusal (player)");
  flush();
});

type TabletRoute = {
  name: string;
  path: () => string;
  role: "gm" | "player";
  ready: (page: Page) => Promise<void>;
  /** The page's main action: visible without sideways scroll and at least 44 px. */
  primary: (page: Page) => ReturnType<Page["getByRole"]>;
  /** Other primary controls that must be at least 44 px. */
  controls?: (page: Page) => ReturnType<Page["getByRole"]>;
};

const TABLET_ROUTES: TabletRoute[] = [
  {
    name: "roster",
    path: () => route("/party"),
    role: "gm",
    ready: (p) => expect(p.getByRole("article", { name: table.characterName })).toBeVisible(),
    primary: (p) => p.getByRole("button", { name: "Party levels up" }),
  },
  {
    name: "wizard",
    path: () => route("/party/new"),
    role: "gm",
    ready: (p) => expect(p.getByRole("heading", { level: 2 }).first()).toBeVisible(),
    primary: (p) => p.getByRole("button", { name: /^(Next:|Create character)/ }),
  },
  {
    name: "sheet",
    path: sheetUrl,
    role: "player",
    ready: (p) => expect(p.getByRole("heading", { level: 1, name: table.characterName })).toBeVisible(),
    primary: (p) => p.getByRole("region", { name: "Dice", exact: true }).getByRole("button", { name: "Roll", exact: true }),
    controls: (p) => p.getByRole("tablist").first().getByRole("tab"),
  },
  {
    name: "codex",
    path: () => route("/codex"),
    role: "gm",
    ready: (p) => expect(p.getByRole("heading", { level: 1, name: "Characters & Locations" })).toBeVisible(),
    primary: (p) => p.getByRole("button", { name: "+ New character" }),
    controls: (p) => p.getByRole("complementary", { name: "Entries" }).getByRole("button"),
  },
  {
    name: "codex-player",
    path: () => route("/codex"),
    role: "player",
    ready: (p) => expect(p.getByRole("heading", { level: 1, name: "Characters & Locations" })).toBeVisible(),
    primary: (p) => p.getByRole("complementary", { name: "Entries" }).getByRole("button", { name: new RegExp(codexEntry.name) }),
  },
  {
    name: "world",
    path: () => route("/world"),
    role: "gm",
    ready: (p) => expect(p.getByRole("application", { name: MAP_NAME })).toBeVisible(),
    primary: (p) => p.getByRole("button", { name: /Measure/ }),
    controls: (p) => p.getByRole("button", { name: /^(Zoom in|Zoom out|Fit map|🗺 Terrain|👁 Player view)$/ }),
  },
  {
    name: "world-player",
    path: () => route("/world"),
    role: "player",
    ready: (p) => expect(p.getByRole("application", { name: MAP_NAME })).toBeVisible(),
    primary: (p) => p.getByRole("button", { name: /Measure/ }),
  },
  {
    name: "adversaries",
    path: () => route("/adversaries"),
    role: "gm",
    ready: (p) => expect(p.getByRole("heading", { level: 1, name: "Adversaries" })).toBeVisible(),
    primary: (p) => p.getByRole("tab", { name: "Encounters" }),
    controls: (p) => p.getByRole("tablist", { name: "Adversary views" }).getByRole("tab"),
  },
];

for (const viewport of TABLET_VIEWPORTS) {
  test(`tablet ${viewport.width}x${viewport.height}: no sideways scroll, menu and main action visible, 44 px targets`, async () => {
    const problems: string[] = [];
    for (const r of TABLET_ROUTES) {
      const page = r.role === "gm" ? table.gm : table.player;
      await page.setViewportSize(viewport);
      await page.goto(r.path());
      await r.ready(page);
      const check = async (what: string, fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch (error) {
          problems.push(`${r.name} (${r.role}) ${what}: ${(error as Error).message.split("\n").slice(0, 12).join("\n")}`);
        }
      };
      await check("fits", () => expectFitsViewport(page));
      await check("campaign menu", () => expect(page.getByRole("navigation", { name: "Campaign sections" })).toBeVisible({ timeout: 3_000 }));
      // Reached by scrolling down at most: never sideways.
      await check("main action in view", async () => {
        await r.primary(page).first().scrollIntoViewIfNeeded();
        await expect(r.primary(page).first()).toBeInViewport({ ratio: 0.95, timeout: 3_000 });
      });
      await check("44 px main action", () => expectTouchTargets(r.primary(page)));
      if (r.controls) await check("44 px controls", () => expectTouchTargets(r.controls!(page)));
      await page.screenshot({ path: `test-results/visual/D12-H21/${r.name}-${viewport.width}x${viewport.height}.png`, fullPage: true, animations: "disabled" });
    }
    expect(problems, problems.join("\n\n")).toEqual([]);
  });
}
