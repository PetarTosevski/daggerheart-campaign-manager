/**
 * Plan lanes, tracer E1 (docs/tasks/TASK-LN-E1.md): the trigger filters, roll results, rolls and Hand changes V widened
 * (docs/tasks/TASK-LN-V.md), acted on by the server. The SRD entries switch to the new vocabulary in wave 5, so these tests
 * inject fixture entries (named after the card or feature they stand in for, with the book's numbers).
 *
 * Book texts (printed pages):
 * - Courage (CB p.48): "When you fail a roll with Fear, you gain a Hope." (dcm-5z3)
 * - Favor (HF p.14) / Ethereal Visage (CB p.45): "when you succeed ... with Hope" (dcm-a9n, dcm-nhr); Dread-Touched (HF
 *   p.181): "When you succeed with Fear" (dcm-1o3). A critical is a success with Hope (CB p.90).
 * - Ignition (HF p.22): "damage rolls with that weapon" (the primary weapon; dcm-ab5).
 * - Feed (HF p.39): "On a successful Fangs attack" (dcm-bn1); Elemental Breath (CB p.54): "treating it as an Instinct
 *   weapon" (dcm-gvr).
 * - Twilight Toll (CB p.337): "When you succeed on an action roll against them that doesn't result in making a damage
 *   roll" (dcm-94h).
 * - Fane of the Wilds (CB p.339): "When you critically succeed on a Spellcast Roll for a Sage domain spell" (dcm-z1a).
 * - Eclipse (CB p.337): "when you or an ally succeeds with Hope against an adversary within this shadow, the target must
 *   mark a Stress" (dcm-0gi).
 * - Versatile Fighter (CB p.330): "You can use a different character trait for an equipped weapon" (dcm-5dg).
 * - Parallela (CB p.332): "The next time the target makes an attack, they can hit an additional target" (dcm-y3e).
 * - Patron's Mantle (HF p.14): "advantage on action rolls to intimidate a target" (dcm-733).
 * - Perfect Recall (CB p.50): "Once per rest, when you recall a domain card in your vault, you can reduce its Recall Cost
 *   by 1." (dcm-bxp.99.19.1)
 * - Codex-Touched (CB p.333): "replace this card with any card from your vault without paying its Recall Cost" (dcm-p1r).
 * - Backhanded Guidance (HF p.87): "add 1d6 to the result of their Fear Die" (dcm-jog); Ill Omen (HF p.95, dcm-3ou).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { recallReductions } from "../../convex/lib/cardHand";
import type { HostRoll } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import { endedByAttack, extraTargetsOf, fromUseHolds, hostMatches, resultHolds, riderPhase, rollTargetHolds, weaponTraitFor, withDieBonus, type Host, type RollSubject } from "../../convex/lib/combatActions";
import { filterCoversRoll, liveMods, plainRollAutos, rollResultHolds, situationalAdvantage } from "../../convex/lib/rolls";
import type { CardEffect, CardUse, Trigger } from "../../src/lib/domain/card-effects/types";
import type { RollRecord } from "../../src/lib/domain/duality";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
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
const NO_HF = { hopeAndFear: false };

// ---------------------------------------------------------------- fixtures

/** Courage (CB p.48), with V's `duality` (the SRD entry still uses a situation until wave 5). */
const COURAGE: FeatureEffect = {
  featureId: "subclass:call-of-the-brave:courage",
  source: "subclass",
  owner: "call-of-the-brave",
  card: "foundation",
  uses: [{ id: "main", name: "Courage", activation: { kind: "auto", trigger: { kind: "afterYouRoll", roll: "action", result: "failure", duality: "fear" } }, steps: [{ kind: "hope", to: "self", change: "gain", amount: n(1) }] }],
};

/** Perfect Recall (CB p.50) as a held feature: once per rest, the recall costs 1 less. */
const PERFECT_RECALL: FeatureEffect = {
  featureId: "subclass:call-of-the-brave:battle-ritual",
  source: "subclass",
  owner: "call-of-the-brave",
  card: "foundation",
  uses: [{ id: "main", name: "Perfect Recall", activation: { kind: "rider", trigger: { kind: "whenYouRecall" } }, limit: { per: "rest" }, steps: [{ kind: "loadout", to: "self", op: "reduceRecallCost", amount: n(1) }] }],
};

