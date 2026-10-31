/**
 * Plan lanes-2, tracer E1 (docs/tasks/TASK-LN2-E1.md): round 2 of the triggers / rolls / Hand lane. The SRD entries switch
 * to the vocabulary in wave 9, so these tests inject fixture entries named after the card or feature they stand in for.
 *
 * Book texts (printed pages):
 * - Backhanded Guidance (HF p.87): "add 1d6 to the result of their Fear Die" (dcm-jog); Ill Omen (HF p.95, dcm-3ou). User
 *   answer 2026-10-31: a bonus never makes a critical; a tie after the bonus is with Fear.
 * - Manipulate Magic (CB p.47): "Extend the spell or attack's reach by one range" (dcm-x7p, dcm-76l5).
 * - Elemental Incarnation, Water (CB p.30): "When you deal damage to an adversary within Melee range, all other
 *   adversaries within Very Close range must mark a Stress" (dcm-ssf, dcm-umti).
 * - Perfect Recall (CB p.50): "Once per rest, when you recall a domain card in your vault, you can reduce its Recall Cost
 *   by 1" (dcm-bxp.99.19.1, dcm-cfpv).
 * - Spectral Mist (HF p.181): ends when you make an action roll; Slumber (CB p.332): "Asleep until they take damage";
 *   Timejammer (CB p.334): "the next time you make an action roll that targets another creature" (dcm-wn7).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { addRange, dealDamageHolds, widenRange, withDieBonuses } from "../../convex/lib/combatActions";
import type { CardEffect } from "../../src/lib/domain/card-effects/types";
import type { RollRecord } from "../../src/lib/domain/duality";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import type { Weapon } from "../../src/lib/srd/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

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
const brave = { classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation" } as const;

/** Perfect Recall (CB p.50) as a held feature: once per rest, the recall costs 1 less (a rider: the player's pick). */
const PERFECT_RECALL: FeatureEffect = {
  featureId: "subclass:call-of-the-brave:battle-ritual",
  source: "subclass",
  owner: "call-of-the-brave",
  card: "foundation",
  uses: [{ id: "main", name: "Perfect Recall", activation: { kind: "rider", trigger: { kind: "whenYouRecall" } }, limit: { per: "rest" }, steps: [{ kind: "loadout", to: "self", op: "reduceRecallCost", amount: n(1) }] }],
};

/** Spectral Mist (HF p.181) as a card's lasting effect: it ends on the bearer's next action roll. */
const MIST: CardEffect = {
  cardId: "test-spectral-mist",
  uses: [{ id: "main", name: "Spectral Mist", activation: { kind: "action" }, steps: [{ kind: "effect", to: "self", label: "Mist", mods: [], duration: "scene", endsOn: ["actionRoll"] }] }],
};

/** Slumber (CB p.332): a modifier on an adversary that ends when it takes damage. */
const SLUMBER: CardEffect = {
  cardId: "test-slumber",
  uses: [{ id: "main", name: "Slumber", activation: { kind: "action" }, steps: [{ kind: "effect", to: "targets", label: "Asleep", mods: [], duration: "manual", endsOn: ["takeDamage"] }] }],
};

/** Timejammer (CB p.334): ends on its caster's action roll that targets another creature. */
const TIMEJAMMER: CardEffect = {
  cardId: "test-timejammer",
  uses: [{ id: "main", name: "Timejammer", activation: { kind: "action" }, steps: [{ kind: "effect", to: "targets", label: "Time Lock", mods: [], duration: "manual", endsOnRoll: { roll: "action", by: "caster", targetsCreature: true } }] }],
};

injected.features.set(PERFECT_RECALL.featureId, PERFECT_RECALL);
for (const c of [MIST, SLUMBER, TIMEJAMMER]) injected.cards.set(c.cardId, c);

