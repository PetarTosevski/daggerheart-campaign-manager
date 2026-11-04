// Plan lanes, tracer E8 (docs/tasks/TASK-LN-E8.md): delegate to the session features, delegated targets named, the
// rest vocabulary (timing + `downtime` steps), extra downtime moves, Efficient on an interrupted long rest, the
// companion's die. Entries are inline fixtures: the SRD entries switch to the new vocabulary in wave 5.
// Book (printed pages): Efficient (Clank, CB p.53): "When you take a short rest, you can choose a long rest move instead
// of a short rest move." CB p.105: "If a long rest is interrupted, the characters instead gain the benefits of a short
// rest". Eloquent (CB p.29): "Give them an additional downtime move during their next rest." Know the Tide (CB p.77):
// "Before you make an action roll, you can spend any number of these tokens to gain a +1 bonus to the roll for each
// token spent." Lunar Phases (HF p.17): "Once per rest, you can spend a Hope to increase the value of this die by one. If
// you increase the value of a 6, it becomes a 1." Hex (HF p.16).
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { companionNumbers } from "../../convex/lib/companion";
import { extraMoveGrantsOf, nameDelegatedTargets, renameIds } from "../../convex/lib/featureRunner";
import type { RunPlan } from "../../src/lib/domain/card-effects/run";
import type { CardUse } from "../../src/lib/domain/card-effects/types";
import { queueRng } from "../../src/lib/domain/dice";
import { delegatedExhaustion, SESSION_DELEGATES } from "../../src/lib/domain/feature-effects/delegate";
import { runFeature } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import {
  EXTRA_MOVE_KEY,
  extraMoveGrants,
  grantExtraMove,
  NO_REST_FEATURES,
  restFeaturesOfEntry,
  restMoveSlots,
  validateFeatureChoice,
} from "../../src/lib/domain/rest/feature-moves";
import { interruptedMoves } from "../../src/lib/domain/rest/index";
import { INITIAL_COMPANION } from "../../src/lib/frames/extras/companion";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { actorOf, adversary, sheetOf } from "../unit/feature-effects/engine/fixtures";
import { errorCode, key } from "./helpers";
import { makeTest } from "./setup";

const entry = (featureId: string, use: Partial<CardUse>): FeatureEffect => ({
  featureId,
  source: "community",
  owner: "x",
  uses: [{ id: "main", name: featureId, activation: { kind: "action" }, steps: [], ...use }],
});

describe("dcm-bxp.99.19.58: Efficient on an interrupted long rest", () => {
  it("keeps the first long-rest-only pick at full strength; the others convert; without Efficient all convert", () => {
    const moves = [{ move: "tendToAllWounds" as const, targetId: "b" }, { move: "clearAllStress" as const }];
    expect(interruptedMoves("long", moves, true)).toEqual([{ move: "tendToAllWounds", targetId: "b" }, { move: "clearStress" }]);
    expect(interruptedMoves("long", moves)).toEqual([{ move: "tendToWounds", targetId: "b" }, { move: "clearStress" }]);
    // Prepare is a move of both rests: it is not the kept one; Work on a Project can be.
    expect(interruptedMoves("long", [{ move: "prepare" }, { move: "workOnProject", countdownId: "c" }], true)).toEqual([{ move: "prepare" }, { move: "workOnProject", countdownId: "c" }]);
    expect(interruptedMoves("short", moves, true)).toEqual([]);
  });
});

describe("dcm-2a1: rest features from the entry's rest vocabulary", () => {
  const during = (op: "extraMove" | "longMoveOnShort" | "rerollDie", at?: "thisRest" | "nextRest"): FeatureEffect =>
    entry("x", {
      activation: { kind: "reaction", trigger: { kind: "timing", at: "afterRest", during: true, ...(op === "extraMove" ? {} : { restType: "short" as const }) } },
      steps: [{ kind: "downtime", to: "self", op, ...(at ? { at } : {}) }],
    });

  it("a during-rest downtime step is Efficient, Celestial Trance or Oasis; a next-rest grant or an action is none", () => {
    expect(restFeaturesOfEntry(during("longMoveOnShort"))).toEqual({ efficient: true, trance: false, oasis: false });
    expect(restFeaturesOfEntry(during("extraMove", "thisRest"))).toEqual({ efficient: false, trance: true, oasis: false });
    expect(restFeaturesOfEntry(during("rerollDie"))).toEqual({ efficient: false, trance: false, oasis: true });
    expect(restFeaturesOfEntry(during("extraMove", "nextRest"))).toEqual({ efficient: false, trance: false, oasis: false });
    expect(restFeaturesOfEntry(entry("y", { steps: [{ kind: "downtime", to: "self", op: "extraMove" }] }))).toEqual({ efficient: false, trance: false, oasis: false });
  });
});

