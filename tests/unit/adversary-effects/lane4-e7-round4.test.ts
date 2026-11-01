/**
 * Plan lanes-2 wave 10, tracer E7.4 (docs/tasks/TASK-LN4-E7.md): the pure halves of round 4. The `pcEscapes` trigger
 * (dcm-0hlq; Drain and Multiply, CB p.218) and stored instance condition ends (dcm-thwj).
 */
import { describe, expect, it } from "vitest";

import { adversaryEndRoll, endInstanceConditions, instanceEffectEnds } from "../../../convex/lib/adversaryFeatures";
import { matchesTrigger } from "../../../src/lib/domain/adversary-actions/index";

describe("dcm-0hlq: matchesTrigger pcEscapes", () => {
  it("matches by token name and condition name, within the range", () => {
    const trigger = { kind: "pcEscapes" as const, name: "bramble", within: "close" as const };
    expect(matchesTrigger(trigger, { kind: "pcEscapes", tokens: 2, name: "bramble", band: "melee" })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "pcEscapes", tokens: 2, name: "web" })).toBe(false);
    expect(matchesTrigger(trigger, { kind: "pcEscapes", tokens: 2, name: "bramble", band: "far" })).toBe(false);
    const byCondition = { kind: "pcEscapes" as const, condition: { kind: "standard" as const, condition: "restrained" as const } };
    expect(matchesTrigger(byCondition, { kind: "pcEscapes", tokens: 0, condition: "restrained" })).toBe(true);
    expect(matchesTrigger(byCondition, { kind: "pcEscapes", tokens: 0, condition: "vulnerable" })).toBe(false);
    // Another event kind never matches.
    expect(matchesTrigger(trigger, { kind: "onMiss", attack: "standard" })).toBe(false);
  });
});

describe("dcm-thwj: instance condition ends", () => {
  const held = { id: "card:x:1", source: "Envelop", label: "Restrained", until: "temporary" as const, condition: "restrained", casterId: "pc-1", endsOnCaster: ["takeSevere"] };
  const slumber = { id: "card:y:1", source: "Slumber", label: "Asleep", until: "temporary" as const, condition: "Asleep", casterId: "pc-2", endsOn: ["takeDamage"] };
  const state = { effects: [held, slumber], conditions: ["restrained"], tags: ["Asleep"] };

  it("reads the stored ends; a modifier without a condition has none", () => {
    expect(instanceEffectEnds(held)).toEqual({ endsOnCaster: ["takeSevere"] });
    expect(instanceEffectEnds({ id: "a", source: "s", label: "l", until: "temporary", difficulty: 1 })).toBeUndefined();
  });

  it("the bearer's damage ends `endsOn: takeDamage` (Slumber) and its tag", () => {
    const r = endInstanceConditions(state, { kind: "damageTaken", severity: "minor", hpMarked: 1, lastHp: false }, { role: "bearer" });
    expect(r.ended).toEqual(["Asleep"]);
    expect(r.tags).toEqual([]);
    expect(r.conditions).toEqual(["restrained"]);
  });

  it("the caster's Severe damage ends only what that caster gave", () => {
    const severe = { kind: "damageTaken" as const, severity: "severe" as const, hpMarked: 3, lastHp: false };
    expect(endInstanceConditions(state, severe, { role: "caster", casterId: "pc-9" }).ended).toEqual([]);
    const r = endInstanceConditions(state, severe, { role: "caster", casterId: "pc-1" });
    expect(r.ended).toEqual(["restrained"]);
    expect(r.conditions).toEqual([]);
    expect(r.effects.map((e) => e.id)).toEqual(["card:y:1"]);
    // Major only: "until the caster takes Severe damage" stays.
    expect(endInstanceConditions(state, { ...severe, severity: "major", hpMarked: 2 }, { role: "caster", casterId: "pc-1" }).ended).toEqual([]);
  });

  it("a condition another modifier still holds stays", () => {
    const twice = { ...state, effects: [held, { ...held, id: "card:z:1", casterId: "pc-3" }] };
    const r = endInstanceConditions(twice, { kind: "damageTaken", severity: "severe", hpMarked: 3, lastHp: false }, { role: "caster", casterId: "pc-1" });
    expect(r.ended).toEqual([]);
    expect(r.conditions).toEqual(["restrained"]);
    expect(r.effects).toHaveLength(1);
  });

  it("an adversary's attack roll is an action roll for `endsOnRoll`", () => {
    const rolled = { effects: [{ ...held, endsOnCaster: undefined, endsOnRoll: { roll: "attack" } }], conditions: ["restrained"], tags: [] };
    expect(endInstanceConditions(rolled, { kind: "roll", roll: adversaryEndRoll({ attack: true, success: false }) }, { role: "bearer" }).ended).toEqual(["restrained"]);
    expect(endInstanceConditions(rolled, { kind: "roll", roll: adversaryEndRoll({ attack: false, success: true }) }, { role: "bearer" }).ended).toEqual([]);
  });
});