function serverDice(...values: number[]) {
  vi.restoreAllMocks();
  const queue = [...values];
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    const next = queue.shift();
    if (next === undefined) return real(buf as never) as T;
    (buf as unknown as Uint32Array)[0] = next - 1;
    return buf;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- pure

const record = (hope: number, fear: number, outcome: RollRecord["outcome"], difficulty?: number): RollRecord => ({
  kind: "action",
  manual: false,
  dice: [{ sides: 12, value: hope, role: "hope" }, { sides: 12, value: fear, role: "fear" }],
  modifier: 0,
  total: hope + fear,
  outcome,
  ...(difficulty !== undefined ? { difficulty } : {}),
});

describe("E1 r2: duality die bonus (user answer 2026-10-31; dcm-jog, dcm-3ou)", () => {
  it("a bonus that ties the dice is with Fear, never a critical", () => {
    const after = withDieBonuses(record(8, 5, "successHope", 10), [{ die: "fear", amount: 3 }]);
    expect(after.total).toBe(16);
    expect(after.outcome).toBe("successFear");
  });
  it("a bonus lifting the Fear Die above the Hope Die turns the roll with Fear; a failure stays one", () => {
    expect(withDieBonuses(record(8, 5, "successHope", 10), [{ die: "fear", amount: 4 }]).outcome).toBe("successFear");
    expect(withDieBonuses(record(3, 2, "failHope", 30), [{ die: "fear", amount: 2 }]).outcome).toBe("failFear");
  });
  it("a roll that was a critical stays one; several bonuses add up", () => {
    expect(withDieBonuses(record(6, 6, "critical", 10), [{ die: "fear", amount: 3 }]).outcome).toBe("critical");
    expect(withDieBonuses(record(9, 4, "successHope", 10), [{ die: "fear", amount: 2 }, { die: "fear", amount: 4 }]).outcome).toBe("successFear");
    expect(withDieBonuses(record(9, 4, "successHope", 10), [])).toEqual(record(9, 4, "successHope", 10));
  });
});

describe("E1 r2: reach and trigger range (dcm-x7p, dcm-76l5, dcm-ssf)", () => {
  const bow = { range: "Far" } as unknown as Weapon;
  it("widens a range by steps, at most Very Far", () => {
    expect(widenRange("melee", 1)).toBe("veryClose");
    expect(widenRange("far", 3)).toBe("veryFar");
  });
  it("an added target on the host's range follows the weapon and the reach", () => {
    expect(addRange({ side: "enemy", count: { kind: "upTo", value: 1 }, range: "close", hostRange: true } as never, bow, 1)).toBe("veryFar");
    expect(addRange({ side: "enemy", count: { kind: "upTo", value: 1 }, range: "close" } as never, bow, 1)).toBe("close");
  });
  it("whenYouDealDamage within Melee holds only for a damaged creature that close", () => {
    const from = { x: 0, y: 0, size: 1 } as never;
    const near = { token: { x: 1, y: 0, size: 1 }, enemy: true, tags: [], conditions: [] } as never;
    const far = { token: { x: 6, y: 0, size: 1 }, enemy: true, tags: [], conditions: [] } as never;
    const trigger = { kind: "whenYouDealDamage", within: "melee" } as never;
    expect(dealDamageHolds(trigger, from, near)).toBe(true);
    expect(dealDamageHolds(trigger, from, far)).toBe(false);
    expect(dealDamageHolds(trigger, from, undefined)).toBe(false);
    expect(dealDamageHolds({ kind: "whenYouDealDamage" } as never, from, undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------- on the server

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, encounterId };
  });
  let order = 0;
  const enemy = (label: string, x: number, y: number, effects: { id: string; source: string; label: string; until: "temporary" }[] = []) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats: { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        effects,
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { instanceId, tokenId };
    });
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const edit = (patch: Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch });
    });
  const attack = (targetTokenIds: Id<"combatTokens">[]) =>
    player.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() });
  const manual = (values: number[], kind: "action" | "reaction" = "action") =>
    player.mutation(api.rolls.manualRoll, { characterId: w.characterA, values, roll: { kind, trait: "agility", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] }, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, instance, sheet, edit, attack, manual };
}

