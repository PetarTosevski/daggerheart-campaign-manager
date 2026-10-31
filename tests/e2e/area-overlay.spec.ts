import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd";
import { signInAsTestGm } from "./fixtures";
import { convexAs, openCombatMap } from "./visual/helpers";

// Plan lanes-2 wave 9, tracer AO (docs/tasks/TASK-LN3-AO.md; dcm-lqnt, dcm-u2wx client), in two browsers:
// - The GM's Areas tools draw a Dark Cloud by hand (Close by default; user answer 2026-10-31, dcm-bxp.99.19.39), the
//   overlay draws it with the `darkness` fill, the GM resizes and moves it, draws a Wall of Flame (the `fire-wall`
//   strip) and removes both. The player sees the live map's areas.
// - A Nightwalker's Dark Cloud (CB p.42: "a temporary dark cloud that covers any area within Close range") is used from
//   the sheet drawer: the player picks the square on the map and the use goes out with `point`.

const PLAYER = "e2e-player@example.test";
const ASH = { x: 5, y: 10 };

type LevelChoice = { picks: { option: "traits" | "hp" | "stress" | "evasion" | "subclass"; tier: number; targets?: string[] }[]; experienceName?: string };

/** Levels 2-5 with the upgraded subclass (the specialization) at level 5 (CB p.42 Nightwalker). */
const TO_SPECIALIZATION: LevelChoice[] = [
  { picks: [{ option: "traits", tier: 2, targets: ["agility", "finesse"] }, { option: "hp", tier: 2 }], experienceName: "Night Runs" },
  { picks: [{ option: "stress", tier: 2 }, { option: "evasion", tier: 2 }] },
  { picks: [{ option: "traits", tier: 2, targets: ["strength", "instinct"] }, { option: "hp", tier: 2 }] },
  { picks: [{ option: "subclass", tier: 3 }, { option: "hp", tier: 3 }], experienceName: "Shadow Steps" },
];