/** Versatile Fighter (CB p.330): another trait for an equipped weapon (the player's pick). */
const VERSATILE_FIGHTER: CardEffect = {
  cardId: "versatile-fighter",
  uses: [{ id: "trait", name: "Versatile Fighter", activation: { kind: "passive" }, mods: [{ kind: "weaponTrait", weapon: "either", trait: "agility", choice: "trait" }], steps: [] }],
};

/** Parallela (CB p.332) on a codex card: the bearer's next attack takes one more target. */
const PARALLELA: CardEffect = {
  cardId: "book-of-ava",
  uses: [
    {
      id: "parallela",
      name: "Parallela",
      activation: { kind: "action" },
      steps: [{ kind: "effect", to: "targets", label: "Parallela", mods: [{ kind: "extraTargets", on: "attack", count: n(1) }], duration: "manual", endsOn: ["bearerAttacks"] }],
    },
    // Patron's Mantle's situational advantage (HF p.14), on the same stand-in card's effect.
    { id: "mantle", name: "Mantle", activation: { kind: "action" }, steps: [{ kind: "effect", to: "self", label: "Mantle", mods: [{ kind: "advantage", on: "action", situation: "You intimidate a target" }], duration: "scene" }] },
  ],
};

/** Codex-Touched (CB p.333): swap this card with a vault card, once per rest. */
const CODEX_TOUCHED: CardEffect = {
  cardId: "codex-touched",
  uses: [{ id: "swap", name: "Codex-Touched: swap", activation: { kind: "action" }, limit: { per: "rest" }, steps: [{ kind: "loadout", to: "self", op: "swapWithVault", note: "Swap with a vault card" }] }],
};

/** Eclipse (CB p.337), the ally's side: the target of an ally's attack marks a Stress. */
const ECLIPSE: CardEffect = {
  cardId: "eclipse",
  uses: [{ id: "ally", name: "Eclipse: an ally's success", activation: { kind: "auto", trigger: { kind: "afterAllyRolls", roll: "attack", result: "any", against: { enemy: true } } }, steps: [{ kind: "markStress", to: "targets", amount: n(1) }] }],
};

/** An automatic recall discount on a loadout card (Perfect Recall's step as an `auto` use), once per rest. */
const RECALL_AUTO: CardEffect = {
  cardId: "bolt-beacon",
  uses: [{ id: "recall", name: "Recall discount", activation: { kind: "auto", trigger: { kind: "whenYouRecall" } }, limit: { per: "rest" }, steps: [{ kind: "loadout", to: "self", op: "reduceRecallCost", amount: n(1) }] }],
};

/** Dread-Touched (HF p.181): "When you succeed with Fear, you can mark 2 Stress to prevent the GM from gaining a Fear." */
const DREAD_TOUCHED: CardEffect = {
  cardId: "dread-touched",
  uses: [
    {
      id: "prevent",
      name: "Dread-Touched: stop the GM's Fear",
      activation: { kind: "rider", trigger: { kind: "gmWouldGainFear", byYou: true, result: "successWithFear" } },
      costs: [{ kind: "stress", amount: n(2) }],
      steps: [{ kind: "negate", to: "self", what: "effect" }],
    },
  ],
};

/** The server's next dice in order; later dice stay random. */
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

injected.cards.set(DREAD_TOUCHED.cardId, DREAD_TOUCHED);
injected.features.set(COURAGE.featureId, COURAGE);
injected.cards.set(RECALL_AUTO.cardId, RECALL_AUTO);
injected.features.set(PERFECT_RECALL.featureId, PERFECT_RECALL);
for (const c of [VERSATILE_FIGHTER, PARALLELA, CODEX_TOUCHED, ECLIPSE]) injected.cards.set(c.cardId, c);

