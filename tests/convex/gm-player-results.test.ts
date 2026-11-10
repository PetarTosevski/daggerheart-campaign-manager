/**
 * dcm-uemx (user 2026-11-09): the GM sees every player's result. A player's card use, weapon attack and feature use on the
 * map store the result panel the player saw on the use's public row (`resultPanel`); `combatHud.playerResults` (GM only)
 * lists the newest ones for the GM's HUD; `combatHud.resultDamage` adds severity and HP marked per hit, feature uses
 * included. The panel carries no adversary number (U1), never reaches another player (`feed.list` leaves it out), and the
 * GM's own uses, undone uses and rows before a feed clear are left out.
 *
 * Fixtures are injected (as in out-of-range-refuse.test.ts) so the tests don't depend on data switches: a card and a
 * feature with one attack each (1d4 physical against Difficulty 1; the Major threshold 1, so any hit is Major · 2 HP).
 */
import { describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CardEffect } from "../../src/lib/domain/card-effects/types";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, handingBack, key } from "./helpers";

const injected = vi.hoisted(() => ({ cards: new Map<string, unknown>(), features: new Map<string, unknown>() }));

vi.mock("../../src/lib/srd/card-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/card-effects/index")>();
  return { ...real, cardEffect: (id: string) => (injected.cards.get(id) as CardEffect | undefined) ?? real.cardEffect(id) };
});
vi.mock("../../src/lib/srd/feature-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/feature-effects/index")>();
  return { ...real, featureEffect: (id: string) => (injected.features.get(id) as FeatureEffect | undefined) ?? real.featureEffect(id) };
});

const n = (value: number) => ({ kind: "fixed" as const, value });
const ONE_ENEMY = { side: "enemy" as const, range: "far" as const, count: { kind: "one" as const } };
const STRIKE = [{ kind: "damage" as const, to: "targets" as const, when: ["hit" as const], roll: { kind: "dice" as const, dice: { count: n(1), sides: 4 as const } }, type: "physical" as const }];
const ABILITY = "deft-maneuvers";
const CARD: CardEffect = {
  cardId: ABILITY,
  uses: [{ id: "strike", name: "Strike", activation: { kind: "action" }, roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" }, attack: true }, targets: ONE_ENEMY, steps: STRIKE }],
};
const BITE_ID = "subclass:call-of-the-brave:battle-ritual";
const BITE: FeatureEffect = {
  featureId: BITE_ID,
  source: "subclass",
  owner: "call-of-the-brave",
  card: "foundation",
  uses: [{ id: "main", name: "Bite", activation: { kind: "action" }, roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" }, attack: true }, targets: ONE_ENEMY, steps: STRIKE }],
};
injected.cards.set(CARD.cardId, CARD);
injected.features.set(BITE.featureId, BITE);

/** Ash (characterA, a Call of the Brave warrior holding the card) at (5, 10) on a live map, an Ogre in Melee. */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ogre = await t.run(async (ctx) => {
    await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const instanceId = await ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Cave Ogre",
      order: 0,
      summoned: false,
      stats: { difficulty: 1, major: 1, severe: 1000, hpMax: 10, stressMax: 4 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x: 6, y: 10, face: Math.PI });
    return { instanceId, tokenId };
  });
  await t.run(async (ctx) => {
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    await saveSheet(ctx, w.characterA, { ...s, classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation", hope: 5, domainCards: { owned: [ABILITY], loadout: [ABILITY] } } as CharacterSheet);
  });
  const player = handingBack(w.as("player"), gm, campaignId);
  const card = (c: Client) => c.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId: ABILITY, spell: "strike", targetTokenIds: [ogre.tokenId], choices: [], idempotencyKey: key() });
  const feature = (c: Client) => c.mutation(api.combatFeatures.useFeature, { campaignId, characterId: w.characterA, mapId, featureId: BITE_ID, targetTokenIds: [ogre.tokenId], choices: [], idempotencyKey: key() } as never) as Promise<{ status: string; entryId: Id<"actionLog"> }>;
  const attack = (c: Client) =>
    c.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds: [ogre.tokenId], slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() });
  const results = () => gm.query(api.combatHud.playerResults, { campaignId });
  const damage = (entryId: Id<"actionLog">) => gm.query(api.combatHud.resultDamage, { campaignId, entryId });
  return { w, t, campaignId, gm, player, ogre, card, feature, attack, results, damage };
}