function rogueDraft(name: string) {
  const cls = getClass("rogue")!;
  return {
    classId: "rogue",
    subclassId: "nightwalker",
    ancestry: { kind: "single", id: "elf" },
    communityId: "loreborne",
    traits: { agility: 1, strength: 0, finesse: 2, instinct: 1, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: "rapier",
    armorId: "gambeson-armor",
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
    connections: [],
  };
}

async function levelRogue(gm: ConvexHttpClient, characterId: Id<"characters">) {
  const cards = cardsForDomains(getClass("rogue")!.domains, TO_SPECIALIZATION.length + 1);
  const owned = new Set((await gm.query(api.characters.get, { characterId }))!.sheet.domainCards.owned);
  for (const [i, level] of TO_SPECIALIZATION.entries()) {
    const card = cards.find((c) => c.level <= i + 2 && !owned.has(c.id))!;
    owned.add(card.id);
    await gm.mutation(api.levelUp.apply, { characterId, choice: { ...level, cardId: card.id }, idempotencyKey: crypto.randomUUID() });
  }
}

/** Screen pixels per map square at the current zoom (48 px squares × the zoom shown in the toolbar). */
async function squarePx(page: Page): Promise<number> {
  const text = (await page.getByTestId("combat-zoom").textContent()) ?? "100%";
  return 48 * (Number.parseInt(text, 10) / 100);
}

/** Clicks the square `dx`, `dy` squares from Ash's (Ash's token is one square, so its centre is its square's). */
async function clickFromAsh(page: Page, board: Locator, dx: number, dy: number) {
  const token = board.getByRole("button", { name: /^Ash, / });
  // Centred in the window, so squares a few rows away are on screen too.
  await token.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
  const box = (await token.boundingBox())!;
  const step = await squarePx(page);
  const px = box.x + box.width / 2 + dx * step;
  const py = box.y + box.height / 2 + dy * step;
  await page.mouse.click(px, py);
}

test("the GM draws, resizes, moves and removes areas; a Nightwalker picks the square of Dark Cloud; the player sees the live map's areas", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { client: gm, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const player = await context.newPage();
  try {
    const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    const { characterId } = await playerClient.mutation(api.characters.create, { campaignId, draft: rogueDraft("Ash"), idempotencyKey: crypto.randomUUID() });
    await levelRogue(gm, characterId);
    expect((await gm.query(api.characters.get, { characterId }))!.sheet).toMatchObject({ level: 5, subclassRank: "specialization" });

    // The first map is live.
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    const ash = (await gm.query(api.combatTokens.list, { campaignId, mapId })).find((t) => t.name === "Ash")!;
    await gm.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: ASH.x, y: ASH.y });
    const areas = () => gm.query(api.combatAreas.list, { campaignId, mapId });

    // ---- The GM draws a Dark Cloud by hand: Close by default, picked on the map.
    await page.goto(url);
    const board = page.getByRole("region", { name: "Battle map" });
    await expect(board.getByRole("button", { name: /^Ash, / })).toBeVisible({ timeout: 30_000 });
    await board.getByRole("button", { name: "Areas" }).click();
    // The whole map in view, so every square the spec clicks is on screen.
    await board.getByRole("button", { name: "Fit" }).click();
    const tools = page.getByTestId("area-tools");
    await expect(tools).toContainText("No live area on this map.");
    await expect(tools.getByLabel("Name")).toHaveValue("Dark Cloud");
    await expect(tools.getByLabel("Radius", { exact: true })).toHaveValue("close");
    await tools.getByRole("button", { name: "Pick on the map" }).click();
    await expect(page.getByTestId("area-pick-banner")).toContainText("Pick the centre of Dark Cloud: click a square on the map.");
    await clickFromAsh(page, board, 3, 0);
    await expect(page.getByTestId("area-pick-result")).toHaveText(/Dark Cloud drawn\./);
    await expect.poll(areas).toMatchObject([{ label: "Dark Cloud", shape: "circle", radius: "close", blocksSight: true, centre: { kind: "square", x: ASH.x + 3, y: ASH.y } }]);
    await expect(board.locator('[data-testid="map-area"][data-label="Dark Cloud"]')).toHaveAttribute("data-kind", "darkness");
    await expect(board.locator('[data-testid="map-area"][data-label="Dark Cloud"]')).toHaveAttribute("data-mode", "tile");

    // The player sees it on the live map.
    await player.goto(url);
    const playerBoard = player.getByRole("region", { name: "Battle map" });
    await expect(playerBoard.getByRole("button", { name: /^Ash, / })).toBeVisible({ timeout: 30_000 });
    await expect(playerBoard.locator('[data-testid="map-area"][data-label="Dark Cloud"]')).toHaveAttribute("data-kind", "darkness");
    await expect(player.getByRole("button", { name: "Areas" })).toHaveCount(0);

    // ---- Resize and move it.
    const row = tools.getByTestId("area-row").filter({ hasText: "Dark Cloud" });
    await row.getByLabel("Radius of Dark Cloud").selectOption("far");
    await expect.poll(async () => (await areas())[0]?.radius).toBe("far");
    await row.getByRole("button", { name: "Move Dark Cloud", exact: true }).click();
    await expect(page.getByTestId("area-pick-banner")).toContainText("Pick the new centre of Dark Cloud");
    await clickFromAsh(page, board, 4, 2);
    await expect(page.getByTestId("area-pick-result")).toHaveText(/Dark Cloud moved\./);
    await expect.poll(async () => (await areas())[0]?.centre).toEqual({ kind: "square", x: ASH.x + 4, y: ASH.y + 2 });

    // ---- A Wall of Flame between two squares: the fire-wall strip along the line.
    await tools.getByLabel("Name").fill("Wall of Flame");
    await tools.getByLabel("Shape").selectOption("wall");
    await tools.getByRole("button", { name: "Pick on the map" }).click();
    await expect(page.getByTestId("area-pick-banner")).toContainText("Pick the first end of Wall of Flame");
    await clickFromAsh(page, board, 2, -3);
    await expect(page.getByTestId("area-pick-banner")).toContainText("Pick the second end of Wall of Flame");
    await clickFromAsh(page, board, 6, -3);
    await expect(page.getByTestId("area-pick-result")).toHaveText(/Wall of Flame drawn\./);
    await expect.poll(async () => (await areas()).find((a) => a.label === "Wall of Flame")?.wall).toEqual({ a: [ASH.x + 2, ASH.y - 3], b: [ASH.x + 6, ASH.y - 3] });
    await expect(board.locator('[data-testid="map-area"][data-label="Wall of Flame"]')).toHaveAttribute("data-kind", "fire-wall");
    await expect(playerBoard.getByTestId("map-area")).toHaveCount(2);

    // ---- Remove both.
    await tools.getByRole("button", { name: "Remove Wall of Flame" }).click();
    await tools.getByRole("button", { name: "Remove Dark Cloud" }).click();
    await expect(tools).toContainText("No live area on this map.");
    await expect.poll(async () => (await areas()).length).toBe(0);
    await expect(playerBoard.getByTestId("map-area")).toHaveCount(0);

    // ---- The player's Dark Cloud: Use from the drawer, pick a square within Close, the use goes out with the point.
    // The Spellcast Roll (15) can fail; a failure places nothing, so try again (Dark Cloud has no use limit).
    let placed = false;
    for (let attempt = 0; attempt < 8 && !placed; attempt++) {
      await player.getByTestId("sheet-button-top").click();
      const drawer = player.getByRole("dialog", { name: "Character sheet" });
      await expect(drawer.getByTestId("sheet-drawer-name")).toHaveText("Ash");
      await drawer.getByRole("button", { name: "Use Dark Cloud" }).click();
      // The radius is the SRD entry's (Very Close until S2 switches it to Close, user answer 2026-10-31).
      await expect(drawer).toContainText(/Dark Cloud covers (Very Close|Close) range around a square you pick within Close range\./);
      await drawer.getByRole("button", { name: "Pick the square on the map" }).click();
      await expect(drawer).toBeHidden();
      await expect(player.getByTestId("area-pick-banner")).toContainText("Pick the centre of Dark Cloud within Close range");
      await expect(player.getByTestId("area-pick-layer")).toBeVisible();
      await clickFromAsh(player, playerBoard, 2, 0);
      const result = player.getByTestId("area-pick-result");
      await expect(result).toHaveText(/Rolled \d+: (Dark Cloud is on the map\.|Dark Cloud failed\.)/, { timeout: 30_000 });
      placed = /is on the map/.test((await result.textContent()) ?? "");
      await result.getByRole("button", { name: "Dismiss" }).click();
    }
    expect(placed).toBe(true);
    await expect.poll(areas).toMatchObject([{ label: "Dark Cloud", shape: "circle", blocksSight: true, centre: { kind: "square", x: ASH.x + 2, y: ASH.y }, characterId }]);
    await expect(playerBoard.locator('[data-testid="map-area"][data-label="Dark Cloud"]')).toHaveAttribute("data-kind", "darkness");
    await expect(board.locator('[data-testid="map-area"][data-label="Dark Cloud"]')).toBeVisible();

    // ---- The player sees only the live map's areas: the GM draws on a second map that is not live.
    const { mapId: other } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Cellar", idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.combatAreaEdits.draw, { campaignId, mapId: other, characterId, label: "Fog", shape: "circle", at: { x: 3, y: 3 } });
    expect(await gm.query(api.combatAreas.list, { campaignId, mapId: other })).toHaveLength(1);
    expect(await playerClient.query(api.combatAreas.list, { campaignId, mapId: other })).toHaveLength(0);
  } finally {
    await context.close();
  }
});