const brave = { classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation" } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- pure: filters and results

const weaponHost: Host = { spec: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } }, trait: "strength", weapon: true, weaponRange: "melee", damageType: "physical", slot: "primary", damage: true };
const use = (trigger: Trigger, steps: CardUse["steps"] = []): CardUse => ({ id: "x", name: "x", activation: { kind: "rider", trigger }, steps });
const roll = (r: Partial<HostRoll>): HostRoll => ({ success: false, critical: false, withHope: false, withFear: false, ...r });

describe("E1: trigger filters (riderPhase)", () => {
  it("weaponSlot narrows to the primary weapon (Ignition, dcm-ab5)", () => {
    const t: Trigger = { kind: "whenYouAttack", result: "success", weaponSlot: "primary" };
    expect(riderPhase(t, weaponHost, use(t))).toBe("after");
    expect(riderPhase(t, { ...weaponHost, slot: "secondary" }, use(t))).toBeNull();
    const b: Trigger = { kind: "beforeYouRoll", roll: "damage", weaponSlot: "secondary" };
    expect(riderPhase(b, weaponHost, use(b))).toBeNull();
  });

  it("beforeYouRoll weaponRange holds for a weapon at most that range (Surrounded)", () => {
    const b: Trigger = { kind: "beforeYouRoll", roll: "attack", weaponRange: "melee" };
    expect(riderPhase(b, weaponHost, use(b))).toBe("before");
    expect(riderPhase(b, { ...weaponHost, weaponRange: "far" }, use(b))).toBeNull();
  });

  it("fromUse narrows to one card or feature use (Feed on Fangs, dcm-bn1)", () => {
    const fangs: Host = { spec: { kind: "trait", trait: ["strength", "agility"], difficulty: { kind: "target" }, attack: true }, trait: "agility", weapon: false, weaponRange: null, damageType: "physical", fromUse: { id: "class:druid:fangs", useId: "main" }, damage: true };
    const feed: Trigger = { kind: "whenTargetMarksHp", fromUse: "class:druid:fangs" };
    expect(riderPhase(feed, fangs, use(feed))).toBe("damage");
    expect(riderPhase(feed, weaponHost, use(feed))).toBeNull();
    expect(fromUseHolds("class:druid:fangs:main", fangs)).toBe(true);
    expect(fromUseHolds("class:druid:fangs:other", fangs)).toBe(false);
  });

  it("a plain trait roll is not an attack; one marked attack or asWeapon is (dcm-bn1, dcm-gvr)", () => {
    const attack: Trigger = { kind: "whenYouAttack", result: "any" };
    const trait: Host = { spec: { kind: "trait", trait: "instinct", difficulty: { kind: "target" } }, trait: "instinct", weapon: false, weaponRange: null, damageType: "magic" };
    expect(riderPhase(attack, trait, use(attack))).toBeNull();
    const breath: Host = { ...trait, spec: { kind: "trait", trait: "instinct", difficulty: { kind: "target" }, asWeapon: true }, weapon: true };
    expect(riderPhase(attack, breath, use(attack))).toBe("after");
    expect(hostMatches("weaponAttack", breath)).toBe(true);
    expect(riderPhase({ kind: "whenYouAttack", result: "any", weapon: true }, breath, use(attack))).toBe("after");
  });

  it("cardDomain narrows afterYouRoll to a spell of that domain (Fane of the Wilds, dcm-z1a)", () => {
    const fane: Trigger = { kind: "afterYouRoll", roll: "spellcast", result: "critical", cardDomain: "sage" };
    const spell: Host = { spec: { kind: "spellcast", difficulty: { kind: "fixed", value: 13 } }, trait: "instinct", weapon: false, weaponRange: null, damageType: "magic", cardDomain: "sage" };
    expect(riderPhase(fane, spell, use(fane))).toBe("after");
    expect(riderPhase(fane, { ...spell, cardDomain: "arcana" }, use(fane))).toBeNull();
  });

  it("gmWouldGainFear by you rides on the roll's result (Dread-Touched, dcm-1o3)", () => {
    const t: Trigger = { kind: "gmWouldGainFear", byYou: true, result: "successWithFear" };
    expect(riderPhase(t, weaponHost, use(t))).toBe("after");
    expect(riderPhase({ kind: "gmWouldGainFear" }, weaponHost, use(t))).toBeNull();
  });

  it("afterAllyRolls with includeSelf rides on the actor's own roll (Eclipse, dcm-0gi)", () => {
    const t: Trigger = { kind: "afterAllyRolls", result: "successWithHope", includeSelf: true };
    expect(riderPhase(t, weaponHost, use(t))).toBe("after");
    expect(riderPhase({ kind: "afterAllyRolls", result: "any" }, weaponHost, use(t))).toBeNull();
  });
});