const MIST_EFFECT = { id: "card:test-spectral-mist:1", source: "Spectral Mist", text: "Mist", until: "manual" as const };

describe("E1 r2 on the server: effect ends from rolls (dcm-wn7)", () => {
  allowWorldEmails();

  it("a plain action roll ends the roller's effect that ends on it; a reaction roll does not", async () => {
    const a = await arena();
    await a.edit({ effects: [MIST_EFFECT] });
    await a.manual([5, 4], "reaction");
    expect((await a.sheet()).effects).toHaveLength(1);
    const r = await a.manual([5, 4]);
    expect((await a.sheet()).effects).toEqual([]);
    expect(r.entryId).toBeDefined();
  });

  it("a weapon attack ends a hit adversary's modifier that ends on damage, and the attacker's on its roll", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10, [{ id: "card:test-slumber:1", source: "Slumber", label: "Asleep", until: "temporary" }]);
    await a.edit({ effects: [MIST_EFFECT] });
    serverDice(9, 3);
    const r = await a.attack([bear.tokenId]);
    expect(r).toMatchObject({ status: "resolved", roll: { outcome: "successHope" } });
    expect((await a.instance(bear.instanceId)).effects ?? []).toEqual([]);
    expect((await a.sheet()).effects).toEqual([]);
    // The GM's undo puts the modifier back.
    if (r.status !== "resolved") return;
    await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await a.instance(bear.instanceId)).effects).toHaveLength(1);
    expect((await a.sheet()).effects).toHaveLength(1);
  });

  it("the attacker's action roll on a creature ends the Time Lock it put on another adversary (caster side)", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    const locked = await a.enemy("Locked", 15, 15, [{ id: `card:test-timejammer:1~${a.ash}`, source: "Timejammer", label: "Time Lock", until: "temporary" }]);
    const other = await a.enemy("Other", 16, 15, [{ id: "card:test-timejammer:1~someone-else", source: "Timejammer", label: "Time Lock", until: "temporary" }]);
    serverDice(9, 3);
    expect((await a.attack([bear.tokenId])).status).toBe("resolved");
    expect((await a.instance(locked.instanceId)).effects ?? []).toEqual([]);
    expect((await a.instance(other.instanceId)).effects).toHaveLength(1);
  });
});

describe("E1 r2 on the server: recall riders through the Hand (dcm-cfpv, dcm-bxp.99.19.1)", () => {
  allowWorldEmails();

  it("the Hand offers Perfect Recall; moveCard takes it once per rest", async () => {
    const a = await arena();
    await a.edit({ ...brave, stress: 0, domainCards: { owned: ["bolt-beacon", "book-of-ava", "book-of-illiat"], loadout: ["bolt-beacon"] } } as Partial<CharacterSheet>);
    const hand = await a.player.query(api.combatCards.hand, { campaignId: a.campaignId, characterId: a.w.characterA });
    expect(hand.recallRiders).toEqual([{ id: `${PERFECT_RECALL.featureId}:main`, name: "Perfect Recall", ready: true, amount: 1 }]);
    const riders = [`${PERFECT_RECALL.featureId}:main`];
    // Book of Ava's Recall Cost is 2; Perfect Recall takes 1 off.
    await a.player.mutation(api.characters.moveCard, { characterId: a.w.characterA, cardId: "book-of-ava", to: "loadout", recallRiders: riders });
    expect((await a.sheet()).stress).toBe(1);
    // Used for this rest: a second recall with it is refused.
    let code: unknown = "ok";
    try {
      await a.player.mutation(api.characters.moveCard, { characterId: a.w.characterA, cardId: "book-of-illiat", to: "loadout", recallRiders: riders });
    } catch (e) {
      code = errorCode(e);
    }
    expect(code).not.toBe("ok");
  });
});