describe("dcm-bxp.99.19.2: an extra downtime move for the next rest (Eloquent)", () => {
  it("each grant is one featureUses entry until the rest; slots and validation count them", () => {
    const sheet = grantExtraMove(grantExtraMove(sheetOf("guardian", "stalwart")));
    expect(sheet.featureUses).toEqual([
      { key: `${EXTRA_MOVE_KEY}:1`, until: "rest" },
      { key: `${EXTRA_MOVE_KEY}:2`, until: "rest" },
    ]);
    expect(extraMoveGrants(sheet)).toBe(2);
    expect(restMoveSlots(NO_REST_FEATURES, 1)).toEqual({ min: 2, max: 3 });
    expect(restMoveSlots({ ...NO_REST_FEATURES, trance: true }, 1)).toEqual({ min: 2, max: 4 });
    const three = [{ move: "prepare" as const }, { move: "prepare" as const }, { move: "clearStress" as const }];
    const allowed = ["prepare", "clearStress"] as const;
    expect(() => validateFeatureChoice("a", three, allowed, NO_REST_FEATURES, [], 1)).not.toThrow();
    expect(() => validateFeatureChoice("a", three, allowed, NO_REST_FEATURES)).toThrow();
  });

  it("the runner's manual `downtime` grant counts per recipient", () => {
    const plan = {
      steps: [
        { kind: "prompt", prompt: "manual", text: "extra", targetIds: ["ally"], step: { kind: "downtime", to: "targets", op: "extraMove", at: "nextRest" } },
        { kind: "prompt", prompt: "manual", text: "other", targetIds: ["ally"], step: { kind: "downtime", to: "targets", op: "extraMove" } },
      ],
    } as unknown as RunPlan;
    expect([...extraMoveGrantsOf(plan)]).toEqual([["ally", 1]]);
  });
});

describe("dcm-78x / dcm-lk8: delegates to the session features", () => {
  const tide = entry("community:seaborne:know-the-tide", {
    steps: [{ kind: "delegate", to: "self", feature: "knowTheTide", params: { amount: { kind: "fixed", value: 2 } } }],
  });
  const bump = entry("subclass:moon:lunar-phases", {
    costs: [{ kind: "hope", amount: { kind: "fixed", value: 1 } }],
    steps: [{ kind: "delegate", to: "self", feature: "lunarPhasesBump" }],
  });

  it("Know the Tide spends the tokens from sessionFeatures; too few tokens refuse", () => {
    const sheet = sheetOf("guardian", "stalwart", { communityId: "seaborne", level: 3, sessionFeatures: { tideTokens: 3 } });
    const result = runFeature(tide, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet });
    if (!result.ok) throw new Error(result.detail);
    expect(result.sheet!.sessionFeatures?.tideTokens).toBe(1);
    expect(result.plan.steps.find((s) => s.kind === "delegate")).toMatchObject({ done: true, summary: "spent 2 Tide tokens: +2 to the roll" });
    const poor = { ...sheet, sessionFeatures: { tideTokens: 1 } };
    expect(runFeature(tide, undefined, { actor: actorOf(poor), gmFear: 0, rng: queueRng([]), sheet: poor })).toMatchObject({ ok: false, reason: "choice" });
  });

  it("Lunar Phases raises the moon die (6 -> 1) once per rest with the sheet button's key; the entry pays the Hope", () => {
    const sheet = sheetOf("witch", "moon", { subclassRank: "mastery", hope: 2, sessionFeatures: { moonDie: 6 } });
    const result = runFeature(bump, undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet });
    if (!result.ok) throw new Error(result.detail);
    expect(result.sheet!.sessionFeatures?.moonDie).toBe(1);
    expect(result.plan.actor.after.hope).toBe(1);
    expect(result.plan.actor.featureUses).toContainEqual({ key: "lunarPhasesBump", until: "rest" });
    const used = { ...result.sheet!, featureUses: [{ key: "lunarPhasesBump", until: "rest" as const }] };
    expect(delegatedExhaustion(used, bump.uses[0]!)).toMatchObject({ key: "lunarPhasesBump", until: "rest" });
    expect(runFeature(bump, undefined, { actor: actorOf(used), gmFear: 0, rng: queueRng([]), sheet: used })).toMatchObject({ ok: false, reason: "exhausted" });
    // Not a Moon Witch with the mastery: refused.
    expect(() => SESSION_DELEGATES.lunarPhasesBump!(sheetOf("witch", "moon", { sessionFeatures: { moonDie: 3 } }), {})).toThrow();
  });
});

