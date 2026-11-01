/**
 * Plan lanes-2 wave 10, tracer E6.4 (docs/tasks/TASK-LN4-E6.md): sheet effects record their caster (dcm-lztq: readers,
 * the D5 writer and the backfill migration), Marked for Death names its assassin and target (dcm-qxb6), and ending the
 * assassin's effect lifts the tag on the instance (dcm-mvoo engine note).
 *
 * Book: Eye of the Storm (Skykin, HF p.23) "until you take Severe damage or you use this feature again"; Marked for
 * Death (Assassin, HF p.8) "You can have only one adversary Marked for Death at a time. This condition lasts until you
 * take a rest, the current adversary Marked for Death is defeated, or the GM spends a number of Fear equal to your tier
 * to clear it."
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MARKED_FOR_DEATH_EFFECT, endForCasterOnSheets, endOnDefeat, endOnTokensGone, withEffectTarget, type SourceLookup } from "../../convex/lib/cardRows";
import { effectKeyOf } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import { withDerivedCasters } from "../../convex/migrations/sheetEffectCaster";
import type { CardUse, Step } from "../../src/lib/domain/card-effects/types";
import type { EndOccurrence } from "../../src/lib/domain/characters/expiry";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

const fixtureUse = (id: string, steps: readonly Step[]): CardUse => ({ id, name: id, activation: { kind: "action" }, steps });
const FIXTURES: Record<string, readonly CardUse[]> = {
  storm: [fixtureUse("ally", [{ kind: "effect", to: "targets", label: "Eye of the Storm: +1 Evasion", mods: [], duration: "manual", endsOn: ["usedAgain"], endsOnCaster: ["takeSevere"] }])],
  flight: [fixtureUse("main", [{ kind: "effect", to: "targets", label: "Flying", mods: [], duration: "manual", endsOn: ["tokensGone"] }])],
  "class:assassin:marked-for-death": [fixtureUse("main", [{ kind: "condition", to: "targets", condition: { kind: "tag", tag: "Marked for Death" }, duration: "rest", endsOn: ["targetDefeated", "gmSpendsFear"] }])],
};
const lookup: SourceLookup = (id) => FIXTURES[id];
const severe: EndOccurrence = { kind: "damageTaken", severity: "severe", hpMarked: 3, lastHp: false };

const base = { name: "Ash", effects: [] as Effect[], domainCards: { owned: [], loadout: [] } } as unknown as CharacterSheet;
const holder = (name: string, card: string) => ({ ...base, name, domainCards: { owned: [card], loadout: [card] } }) as CharacterSheet;
const storm = (n: number, casterId?: string): Effect => ({ id: `${effectKeyOf("storm")}:${n}`, source: "Eye of the Storm", text: "Eye of the Storm: +1 Evasion", until: "manual", ...(casterId ? { casterId } : {}) });

describe("caster-tied ends read the stored caster (dcm-lztq)", () => {
  // Two Skykin (Sky, Twin) each put Eye of the Storm on Ash.
  const sky = holder("Sky", "storm");
  const twin = holder("Twin", "storm");
  const ash = { ...base, effects: [storm(1, "sky"), storm(2, "twin")] };
  const party = [
    { key: "sky", sheet: sky },
    { key: "twin", sheet: twin },
    { key: "ash", sheet: ash },
  ];

  it("Sky's Severe damage ends only Sky's Eye of the Storm (the caster in the party list)", () => {
    const out = endForCasterOnSheets(sky, party, severe, lookup);
    expect(out.map((o) => [o.key, o.sheet.effects.map((e) => e.casterId)])).toEqual([["ash", ["twin"]]]);
  });

  it("the caster's id passed by the caller, or derived when the caster is listed under a null key (incomingHits)", () => {
    expect(endForCasterOnSheets(twin, party.filter((p) => p.key !== "twin"), severe, lookup, "twin").map((o) => o.sheet.effects.map((e) => e.casterId))).toEqual([["sky"]]);
    const nullKeyed = [{ key: null as string | null, sheet: twin }, { key: "sky" as string | null, sheet: sky }, { key: "ash" as string | null, sheet: ash }];
    expect(endForCasterOnSheets(twin, nullKeyed, severe, lookup).map((o) => [o.key, o.sheet.effects.map((e) => e.casterId)])).toEqual([["ash", ["sky"]]]);
    // The attacker left out of the list (combatActions): a casterId naming no listed member is the caster's.
    expect(endForCasterOnSheets(sky, party.filter((p) => p.key !== "sky"), severe, lookup).map((o) => o.sheet.effects.map((e) => e.casterId))).toEqual([["twin"]]);
  });

  it("an effect stored without a caster keeps the old guess: two holders leave it to the GM", () => {
    const old = { ...base, effects: [storm(1)] };
    expect(endForCasterOnSheets(sky, [party[0]!, party[1]!, { key: "ash", sheet: old }], severe, lookup)).toEqual([]);
    expect(endForCasterOnSheets(sky, [party[0]!, { key: "ash", sheet: old }], severe, lookup).map((o) => o.key)).toEqual(["ash"]);
  });

  it("tokensGone: with two Flight holders, only the caster's Flying on an ally ends", () => {
    const a = holder("A", "flight");
    const b = holder("B", "flight");
    const fly = (n: number, casterId: string): Effect => ({ id: `${effectKeyOf("flight")}:${n}`, source: "Flight", text: "Flying", until: "manual", casterId });
    const ally = { ...base, effects: [fly(1, "a"), fly(2, "b")] };
    const out = endOnTokensGone({ key: "a", sheet: a }, [{ key: "b", sheet: b }, { key: "ally", sheet: ally }], ["flight"], lookup);
    expect(out.map((o) => [o.key, o.sheet.effects.map((e) => e.casterId)])).toEqual([["ally", ["b"]]]);
  });
});

describe("Marked for Death names its target (dcm-qxb6)", () => {
  const marked = (target?: string, caster?: string): Effect => ({ id: MARKED_FOR_DEATH_EFFECT, source: "Marked for Death", text: "Bear: +1d4", until: "rest", ...(target ? { targetInstanceId: target } : {}), ...(caster ? { casterId: caster } : {}) });

  it("defeating one tagged instance ends only the assassin whose mark names it", () => {
    const first = { ...base, effects: [marked("bear", "a1")] };
    const second = { ...base, name: "Vex", effects: [marked("wolf", "a2")] };
    const bear = { _id: "bear" as Id<"encounterAdversaries">, tags: ["Marked for Death"] };
    expect(endOnDefeat(first, bear, lookup).sheet.effects).toEqual([]);
    expect(endOnDefeat(second, bear, lookup).ended).toEqual([]);
    // An old effect without a target: the tag link, as before.
    expect(endOnDefeat({ ...base, effects: [marked()] }, bear, lookup).ended).toHaveLength(1);
  });

  it("withEffectTarget stamps the assassin's D5 effect (the writer the attack path calls)", () => {
    const sheet = { ...base, effects: [marked()] };
    expect(withEffectTarget(sheet, MARKED_FOR_DEATH_EFFECT, "a1", "bear").effects[0]).toMatchObject({ casterId: "a1", targetInstanceId: "bear" });
    expect(withEffectTarget(base, MARKED_FOR_DEATH_EFFECT, "a1", "bear")).toBe(base);
  });
});

describe("the backfill's derivation (withDerivedCasters)", () => {
  it("one holder in the campaign is the caster; two holders, no source, or a stored caster are left", () => {
    const sky = holder("Sky", "storm");
    const ash = { ...base, effects: [storm(1), { id: "hand-written", source: "GM", text: "Blessed", until: "manual" } as Effect, storm(2, "kept")] };
    const out = withDerivedCasters(ash, [{ id: "sky", sheet: sky }, { id: "ash", sheet: ash }]);
    expect(out?.effects.map((e) => e.casterId)).toEqual(["sky", undefined, "kept"]);
    expect(withDerivedCasters(ash, [{ id: "sky", sheet: sky }, { id: "twin", sheet: holder("Twin", "storm") }, { id: "ash", sheet: ash }])).toBeNull();
  });
});

// ---------------------------------------------------------------- through the real functions

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const now = Date.now();
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const instanceId = await t.run((ctx) =>
    ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Bear",
      order: 0,
      summoned: false,
      stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: ["Marked for Death"],
      effects: [{ id: "feat:class:assassin:marked-for-death:1", source: "Marked for Death", label: "Marked for Death", until: "temporary" }],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    }),
  );
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>, id: Id<"characters"> = w.characterA) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  const sheet = (id: Id<"characters"> = w.characterA) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const instance = () => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", instanceId))!);
  const setFear = (n: number) =>
    t.run(async (ctx) => {
      const s = await campaignFearState(ctx, campaignId);
      await ctx.db.patch(s._id, { fear: n });
    });
  const mark = (target: string = instanceId): Effect => ({ id: MARKED_FOR_DEATH_EFFECT, source: "Marked for Death", text: "Bear: +1d4 damage against them.", until: "rest", casterId: w.characterA, targetInstanceId: target });
  return { w, t, campaignId, instanceId, edit, sheet, instance, setFear, mark };
}

describe("ending the assassin's effect lifts the tag (dcm-mvoo)", () => {
  it("the End button lifts the tag and its marker on the named instance, in one undo group", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "assassin", effects: [a.mark()] }));
    await a.w.as("player").mutation(api.classFeatures.endEffect, { characterId: a.w.characterA, effectId: MARKED_FOR_DEATH_EFFECT, idempotencyKey: key() });
    expect((await a.sheet()).effects).toEqual([]);
    const inst = await a.instance();
    expect(inst.tags).toEqual([]);
    expect(inst.effects).toEqual([]);
    const rows = await a.t.run((ctx) => ctx.db.query("actionLog").collect());
    const gmRow = rows.find((r) => r.visibility === "gm")!;
    expect(gmRow.summary).toBe("Bear: Marked for Death ends (Marked for Death)");
    expect(rows.find((r) => r.characterId === a.w.characterA)?.groupId).toBe(gmRow.groupId);
    // Undo of the player's row reverts the group: the mark and the tag come back.
    await a.w.as("gm").mutation(api.actionLog.undo, { entryId: gmRow._id, idempotencyKey: key() });
    expect((await a.instance()).tags).toEqual(["Marked for Death"]);
    expect((await a.sheet()).effects.map((e) => e.id)).toEqual([MARKED_FOR_DEATH_EFFECT]);
  });

  it("another assassin's mark on the same instance keeps the tag; an effect without a target lifts nothing", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "assassin", effects: [a.mark()] }));
    await a.edit(() => ({ classId: "assassin", effects: [{ ...a.mark(), casterId: a.w.characterB }] }), a.w.characterB);
    await a.w.as("player").mutation(api.classFeatures.endEffect, { characterId: a.w.characterA, effectId: MARKED_FOR_DEATH_EFFECT, idempotencyKey: key() });
    expect((await a.instance()).tags).toEqual(["Marked for Death"]);

    const b = await arena();
    const { targetInstanceId: _t, ...old } = b.mark();
    void _t;
    await b.edit(() => ({ classId: "assassin", effects: [old] }));
    await b.w.as("player").mutation(api.classFeatures.endEffect, { characterId: b.w.characterA, effectId: MARKED_FOR_DEATH_EFFECT, idempotencyKey: key() });
    expect((await b.instance()).tags).toEqual(["Marked for Death"]);
  });

  it("the GM's Fear spend on the assassin's effect lifts the tag too", async () => {
    const a = await arena();
    await a.setFear(3);
    await a.edit(() => ({ classId: "assassin", level: 1, effects: [a.mark()] }));
    const target = { kind: "character" as const, characterId: a.w.characterA };
    const ends = await a.w.as("gm").query(api.combatEffects.fearEnds, { campaignId: a.campaignId, target });
    expect(ends.map((e) => [e.effectId, e.fear])).toEqual([[MARKED_FOR_DEATH_EFFECT, 1]]);
    const out = await a.w.as("gm").mutation(api.combatEffects.endByFear, { campaignId: a.campaignId, target, effectId: MARKED_FOR_DEATH_EFFECT, fear: 1, idempotencyKey: key() });
    expect(out.lines).toContain("Bear: Marked for Death ends (Marked for Death)");
    expect((await a.instance()).tags).toEqual([]);
  });
});

describe("D5 writer (dcm-lztq)", () => {
  it("a class action's new effect records its caster", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "warrior", hope: 3, effects: [] }));
    await a.w.as("player").mutation(api.classFeatures.use, { characterId: a.w.characterA, featureKey: "noMercy", params: {}, idempotencyKey: key() });
    expect((await a.sheet()).effects.map((e) => [e.id, e.casterId])).toEqual([["no-mercy", a.w.characterA]]);
  });
});

describe("migrations/sheetEffectCaster:backfillCaster (dcm-lztq)", () => {
  const FN = "migrations/sheetEffectCaster:backfillCaster";
  const run = async (a: Awaited<ReturnType<typeof arena>>, extra: { dryRun?: boolean; reset?: boolean } = {}) => {
    await a.w.t.mutation(internal.migrations.run.run, { fn: FN, ...extra });
    await a.w.t.finishAllScheduledFunctions(vi.runAllTimers);
  };
  const raw = (a: Awaited<ReturnType<typeof arena>>, id: Id<"characters">) => a.t.run(async (ctx) => (await ctx.db.get("characters", id))!.sheet);

  it("backfills the one holder; a dry run and a second run change nothing", async () => {
    const a = await arena();
    // Ash (A) holds Marked for Death (an assassin); B carries an effect from a feature only A holds, and a hand-written one.
    const feat = `${effectKeyOf("class:assassin:marked-for-death")}:1`;
    await a.edit(() => ({ classId: "assassin", effects: [{ id: MARKED_FOR_DEATH_EFFECT, source: "Marked for Death", text: "Bear", until: "rest" }] }));
    await a.edit(() => ({ effects: [{ id: feat, source: "Marked for Death", text: "Marked for Death", until: "rest" }, { id: "hand", source: "GM", text: "Blessed", until: "manual" }] }), a.w.characterB);
    const bClass = (await a.sheet(a.w.characterB)).classId;
    const before = await raw(a, a.w.characterA);
    await run(a, { dryRun: true });
    expect(await raw(a, a.w.characterA)).toEqual(before);

    await run(a);
    expect((await a.sheet()).effects.map((e) => e.casterId)).toEqual([a.w.characterA]);
    // B's feature effect: A is the one holder unless B is an assassin too.
    expect((await a.sheet(a.w.characterB)).effects.map((e) => e.casterId)).toEqual([bClass === "assassin" ? undefined : a.w.characterA, undefined]);

    const once = [await raw(a, a.w.characterA), await raw(a, a.w.characterB)];
    await run(a, { reset: true });
    expect([await raw(a, a.w.characterA), await raw(a, a.w.characterB)]).toEqual(once);
  });

  it("two holders in the campaign: left for the old guess", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "assassin", effects: [{ id: MARKED_FOR_DEATH_EFFECT, source: "Marked for Death", text: "Bear", until: "rest" }] }));
    await a.edit(() => ({ classId: "assassin" }), a.w.characterB);
    const before = await raw(a, a.w.characterA);
    await run(a);
    expect(await raw(a, a.w.characterA)).toEqual(before);
  });
});