describe("E1: roll results (resultHolds)", () => {
  it("failure with Fear (Courage, dcm-5z3)", () => {
    const t: Trigger = { kind: "afterYouRoll", roll: "action", result: "failure", duality: "fear" };
    expect(resultHolds(t, roll({ withFear: true }))).toBe(true);
    expect(resultHolds(t, roll({ withHope: true }))).toBe(false);
    expect(resultHolds(t, roll({ success: true, withFear: true }))).toBe(false);
  });

  it("success with Hope counts a critical (CB p.90); success with Fear (dcm-a9n, dcm-nhr, dcm-1o3)", () => {
    const hope: Trigger = { kind: "afterYouRoll", roll: "action", result: "successWithHope" };
    expect(resultHolds(hope, roll({ success: true, withHope: true }))).toBe(true);
    expect(resultHolds(hope, roll({ success: true, critical: true, withHope: true }))).toBe(true);
    expect(resultHolds(hope, roll({ withHope: true }))).toBe(false);
    const fear: Trigger = { kind: "afterAllyRolls", result: "successWithFear" };
    expect(resultHolds(fear, roll({ success: true, withFear: true }))).toBe(true);
    expect(resultHolds(fear, roll({ success: true, withHope: true }))).toBe(false);
    expect(resultHolds({ kind: "gmWouldGainFear", byYou: true, result: "successWithFear" }, roll({ withFear: true }))).toBe(false);
    expect(rollResultHolds("withHope", "fear", roll({ withHope: true }))).toBe(false);
  });
});

describe("E1: target filters (rollTargetHolds)", () => {
  const token = (x: number, y: number) => ({ _id: `t${x}${y}`, x, y, size: 1 }) as never;
  const marked: RollSubject = { token: token(6, 10), enemy: true, tags: ["Twilight Toll"], conditions: [] };

  it("against the marked creature, with no damage roll (Twilight Toll, dcm-94h)", () => {
    const t: Trigger = { kind: "afterYouRoll", roll: "action", result: "success", against: { creature: { kind: "tagged", tag: "Twilight Toll" } }, noDamageRoll: true };
    expect(rollTargetHolds(t, { damage: false }, token(5, 10), marked)).toBe(true);
    expect(rollTargetHolds(t, { damage: true }, token(5, 10), marked)).toBe(false);
    expect(rollTargetHolds(t, { damage: false }, token(5, 10), { ...marked, tags: [] })).toBe(false);
    expect(rollTargetHolds(t, { damage: false }, token(5, 10), undefined)).toBe(false);
  });

  it("against an enemy within a range (dcm-0gi, dcm-g6t)", () => {
    const t: Trigger = { kind: "afterAllyRolls", roll: "attack", against: { enemy: true, within: "melee" } };
    expect(rollTargetHolds(t, {}, token(5, 10), marked)).toBe(true);
    expect(rollTargetHolds(t, {}, token(1, 1), marked)).toBe(false);
    expect(rollTargetHolds(t, {}, token(5, 10), { ...marked, enemy: false })).toBe(false);
    // inArea is the player's to confirm (Q13): it holds here.
    expect(rollTargetHolds({ kind: "afterAllyRolls", against: { inArea: "forest-sprites" } }, {}, token(5, 10), marked)).toBe(true);
  });
});

describe("E1: duality die bonus (dcm-3ou, dcm-jog)", () => {
  it("adds to the Fear Die's result and reads the outcome again", () => {
    const record: RollRecord = { kind: "action", manual: false, dice: [{ sides: 12, value: 8, role: "hope" }, { sides: 12, value: 5, role: "fear" }], modifier: 1, total: 14, outcome: "successHope" };
    const after = withDieBonus(record, "fear", 4);
    expect(after.dice.find((d) => d.role === "fear")?.value).toBe(9);
    expect(after.total).toBe(18);
    expect(after.outcome).toBe("successFear");
    expect(withDieBonus(record, "fear", 3).outcome).toBe("critical");
  });
});

