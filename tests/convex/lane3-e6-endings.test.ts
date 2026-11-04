/**
 * Plan lanes-2 wave 9, tracer E6.3 (docs/tasks/TASK-LN3-E6.md): the GM's Fear spend that ends an effect (dcm-kmr,
 * dcm-6y00 (1)), a PC's adversary-given condition ending on the caster's damage or the bearer's roll (dcm-46q4, dcm-iedr
 * E6 half), and the D5 Unstoppable cleanup (dcm-v17).
 *
 * Book: Slumber (Book of Illiat, CB p.332) "they're Asleep until they take damage or the GM spends a Fear on their turn to
 * clear this condition"; Marked for Death (HF p.8) "the GM spends a number of Fear equal to your tier to clear it";
 * Envelop (CB p.213) "Restrained … until the Shark takes Severe damage"; Rattled (HF) "until they roll with Hope".
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  adversaryConditionMarker,
  adversaryMarkerOf,
  endAdversaryConditions,
  endAdversaryConditionsForCaster,
  endAdversaryConditionsOnRoll,
  endSheetEffectByGmFear,
  fearEndsOnInstance,
  fearEndsOnSheet,
  withAdversaryConditionMarkers,
  type AdversaryConditionDetailLike,
  type SourceLookup,
} from "../../convex/lib/cardRows";
import { effectKeyOf } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import type { CardUse, Step } from "../../src/lib/domain/card-effects/types";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

const SHARK = "k17abcdefghijklmnopqrstuvwxyz012";
const restrained: AdversaryConditionDetailLike = { targetId: "pc1", condition: { kind: "standard", condition: "restrained" }, endsOnCaster: ["takeSevere"] };
const rattled: AdversaryConditionDetailLike = { targetId: "pc1", condition: { kind: "tag", tag: "Rattled" }, endsOnRoll: { roll: "action", result: "withHope" } };
const sheetOf = (effects: Effect[], conditions: CharacterSheet["conditions"] = [], level = 1) => ({ name: "Mira", level, effects, conditions, domainCards: { owned: [], loadout: [] } }) as unknown as CharacterSheet;
const mark = (detail: AdversaryConditionDetailLike, existing: Effect[] = [], casterId = SHARK) =>
  adversaryConditionMarker(existing, { casterId, casterName: "Shark", cardId: "shark/Envelop", featureName: "Envelop", detail })!;

const oneUse = (id: string, steps: readonly Step[]): CardUse => ({ id, name: id, activation: { kind: "action" }, steps });
const FIXTURES: Record<string, readonly CardUse[]> = {
  slumber: [oneUse("main", [{ kind: "condition", to: "targets", condition: { kind: "tag", tag: "Asleep" }, duration: "manual", endsOn: ["takeDamage", "gmSpendsFear"] } as Step])],
  mark: [oneUse("main", [{ kind: "effect", to: "self", label: "Marked", mods: [], duration: "manual", endsOn: ["gmSpendsFear"], endFear: { kind: "byTier", values: [1, 2, 3, 4] } } as Step])],
};
const lookup: SourceLookup = (id) => FIXTURES[id] as never;

describe("adversary-given condition markers (pure, dcm-46q4)", () => {
  it("a detail with endsOnCaster / endsOnRoll becomes a marker that reads back; one without them none", () => {
    const m = mark(restrained);
    expect(m.id).toBe("ac:1");
    expect(m.id.length).toBeLessThanOrEqual(40);
    expect(m.text.length).toBeLessThanOrEqual(300);
    expect(m.text.startsWith("Restrained until Shark takes Severe damage")).toBe(true);
    expect(adversaryMarkerOf(m)).toMatchObject({ casterId: SHARK, cardId: "shark/Envelop", condition: "restrained", tag: false, ends: { endsOnCaster: ["takeSevere"] } });
    expect(adversaryConditionMarker([], { casterId: SHARK, casterName: "Shark", cardId: "x", featureName: "x", detail: { targetId: "pc1", condition: { kind: "standard", condition: "vulnerable" } } })).toBeNull();
    expect(adversaryMarkerOf({ id: "card:x:1", text: "Restrained", source: "x" })).toBeNull();
  });

  it("withAdversaryConditionMarkers adds markers for this PC only and replaces the same caster's older one", () => {
    const sheet = sheetOf([], ["restrained"]);
    const input = { casterId: SHARK, casterName: "Shark", adversaryId: "shark", feature: "Envelop", details: [restrained, { ...restrained, targetId: "pc2" }] };
    const once = withAdversaryConditionMarkers(sheet, "pc1", input);
    expect(once.effects.map((e) => e.id)).toEqual(["ac:1"]);
    expect(withAdversaryConditionMarkers(once, "pc1", input).effects.map((e) => e.id)).toEqual(["ac:1"]);
    expect(withAdversaryConditionMarkers(sheet, "pc3", input)).toBe(sheet);
  });

  it("the caster's Severe damage ends its Restrained (not another caster's, not a Major hit)", () => {
    const m = mark(restrained);
    const sheet = sheetOf([m], ["restrained"]);
    const severe = { kind: "damageTaken" as const, severity: "severe" as const, hpMarked: 3, lastHp: false };
    expect(endAdversaryConditions(sheet, { ...severe, severity: "major", hpMarked: 2 }, { role: "caster", casterId: SHARK }).ended).toEqual([]);
    expect(endAdversaryConditions(sheet, severe, { role: "caster", casterId: "other" }).ended).toEqual([]);
    const out = endAdversaryConditions(sheet, severe, { role: "caster", casterId: SHARK });
    expect(out.sheet.conditions).toEqual([]);
    expect(out.sheet.effects).toEqual([]);
    expect(out.lines).toEqual(["Mira: Restrained ends (Envelop)"]);
  });

  it("a second marker for the same condition keeps it", () => {
    const a = mark(restrained);
    const b = mark(restrained, [a], "k17otherotherotherotherotherother");
    const out = endAdversaryConditions(sheetOf([a, b], ["restrained"]), { kind: "damageTaken", severity: "severe", hpMarked: 3, lastHp: false }, { role: "caster", casterId: SHARK });
    expect(out.sheet.conditions).toEqual(["restrained"]);
    expect(out.sheet.effects.map((e) => e.id)).toEqual([b.id]);
  });

  it("Rattled (a tag) ends on the bearer's roll with Hope, with its tag effect; a roll with Fear keeps it", () => {
    const m = mark(rattled);
    const tagEffect: Effect = { id: `${effectKeyOf("shark/Envelop")}:1`, source: "Envelop", text: "Rattled", until: "manual" };
    const sheet = sheetOf([tagEffect, m]);
    expect(endAdversaryConditionsOnRoll(sheet, { kind: "action", outcome: "successFear" }).ended).toEqual([]);
    expect(endAdversaryConditionsOnRoll(sheet, { kind: "damage", outcome: undefined } as never).ended).toEqual([]);
    const out = endAdversaryConditionsOnRoll(sheet, { kind: "action", outcome: "failHope" });
    expect(out.sheet.effects).toEqual([]);
  });
});

describe("Fear-endable effects (pure, dcm-kmr)", () => {
  it("lists sheet effects with their cost (byTier by the sheet's level) and adversary markers with endFear", () => {
    const marked: Effect = { id: `${effectKeyOf("mark")}:1`, source: "Mark", text: "Marked", until: "manual" };
    const feared = mark({ ...restrained, endFear: { kind: "fixed", value: 2 } });
    const plain = mark(restrained, [feared]);
    const sheet = sheetOf([marked, feared, plain], ["restrained"], 5);
    expect(fearEndsOnSheet(sheet, lookup)).toEqual([
      { effectId: marked.id, label: "Marked", source: "Mark", fear: 3 },
      { effectId: feared.id, label: "restrained", source: "Envelop", fear: 2 },
    ]);
    // The marker with endFear ends on the spend; the condition stays while the other marker holds it.
    const out = endSheetEffectByGmFear(sheet, feared.id, lookup)!;
    expect(out.sheet.effects.map((e) => e.id)).toEqual([marked.id, plain.id]);
    expect(out.sheet.conditions).toEqual(["restrained"]);
    expect(endSheetEffectByGmFear(sheet, plain.id, lookup)).toBeNull();
    expect(endSheetEffectByGmFear(sheet, marked.id, lookup)!.sheet.effects.map((e) => e.id)).toEqual([feared.id, plain.id]);
  });

  it("lists instance modifiers by the caster's tier", () => {
    const instance = { conditions: [], tags: ["Asleep"], effects: [{ id: "card:slumber:1", source: "Slumber", label: "Asleep", until: "manual" as const }, { id: "card:mark:2~tok", source: "Mark", label: "Marked", until: "manual" as const }] };
    expect(fearEndsOnInstance(instance as never, (t) => (t === "tok" ? 4 : 1), lookup)).toEqual([
      { effectId: "card:slumber:1", label: "Asleep", source: "Slumber", fear: 1 },
      { effectId: "card:mark:2~tok", label: "Marked", source: "Mark", fear: 4 },
    ]);
  });
});

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
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
      tags: ["Asleep"],
      effects: [{ id: "card:book-of-illiat:1", source: "Slumber", label: "Asleep", until: "temporary" }],
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
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const setFear = (n: number) =>
    t.run(async (ctx) => {
      const s = await campaignFearState(ctx, campaignId);
      await ctx.db.patch(s._id, { fear: n });
    });
  return { w, t, campaignId, gm, instanceId, edit, sheet, instance, fear, setFear };
}

describe("combatEffects (dcm-kmr, dcm-6y00 (1))", () => {
  it("the GM spends a Fear to wake a Slumbering instance; undo gives it back", async () => {
    const a = await arena();
    await a.setFear(3);
    const target = { kind: "instance" as const, instanceId: a.instanceId };
    expect(await a.gm.query(api.combatEffects.fearEnds, { campaignId: a.campaignId, target })).toEqual([{ effectId: "card:book-of-illiat:1", label: "Asleep", source: "Slumber", fear: 1 }]);
    // The button's cost must match.
    expect(await codeOf(a.gm.mutation(api.combatEffects.endByFear, { campaignId: a.campaignId, target, effectId: "card:book-of-illiat:1", fear: 2, idempotencyKey: key() }))).toBe("INVALID");
    const out = await a.gm.mutation(api.combatEffects.endByFear, { campaignId: a.campaignId, target, effectId: "card:book-of-illiat:1", fear: 1, idempotencyKey: key() });
    expect(out).toEqual({ spent: 1, lines: ["Bear: Asleep ends (Slumber)"] });
    expect(await a.fear()).toBe(2);
    const inst = await a.instance();
    expect(inst.tags).toEqual([]);
    expect(inst.effects).toEqual([]);
    const row = await a.t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).find((r) => r.kind === "combat"));
    expect(row?.visibility).toBe("gm");
    await a.gm.mutation(api.actionLog.undo, { entryId: row!._id, idempotencyKey: key() });
    expect(await a.fear()).toBe(3);
    expect((await a.instance()).tags).toEqual(["Asleep"]);
  });

  it("too little Fear is FEAR_EMPTY and changes nothing", async () => {
    const a = await arena();
    await a.setFear(0);
    const target = { kind: "instance" as const, instanceId: a.instanceId };
    expect(await codeOf(a.gm.mutation(api.combatEffects.endByFear, { campaignId: a.campaignId, target, effectId: "card:book-of-illiat:1", fear: 1, idempotencyKey: key() }))).toBe("FEAR_EMPTY");
    expect((await a.instance()).tags).toEqual(["Asleep"]);
  });

  it("an adversary-given condition with an endFear ends on a PC sheet; caster damage ends the others (party helper)", async () => {
    const a = await arena();
    await a.setFear(5);
    const casterId = a.instanceId as string;
    const feared = adversaryConditionMarker([], { casterId, casterName: "Bear", cardId: "bear/Hold", featureName: "Hold", detail: { ...restrained, endFear: { kind: "fixed", value: 2 } } })!;
    await a.edit(() => ({ conditions: ["restrained"], effects: [feared] }));
    const target = { kind: "character" as const, characterId: a.w.characterA };
    expect((await a.gm.query(api.combatEffects.fearEnds, { campaignId: a.campaignId, target })).map((e) => e.fear)).toEqual([2]);
    // A player can't call it (the matrix covers roles; this is the content).
    expect(await codeOf(a.w.as("player").mutation(api.combatEffects.endByFear, { campaignId: a.campaignId, target, effectId: feared.id, fear: 2, idempotencyKey: key() }))).toBe("FORBIDDEN");
    await a.gm.mutation(api.combatEffects.endByFear, { campaignId: a.campaignId, target, effectId: feared.id, fear: 2, idempotencyKey: key() });
    expect(await a.fear()).toBe(3);
    expect((await a.sheet()).conditions).toEqual([]);

    // The party helper: the Bear's Severe damage ends the Restrained it gave.
    const plain = adversaryConditionMarker([], { casterId, casterName: "Bear", cardId: "bear/Hold", featureName: "Hold", detail: restrained })!;
    await a.edit(() => ({ conditions: ["restrained"], effects: [plain] }));
    const lines = await a.t.run((ctx) =>
      endAdversaryConditionsForCaster(ctx as never, { campaignId: a.campaignId, casterId, occ: { kind: "damageTaken", severity: "severe", hpMarked: 3, lastHp: false }, groupId: "g1", actorId: a.w.users.gm }),
    );
    expect(lines.lines).toHaveLength(1);
    expect((await a.sheet()).conditions).toEqual([]);
  });

  it("a D5 Unstoppable action that removes the die ends the Unstoppable effect (dcm-v17)", async () => {
    const a = await arena();
    const fx: Effect = { id: `${effectKeyOf("class:guardian:unstoppable")}:1`, source: "Unstoppable", text: "Unstoppable", until: "scene" };
    const keep: Effect = { id: "test:keep", source: "Test", text: "Other", until: "manual" };
    const use = (featureKey: string) => a.w.as("player").mutation(api.classFeatures.use, { characterId: a.w.characterA, featureKey, params: {}, idempotencyKey: key() });
    await a.edit(() => ({ classId: "guardian", classState: { unstoppable: { value: 3, max: 4 } }, effects: [fx, keep] }));
    await use("unstoppableHit"); // 3 → 4: still held
    expect((await a.sheet()).effects.map((e) => e.id)).toEqual([fx.id, keep.id]);
    await use("unstoppableHit"); // past the maximum: the die goes, and the effect with it
    const after = await a.sheet();
    expect(after.classState.unstoppable).toBeUndefined();
    expect(after.effects.map((e) => e.id)).toEqual([keep.id]);
    await a.edit(() => ({ classState: { unstoppable: { value: 1, max: 4 } }, effects: [fx] }));
    await use("endUnstoppable");
    expect((await a.sheet()).effects).toEqual([]);
  });
});
