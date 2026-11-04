/**
 * Plan lanes-2 wave 10, tracer E6.4 (docs/tasks/TASK-LN4-E6.md): the pure halves of a sheet effect's stored caster
 * (dcm-lztq) and target instance (dcm-qxb6) in src/lib/domain/characters/expiry.ts.
 *
 * Book: Eye of the Storm (Skykin, HF p.23) "until you take Severe damage"; Marked for Death (Assassin, HF p.8) "This
 * condition lasts until you take a rest, the current adversary Marked for Death is defeated, ...".
 */
import { describe, expect, it } from "vitest";

import { defeatEnds, madeByCaster, withCasterOnNew } from "../../src/lib/domain/characters/expiry";
import type { Effect } from "../../src/lib/validation/characters";

const fx = (id: string, extra: Partial<Effect> = {}): Effect => ({ id, source: "Test", text: id, until: "manual", ...extra });

describe("madeByCaster (dcm-lztq)", () => {
  const never = () => {
    throw new Error("the guess is only for effects without a stored caster");
  };

  it("a stored caster decides: equal to the known caster's id", () => {
    expect(madeByCaster(fx("a", { casterId: "sky" }), { id: "sky", holds: true }, new Set(), never)).toBe(true);
    expect(madeByCaster(fx("a", { casterId: "twin" }), { id: "sky", holds: true }, new Set(), never)).toBe(false);
    // A known caster who no longer holds the card still made it.
    expect(madeByCaster(fx("a", { casterId: "sky" }), { id: "sky", holds: false }, new Set(), never)).toBe(true);
  });

  it("caster id unknown: a stored caster naming another member is theirs; otherwise the caster's when they hold the source", () => {
    expect(madeByCaster(fx("a", { casterId: "twin" }), { holds: true }, new Set(["twin", "ash"]), never)).toBe(false);
    expect(madeByCaster(fx("a", { casterId: "sky" }), { holds: true }, new Set(["twin", "ash"]), never)).toBe(true);
    expect(madeByCaster(fx("a", { casterId: "sky" }), { holds: false }, new Set(["twin", "ash"]), never)).toBe(false);
  });

  it("no stored caster (an effect from before): the old guess", () => {
    expect(madeByCaster(fx("a"), { id: "sky", holds: true }, new Set(), () => true)).toBe(true);
    expect(madeByCaster(fx("a"), { id: "sky", holds: true }, new Set(), () => false)).toBe(false);
  });
});

describe("defeatEnds (dcm-qxb6)", () => {
  it("an effect naming its instance ends only on that instance's defeat, tag or not", () => {
    expect(defeatEnds(fx("m", { targetInstanceId: "bear" }), "bear", true)).toBe(true);
    expect(defeatEnds(fx("m", { targetInstanceId: "bear" }), "wolf", true)).toBe(false);
    expect(defeatEnds(fx("m", { targetInstanceId: "bear" }), "bear", false)).toBe(true);
  });

  it("without a target (stored before) or without the defeated id: the tag link", () => {
    expect(defeatEnds(fx("m"), "bear", true)).toBe(true);
    expect(defeatEnds(fx("m"), "bear", false)).toBe(false);
    expect(defeatEnds(fx("m", { targetInstanceId: "bear" }), undefined, true)).toBe(true);
  });
});

describe("withCasterOnNew (dcm-lztq, D5 writer)", () => {
  it("stamps new and rewritten effects without a caster, leaves the rest", () => {
    const kept = fx("keep");
    const other = fx("theirs", { casterId: "ash" });
    const before = { effects: [kept, fx("marked-for-death", { text: "Bear" }), other] };
    const after = { effects: [kept, fx("marked-for-death", { text: "Wolf" }), other, fx("get-in-get-out")] };
    const out = withCasterOnNew(before, after, "sky");
    expect(out.effects.map((e) => [e.id, e.casterId])).toEqual([
      ["keep", undefined],
      ["marked-for-death", "sky"],
      ["theirs", "ash"],
      ["get-in-get-out", "sky"],
    ]);
    // Nothing new: the same object.
    expect(withCasterOnNew(before, before, "sky")).toBe(before);
  });
});