// ---------------------------------------------------------------- pure: live mods

const sheetOf = (over: Partial<CharacterSheet> = {}) =>
  ({ ...brave, level: 5, scars: 0, hopeSlotBonus: 0, hp: 0, hpMax: 6, stress: 0, stressMax: 6, hope: 2, armorMarked: 0, evasion: 10, traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 }, effects: [], conditions: [], featureUses: [], domainCards: { owned: [], loadout: [] }, communityId: "highborne", ancestry: { kind: "single", id: "human" }, classState: {}, experiences: [], ...over }) as unknown as CharacterSheet;

describe("E1: live mods", () => {
  it("a loadout card's passive weaponTrait (Versatile Fighter, dcm-5dg)", () => {
    const mods = liveMods(sheetOf({ domainCards: { owned: ["versatile-fighter"], loadout: ["versatile-fighter"] } }), NO_HF);
    expect(weaponTraitFor(mods, "primary", "presence")).toBe("presence");
    expect(weaponTraitFor(mods, "primary", undefined)).toBeUndefined();
    expect(weaponTraitFor(liveMods(sheetOf(), NO_HF), "primary", "presence")).toBeUndefined();
  });

  it("a sheet effect's extraTargets, ended by the attack (Parallela, dcm-y3e)", () => {
    const effect = { id: "card:book-of-ava:1", source: "Book of Ava", text: "Parallela", until: "manual" as const };
    const s = sheetOf({ effects: [effect] });
    const mods = liveMods(s, NO_HF);
    expect(extraTargetsOf(mods)).toBe(1);
    expect(endedByAttack(s, mods).effects).toEqual([]);
    expect(extraTargetsOf(liveMods(sheetOf(), NO_HF))).toBe(0);
  });

  it("a situational advantage only on a roll marked with it (Patron's Mantle, dcm-733)", () => {
    const s = sheetOf({ effects: [{ id: "card:book-of-ava:2", source: "Book of Ava", text: "Mantle", until: "scene" }] });
    const roll = { kind: "action" as const, trait: "presence" as const, attack: false };
    expect(situationalAdvantage(s, { ...roll, situations: ["You intimidate a target"] }, NO_HF).advantage).toBe(1);
    expect(situationalAdvantage(s, { ...roll, situations: [] }, NO_HF).advantage).toBe(0);
    expect(situationalAdvantage(s, { ...roll, kind: "reaction", situations: ["You intimidate a target"] }, NO_HF).advantage).toBe(0);
    expect(filterCoversRoll("presence", roll)).toBe(true);
  });
});

describe("E1: automatic uses on a plain roll (Courage, dcm-5z3)", () => {
  const record = (outcome: RollRecord["outcome"], difficulty?: number): RollRecord => ({ kind: "action", manual: false, dice: [], modifier: 0, total: 5, outcome, ...(difficulty !== undefined ? { difficulty } : {}) });
  const args = { kind: "action" as const, trait: "agility" as const, attack: false };

  it("gains a Hope on a failure with Fear, not with Hope, not without a Difficulty", () => {
    const s = sheetOf();
    expect(plainRollAutos(s, args, record("failFear", 15), NO_HF, 0, () => 1)).toMatchObject({ names: ["Courage"] });
    expect(plainRollAutos(s, args, record("failFear", 15), NO_HF, 0, () => 1).sheet.hope).toBe(3);
    expect(plainRollAutos(s, args, record("failHope", 15), NO_HF, 0, () => 1).names).toEqual([]);
    expect(plainRollAutos(s, args, record("failFear"), NO_HF, 0, () => 1).names).toEqual([]);
    expect(plainRollAutos(sheetOf({ classId: "bard", subclassId: "troubadour" } as never), args, record("failFear", 15), NO_HF, 0, () => 1).names).toEqual([]);
  });
});

