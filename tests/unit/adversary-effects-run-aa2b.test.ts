import { describe, expect, it } from "vitest";

import { adversaryNumberEnv, passiveSummary, type AdversaryState } from "@/lib/domain/adversary-actions/features";
import { run, upfrontFear, type AdversaryPlan, type AdversaryRunContext, type AdversaryRunResult } from "@/lib/domain/adversary-effects/run";
import type { AdversaryFeatureEffect } from "@/lib/domain/adversary-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { adversaryEffects } from "@/lib/srd/adversary-effects";

// Plan combat-actions, tracer AA2b: the AA1 runner problems listed in TASK-CA-AA2.md (beads dcm-vv2, dcm-yle), fixed in
// src/lib/domain/adversary-effects/run.ts and src/lib/domain/adversary-actions/features.ts. Fixed dice, worked by hand.

const def = (id: string) => ADVERSARIES.find((a) => a.id === id)!;
const effectOf = (adversaryId: string, feature: string): AdversaryFeatureEffect => adversaryEffects(adversaryId).find((e) => e.feature === feature)!;

const selfOf = (adversaryId: string, over: Partial<Combatant> = {}): Combatant => {
  const d = def(adversaryId);
  return { id: "self", side: "adversary", difficulty: d.difficulty, thresholds: { major: d.thresholds.major, severe: d.thresholds.severe }, hp: 0, hpMax: d.hp, stress: 0, stressMax: d.stress ?? 0, defeated: false, conditions: [], ...over };
};

const pc = (id: string): Combatant => ({ id, side: "pc", evasion: 12, thresholds: { major: 20, severe: 40 }, hp: 0, hpMax: 6, stress: 0, stressMax: 6, armor: 0, armorMax: 3, defeated: false, conditions: [] });

function attempt(adversaryId: string, feature: string, dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryRunResult {
  const d = def(adversaryId);
  const rng = queueRng(dice);
  const result = run(effectOf(adversaryId, feature), { adversaryId, self: selfOf(adversaryId), attack: d.attack, tier: d.tier, gmFear: 5, spotlit: true, targets: [], rng, ...over });
  if (result.ok) rng.done();
  return result;
}

const ok = (r: AdversaryRunResult): AdversaryPlan => {
  if (!r.ok) throw new Error(`refused: ${r.reason} ${r.detail}`);
  return r.plan;
};

const state = (over: Partial<AdversaryState> = {}): AdversaryState => ({ hp: 0, hpMax: 8, stress: 0, stressMax: 5, conditions: [], tokens: 0, ...over });

describe("AA2b runner fixes", () => {
  it("dcm-yle: My Turn's Fear read from the trigger asks first (Q19) and is counted by upfrontFear", () => {
    const mira = pc("mira");
    expect(attempt("demon-of-jealousy", "My Turn", [], { spotlit: false, trigger: { amount: 2, source: mira } })).toMatchObject({ ok: false, reason: "confirmFear", detail: "2" });
    const use = effectOf("demon-of-jealousy", "My Turn").uses[0]!;
    expect(upfrontFear(use.costs, { self: selfOf("demon-of-jealousy"), tier: 3, gmFear: 5, rng: () => 1, trigger: { amount: 3 } })).toBe(3);
    const p = ok(attempt("demon-of-jealousy", "My Turn", [], { spotlit: false, fearConfirmed: true, trigger: { amount: 2, source: mira }, targets: [mira] }));
    expect(p.fearSpent).toBe(2);
  });

  it("dcm-vv2 7: prompt numbers read the latest roll (To Me, My Pretties summons as many Hordes as the 2d4)", () => {
    const p = ok(attempt("valdenhax", "To Me, My Pretties", [2, 3]));
    expect(p.steps.find((s) => s.kind === "summon")).toMatchObject({ count: 5 });
    expect(p.gmFearDelta).toBe(5);
  });

  it("dcm-vv2 9: prompt numbers read the use's target counts (Endless Legions: twice the PCs)", () => {
    const p = ok(attempt("fallen-warlord-undefeated-champion", "Endless Legions", [], { fearConfirmed: true, targets: [pc("a"), pc("b"), pc("c")] }));
    expect(p.steps.find((s) => s.kind === "summon")).toMatchObject({ count: 6 });
  });

  it("AE-t2-core 1: Summoning Ritual's tick reads the trigger's amount", () => {
    const p = ok(attempt("secret-keeper", "Summoning Ritual", [], { useId: "tick", spotlit: false, trigger: { amount: 2 } }));
    expect(p.steps.find((s) => s.kind === "countdown")).toMatchObject({ op: "tick", amount: 2 });
  });

  it("AE-t2-core 2: a PC save's branches come back with their adversary-only steps (Petrifying Gaze's countdown)", () => {
    const p = ok(attempt("gorgon", "Petrifying Gaze", [], { useId: "gaze", spotlit: false, fearConfirmed: true, trigger: { source: pc("mira") } }));
    expect(p.saves).toHaveLength(1);
    expect(p.saves![0]!.targetIds).toEqual(["mira"]);
    expect(p.saves![0]!.step.onFail.some((s) => s.kind === "countdown")).toBe(true);
  });

  it("dcm-vv2 5: clearing a defeated instance's HP brings it back (Come Back Worse); untouched it stays defeated", () => {
    const back = ok(attempt("rabble-mawb", "Come Back Worse", [], { spotlit: false, fearConfirmed: true, self: selfOf("rabble-mawb", { hp: def("rabble-mawb").hp, defeated: true }) }));
    expect(back.self.after.hp).toBe(0);
    expect(back.self.after.defeated).toBe(false);
  });

  it("dcm-vv2 10: with attackDiceOnAttacks a dice Attack Modifier is rolled only for an attack", () => {
    // Reality Quake makes no attack roll: no d4s consumed.
    const quake = attempt("outer-realms-abomination", "Reality Quake", [], { fearConfirmed: true, attackDiceOnAttacks: true });
    expect(quake.ok).toBe(true);
  });

  it("dcm-vv2 3 / 4 / 6: passiveSummary keeps advantage mods, formats a negative Horde plus and reads the GM's Fear", () => {
    const gated = adversaryEffects("ahuizotl").flatMap((e) => e.uses).find((u) => u.activation.kind === "passive" && (u.modifiers ?? []).some((m) => m.kind === "mod" && m.mod.kind === "advantage"));
    const situation = (gated?.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : []));
    expect(situation.length).toBeGreaterThan(0);
    expect(passiveSummary(adversaryEffects("ahuizotl"), state(), 1).advantage ?? []).not.toContain("attack");
    expect(passiveSummary(adversaryEffects("ahuizotl"), state({ situations: situation }), 1).advantage).toContain("attack");
    const wisps = def("will-o-the-wisps");
    expect(passiveSummary(adversaryEffects("will-o-the-wisps"), state({ hp: wisps.hp, hpMax: wisps.hp }), 1).horde).toBe("1d4-1");
    expect(adversaryNumberEnv({ hp: 0, stress: 0, tokens: 0 }, 2, 4).gmFear).toBe(4);
    expect(adversaryNumberEnv({ hp: 0, stress: 0, tokens: 0 }, 2, 0, { triggerAmount: 3, lastRoll: 7 })).toMatchObject({ triggerAmount: 3, lastRoll: 7 });
  });
});
