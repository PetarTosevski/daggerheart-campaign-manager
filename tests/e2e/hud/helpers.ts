// Combat HUD e2e helpers (plan combat-hud H0; docs/tasks/TASK-HUD-H0.md). Every HUD spec and visual shot turns the
// opt-in switch on through `enableHud` and seeds the boards' scene through `hudScene`: a live map, four PCs (the
// player's Moss, a Druid with Vicious Entangle (Far) in hand, and three GM-made allies), a running encounter with the
// Jagged Knife Lieutenant (Leader), two Bandits and the Sniper (Ranged), and one Bandit out of Moss's sight behind a
// wall. Classic specs never call these: with the switch off the page is unchanged.

import type { ConvexHttpClient } from "convex/browser";
import { expect, type Browser, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { HUD_STORAGE_KEY } from "../../../src/components/combat-map/hud/flag";
import { characterDraft } from "../../fixtures/characters";
import { gmAndPlayer, type LiveTable } from "../live";

/** Map size of `combatMaps.create({ size: "medium" })`. */
export const HUD_MAP_W = 30;
export const HUD_MAP_H = 20;

/** Turns the HUD switch on (or off) for this page's browser context; the next load of the Combat Map shows it. */
export async function enableHud(page: Page, enabled = true): Promise<void> {
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [HUD_STORAGE_KEY, enabled ? "1" : "0"] as const);
}

/** The Combat Map URL of a campaign. */
export function combatMapUrl(campaignId: Id<"campaigns">): string {
  return `/campaigns/${campaignId}/combat-map`;
}

type TokenId = Id<"combatTokens">;

export type HudScene = LiveTable & {
  url: string;
  mapId: Id<"combatMaps">;
  encounterId: Id<"encounters">;
  /** The party: Moss is the player's (characterId = LiveTable.characterId). */
  pcs: { name: string; characterId: Id<"characters">; tokenId: TokenId }[];
  /** The adversaries' tokens and their names on the map. */
  enemies: {
    lieutenant: { tokenId: TokenId; name: string };
    bandit: { tokenId: TokenId; name: string };
    /** Behind the wall: never in Moss's view. */
    hiddenBandit: { tokenId: TokenId; name: string };
    sniper: { tokenId: TokenId; name: string };
  };
  /** Moss's Far card in hand. */
  farCardId: string;
};

const ALLIES = [
  { name: "Brannoc", classId: "warrior" },
  { name: "Vex", classId: "rogue" },
  { name: "Oriel", classId: "seraph" },
] as const;

/** Where everyone stands (squares), as in the boards: the party west, facing east; the enemies east. */
const SPOTS = {
  Moss: { x: 5, y: 10 },
  Brannoc: { x: 8, y: 9 },
  Vex: { x: 7, y: 6 },
  Oriel: { x: 6, y: 13 },
  lieutenant: { x: 14, y: 10 },
  bandit: { x: 10, y: 12 },
  hiddenBandit: { x: 21, y: 5 },
  sniper: { x: 24, y: 14 },
} as const;

/** A wall of sight blockers at x = 18, y = 2..8: between Moss and the hidden Bandit only. */
const WALL = [2, 3, 4, 5, 6, 7, 8].map((y) => y * HUD_MAP_W + 18);

async function seedParty(client: ConvexHttpClient, campaignId: Id<"campaigns">) {
  for (const ally of ALLIES) {
    await client.mutation(api.characters.create, { campaignId, draft: characterDraft(ally.name, ally.classId), idempotencyKey: crypto.randomUUID() });
  }
}

async function seedEncounter(client: ConvexHttpClient, campaignId: Id<"campaigns">) {
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Forest camp", idempotencyKey: crypto.randomUUID() });
  const add = async (adversaryId: string, count: number) =>
    (
      await client.mutation(api.encounters.addAdversary, {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId },
        count,
        summoned: false,
        idempotencyKey: crypto.randomUUID(),
      })
    ).instanceIds;
  const [lieutenant] = await add("jagged-knife-lieutenant", 1);
  const [bandit, hiddenBandit] = await add("jagged-knife-bandit", 2);
  const [sniper] = await add("jagged-knife-sniper", 1);
  await client.mutation(api.encounters.start, { campaignId, encounterId });
  return { encounterId, instances: { lieutenant: lieutenant!, bandit: bandit!, hiddenBandit: hiddenBandit!, sniper: sniper! } };
}

/**
 * The GM and the player in two browsers (`gmAndPlayer`), both on the dashboard with the HUD switch on, and the boards'
 * scene seeded through the API on a live map. Call `close()` at the end of the test. Pass `hud: false` to seed the
 * same scene for a classic comparison. Pass `moss` to make Moss another class with other starting cards (a wizard with
 * Book of Tyfar's Mysterious Mist for a card that asks for a square).
 */
export async function hudScene(browser: Browser, { hud = true, moss }: { hud?: boolean; moss?: { classId: string; domainCards: string[] } } = {}): Promise<HudScene> {
  const druid = characterDraft("Moss", moss?.classId ?? "druid");
  const table = await gmAndPlayer(browser, {
    draft: {
      name: druid.name,
      classId: druid.classId,
      subclassId: druid.subclassId,
      primaryWeaponId: druid.primaryWeaponId,
      armorId: druid.armorId,
      domainCards: moss?.domainCards ?? ["vicious-entangle", "unleash-chaos"],
    },
  });
  const { client, campaignId } = table;
  await seedParty(client, campaignId);
  const { encounterId, instances } = await seedEncounter(client, campaignId);

  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Forest Camp", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: Object.values(instances), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: WALL, paint: "block" });

  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
  const place = async (tokenId: TokenId, spot: { x: number; y: number }) => {
    await client.mutation(api.combatTokens.move, { campaignId, tokenId, x: spot.x, y: spot.y });
    await client.mutation(api.combatTokens.turn, { campaignId, tokenId, angle: 0 });
  };

  const pcs: HudScene["pcs"] = [];
  for (const name of ["Moss", ...ALLIES.map((a) => a.name)] as const) {
    const token = tokens.find((t) => t.name === name && t.characterId);
    expect(token, `${name}'s token on the map`).toBeTruthy();
    await place(token!._id, SPOTS[name]);
    pcs.push({ name, characterId: token!.characterId!, tokenId: token!._id });
  }
  const enemy = async (key: keyof typeof instances) => {
    const token = tokens.find((t) => t.instanceId === instances[key]);
    expect(token, `the ${key}'s token on the map`).toBeTruthy();
    await place(token!._id, SPOTS[key]);
    return { tokenId: token!._id, name: token!.name };
  };
  const enemies = {
    lieutenant: await enemy("lieutenant"),
    bandit: await enemy("bandit"),
    hiddenBandit: await enemy("hiddenBandit"),
    sniper: await enemy("sniper"),
  };

  if (hud) {
    await enableHud(table.gm);
    await enableHud(table.player);
  }
  return { ...table, url: combatMapUrl(campaignId), mapId, encounterId, pcs, enemies, farCardId: "vicious-entangle" };
}