describe("E1: recall riders (Perfect Recall, dcm-bxp.99.19.1)", () => {
  const campaign = { frameId: "witherwild", options: {} } as never;

  it("a rider the player took lowers the cost once per rest", () => {
    const s = sheetOf();
    expect(recallReductions(s, campaign, 2, [])).toMatchObject({ cost: 2, names: [] });
    const once = recallReductions(s, campaign, 2, [PERFECT_RECALL.featureId]);
    expect(once).toMatchObject({ cost: 1, names: ["Perfect Recall"] });
    // The once-per-rest limit is used: a second recall refuses the rider.
    expect(() => recallReductions(once.sheet, campaign, 2, [PERFECT_RECALL.featureId])).toThrow();
  });
});

// ---------------------------------------------------------------- the server

type Stats = { difficulty: number; major: number | null; severe: number | null; hpMax: number; stressMax: number };
const SOFT: Stats = { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 };

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
    const ash = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const bryn = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 4, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, bryn, encounterId };
  });
  let order = 0;
  const enemy = (label: string, x: number, y: number, stats: Partial<Stats> = {}) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats: { ...SOFT, ...stats },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { instanceId, tokenId };
    });
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const sheet = (id: Id<"characters"> = w.characterA) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>, id: Id<"characters"> = w.characterA) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const attack = (targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) =>
    player.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key(), ...extra });
  const manual = (values: number[], roll: Record<string, unknown> = {}) =>
    player.mutation(api.rolls.manualRoll, { characterId: w.characterA, values, roll: { kind: "action", trait: "agility", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [], ...roll }, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, instance, sheet, edit, rows, attack, manual };
}

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("E1 on the server: plain rolls", () => {
  allowWorldEmails();

  it("Courage gains a Hope on a failure with Fear, in the roll's row (dcm-5z3)", async () => {
    const a = await arena();
    await a.edit(() => ({ ...brave, hope: 1 }));
    // Hope 3, Fear 9: a failure with Fear against 30.
    const r = await a.manual([3, 9], { difficulty: 30 });
    expect(r).toMatchObject({ roll: { outcome: "failFear" } });
    expect((await a.sheet()).hope).toBe(2);
    expect((await a.rows()).find((x) => x._id === r.entryId)?.summary).toContain("Courage");
    // Hope 9, Fear 3: a failure with Hope gains the roll's own Hope only.
    await a.manual([9, 3], { difficulty: 30 });
    expect((await a.sheet()).hope).toBe(3);
  });

  it("a marked situation adds the live mod's advantage die (Patron's Mantle, dcm-733)", async () => {
    const a = await arena();
    await a.edit(() => ({ effects: [{ id: "card:book-of-ava:2", source: "Book of Ava", text: "Mantle", until: "scene" }] }));
    const r = await a.manual([5, 4, 6], { trait: "presence", situations: ["You intimidate a target"] });
    expect(r.roll.dice.some((d) => d.role === "advantage")).toBe(true);
    // Without the situation the roll takes two dice only (a third typed value is refused).
    expect(await code(a.manual([5, 4, 6], { trait: "presence" }))).toBe("DICE_RULE");
  });
});