describe("dcm-53f: a delegated Hex names its map target", () => {
  const hex = entry("class:witch:hex", { targets: { side: "enemy", range: "far", count: { kind: "one" } }, steps: [{ kind: "delegate", to: "targets", feature: "hex" }] });
  const sheet = sheetOf("witch", "hedge", { level: 3, traits: { agility: 0, strength: 0, finesse: 1, instinct: 1, presence: 1, knowledge: 2 } });

  it("D5 gets the creature, the server swaps its name in; a second Hex on it is refused", () => {
    const result = runFeature(hex, undefined, { actor: actorOf(sheet, { spellcast: 2, tier: 2 }), gmFear: 0, rng: queueRng([]), sheet, targets: [adversary("tok1")] });
    if (!result.ok) throw new Error(result.detail);
    expect(result.sheet!.classState.hexes).toEqual(["tok1"]);
    const names = new Map([["tok1", "Bandit 2"]]);
    expect(nameDelegatedTargets(result.sheet!, names).classState.hexes).toEqual(["Bandit 2"]);
    expect(renameIds("used Hex on tok1: −2", names)).toBe("used Hex on Bandit 2: −2");
    const twice = { ...sheet, classState: { ...sheet.classState, hexes: ["Bandit 2", "tok1"] } };
    expect(() => nameDelegatedTargets(twice, names)).toThrow();
    // A typed name still wins.
    const typed = runFeature(
      { ...hex, uses: [{ ...hex.uses[0]!, steps: [{ kind: "delegate", to: "targets", feature: "hex", params: { choice: "The ogre" } }] }] },
      undefined,
      { actor: actorOf(sheet, { spellcast: 2, tier: 2 }), gmFear: 0, rng: queueRng([]), sheet, targets: [adversary("tok1")] },
    );
    if (!typed.ok) throw new Error(typed.detail);
    expect(typed.sheet!.classState.hexes).toEqual(["The ogre"]);
  });
});

describe("dcm-2z2: the companion's numbers", () => {
  it("d6 Melee physical at level 1; Vicious steps the die; training picks left", () => {
    expect(companionNumbers(INITIAL_COMPANION, 1)).toMatchObject({ dieSides: 6, range: "melee", damageType: "physical", trainingLeft: 0 });
    const vicious = { ...INITIAL_COMPANION, training: { vicious: 1 }, vicious: ["die" as const], attack: { name: "Bite", damageType: "mag" as const }, bonusTraining: 1 };
    expect(companionNumbers(vicious, 3)).toMatchObject({ dieSides: 8, damageType: "magic", trainingLeft: 2 });
  });
});

// ---------------------------------------------------------------- the rest flow (convex)

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

afterEach(() => vi.restoreAllMocks());

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return errorCode(e);
  }
}

describe("dcm-bxp.99.19.2: a granted extra move in the rest flow", () => {
  it("the next rest offers one more slot, takes three moves, and its end clears the grant", async () => {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({ gm: await ctx.db.insert("users", { email: "gm@example.com" }), p1: await ctx.db.insert("users", { email: "p1@example.com" }) }));
    const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
    const [gm, p1] = [as(ids.gm), as(ids.p1)];
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
    const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
    await p1.mutation(api.members.joinByCode, { code });
    const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
    const sheetOfA = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", a))!.sheet));
    const grant = (id: Id<"characters">) =>
      t.run(async (ctx) => {
        const s: CharacterSheet = readSheet((await ctx.db.get("characters", id))!.sheet);
        await saveSheet(ctx, id, grantExtraMove(s));
      });
    await grant(a);

    const { restId } = await gm.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: key() });
    const mine = (await gm.query(api.restsReads.current, { campaignId })).open!.moves.find((m) => m.characterId === a)!;
    expect(mine).toMatchObject({ slots: 3, extraMoves: 1, trance: false });
    const three = [{ move: "prepare" as const }, { move: "prepare" as const }, { move: "prepare" as const }];
    await p1.mutation(api.rests.choose, { restId, characterId: a, moves: three, idempotencyKey: key() });
    expect(await codeOf(p1.mutation(api.rests.choose, { restId, characterId: a, moves: [...three, { move: "prepare" }], idempotencyKey: key() }))).toBe("REST_RULE");
    await gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
    const after = await sheetOfA();
    expect(extraMoveGrants(after)).toBe(0);
  });
});