/** Every key anywhere in a value (to prove the stored panel carries no adversary number). */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  return [];
}
const ADVERSARY_NUMBERS = ["targetDamage", "severity", "hpMarked", "difficulty", "hp", "major", "severe", "stats"];

describe("dcm-uemx: the GM sees every player's result (combatHud.playerResults)", () => {
  allowWorldEmails();

  it("a card use: the GM gets the player's panel (title, actor, roll, Hit row by name) and its severity; players are FORBIDDEN", async () => {
    const a = await arena();
    const r = await a.card(a.player);
    if (r.status !== "resolved") throw new Error(r.status);
    const [row, ...rest] = await a.results();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ entryId: r.entryId, characterId: a.w.characterA, panel: { kind: "card", cardId: ABILITY, useId: "strike", success: true, targets: [{ tokenId: a.ogre.tokenId, name: "Cave Ogre", hit: true, defeated: false }] } });
    expect(row!.panel.roll).toEqual(r.roll);
    expect(row!.panel.damage).toEqual(r.damage);
    expect(keysOf(row!.panel).filter((k) => ADVERSARY_NUMBERS.includes(k))).toEqual([]);
    expect(await a.damage(r.entryId)).toEqual([{ tokenId: a.ogre.tokenId, severity: "major", hpMarked: 2 }]);
    expect(errorCode(await a.w.as("player").query(api.combatHud.playerResults, { campaignId: a.campaignId }).then(() => null, (e: unknown) => e))).toBe("FORBIDDEN");
    // Another player's feed never carries the panel.
    const feed = await a.w.as("player").query(api.feed.list, { campaignId: a.campaignId, paginationOpts: { numItems: 20, cursor: null } });
    expect(keysOf(feed.page)).not.toContain("resultPanel");
  });

  it("a weapon attack: the panel names the weapon and the target; an undone attack leaves the list", async () => {
    const a = await arena();
    const r = await a.attack(a.player);
    if (r.status !== "resolved") throw new Error(r.status);
    const [row] = await a.results();
    expect(row).toMatchObject({ entryId: r.entryId, panel: { kind: "attack", actorName: expect.any(String) as string, targets: [{ tokenId: a.ogre.tokenId, name: "Cave Ogre", hit: true }] } });
    expect(row!.panel.title.length).toBeGreaterThan(0);
    await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect(await a.results()).toEqual([]);
  });

  it("a feature use: the panel and, new here, its severity and HP on the GM row", async () => {
    const a = await arena();
    const r = await a.feature(a.player);
    if (r.status !== "resolved") throw new Error(r.status);
    const [row] = await a.results();
    expect(row).toMatchObject({ entryId: r.entryId, panel: { kind: "feature", title: "Battle Ritual", targets: [{ tokenId: a.ogre.tokenId, name: "Cave Ogre", hit: true }] } });
    expect(await a.damage(r.entryId)).toEqual([{ tokenId: a.ogre.tokenId, severity: "major", hpMarked: 2 }]);
    const rows = await a.t.run((ctx) => ctx.db.query("actionLog").collect());
    expect(rows.filter((x) => x.targetDamage !== undefined).map((x) => x.visibility)).toEqual(["gm"]);
    expect(rows.filter((x) => x.resultPanel !== undefined).map((x) => x.visibility)).toEqual(["public"]);
  });

  it("newest first; the GM's own use (acting for the PC) is not listed", async () => {
    const a = await arena();
    const first = await a.card(a.player);
    const second = await a.feature(a.player);
    const own = await a.card(a.gm);
    if (first.status !== "resolved" || own.status !== "resolved") throw new Error("not resolved");
    expect((await a.results()).map((x) => x.entryId)).toEqual([second.entryId, first.entryId]);
  });
});