describe("E1 on the server: weapon attacks", () => {
  allowWorldEmails();

  it("Versatile Fighter rolls the picked trait for the weapon (dcm-5dg)", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    await a.edit(() => ({ domainCards: { owned: ["versatile-fighter"], loadout: ["versatile-fighter"] } }));
    const r = await a.attack([bear.tokenId], { trait: "presence" });
    expect(r.status).toBe("resolved");
    const row = (await a.rows()).find((x) => r.status === "resolved" && x._id === r.entryId);
    expect(row?.summary).toContain("Presence");
  });

  it("Parallela lets the next attack take one more target, then ends (dcm-y3e)", async () => {
    const a = await arena();
    const one = await a.enemy("Wolf", 6, 10);
    const two = await a.enemy("Wolf 2", 6, 11);
    expect(await code(a.attack([one.tokenId, two.tokenId]))).toBe("COMBAT_TARGET_INVALID");
    await a.edit(() => ({ effects: [{ id: "card:book-of-ava:1", source: "Book of Ava", text: "Parallela", until: "manual" }] }));
    const r = await a.attack([one.tokenId, two.tokenId]);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.targets).toHaveLength(2);
    expect((await a.sheet()).effects).toEqual([]);
  });

  it("Dread-Touched stops the GM's Fear on a success with Fear, for 2 Stress, and not on a success with Hope (dcm-1o3)", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    await a.edit(() => ({ stress: 0, domainCards: { owned: ["dread-touched"], loadout: ["dread-touched"] } }));
    const fearNow = () => a.t.run(async (ctx) => (await campaignFearState(ctx, a.campaignId)).fear);
    const before = await fearNow();
    const riders = [{ source: "card" as const, id: "dread-touched", useId: "prevent", choices: [] }];
    // Hope Die 3, Fear Die 9: a success with Fear against Difficulty 1.
    serverDice(3, 9);
    const r = await a.attack([bear.tokenId], { riders });
    expect(r).toMatchObject({ status: "resolved", roll: { outcome: "successFear" } });
    expect(await fearNow()).toBe(before);
    expect((await a.sheet()).stress).toBe(2);
    // Hope Die 9, Fear Die 3: with Hope, the rider doesn't trigger and costs nothing.
    serverDice(9, 3);
    const r2 = await a.attack([bear.tokenId], { riders });
    expect(r2).toMatchObject({ status: "resolved", roll: { outcome: "successHope" } });
    expect((await a.sheet()).stress).toBe(2);
  });

  it("an ally's automatic afterAllyRolls use runs on the attack (Eclipse, dcm-0gi)", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 6, 10);
    await a.edit(() => ({ domainCards: { owned: ["eclipse"], loadout: ["eclipse"] } }), a.w.characterB);
    const r = await a.attack([bear.tokenId]);
    expect(r.status).toBe("resolved");
    expect((await a.instance(bear.instanceId)).stress).toBe(1);
    expect((await a.rows()).some((x) => x.characterId === a.w.characterB && x.summary.includes("Eclipse"))).toBe(true);
  });
});

describe("E1 on the server: the Hand", () => {
  allowWorldEmails();

  it("Codex-Touched swaps itself with a vault card without its Recall Cost (dcm-p1r)", async () => {
    const a = await arena();
    await a.edit(() => ({ level: 10, stress: 0, domainCards: { owned: ["codex-touched", "book-of-ava"], loadout: ["codex-touched"] } }));
    const use = (extra: Record<string, unknown> = {}) => a.player.mutation(api.combatCards.useCard, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, cardId: "codex-touched", targetTokenIds: [], choices: [], idempotencyKey: key(), ...extra });
    expect(await code(use())).toBe("INVALID");
    const r = await use({ swapWith: "book-of-ava" });
    expect(r.status).toBe("resolved");
    const s = await a.sheet();
    expect(s.domainCards.loadout).toEqual(["book-of-ava"]);
    expect(s.stress).toBe(0);
  });

  it("an automatic recall use lowers the Recall Cost once per rest; a rider waits for the player's pick (dcm-bxp.99.19.1)", async () => {
    const a = await arena();
    await a.edit(() => ({ ...brave, stress: 0, domainCards: { owned: ["bolt-beacon", "book-of-ava", "book-of-illiat"], loadout: ["bolt-beacon"] } }));
    // Book of Ava's Recall Cost is 2; the automatic use takes 1 off. Perfect Recall (a rider) isn't sent by
    // `characters.moveCard` yet (follow-up), so it stays unused.
    await a.player.mutation(api.characters.moveCard, { characterId: a.w.characterA, cardId: "book-of-ava", to: "loadout" });
    expect((await a.sheet()).stress).toBe(1);
    expect((await a.rows()).some((x) => x.summary.includes("Recall discount"))).toBe(true);
    // Its once-per-rest limit is used: the next recall pays in full.
    await a.player.mutation(api.characters.moveCard, { characterId: a.w.characterA, cardId: "book-of-illiat", to: "loadout" });
    expect((await a.sheet()).stress).toBe(3);
  });
});
