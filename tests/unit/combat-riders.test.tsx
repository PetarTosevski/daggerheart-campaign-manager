/**
 * Attack riders (plan sheet-drawer SD5; docs/tasks/TASK-SD-SD5.md): what each rider asks (a number, an option, extra
 * targets) and the `riders` argument it sends. Plan combat-hud H8.1 deleted the classic rider toggles and the Death
 * Strike / after-roll prompts; the HUD covers them: tests/unit/hud/attack-pick.test.tsx (the attack picker's rider rows)
 * and tests/unit/hud/result-panel.test.tsx ("a damage-phase rider: …", "'Your roll waits': …", "Pass on a held roll…").
 */
import { describe, expect, it } from "vitest";

import { extraMax, pickOf, riderKey, riderProblem, ridersToSend, riseToSend, type RiderOption, type RiderPick } from "@/components/combat-map/actions/attack/riders";

import type { Id } from "../../convex/_generated/dataModel";

const tok = (s: string) => s as Id<"combatTokens">;

const base: Pick<RiderOption, "ready" | "resetLabel" | "limit" | "numbers" | "options" | "situations" | "addTargets"> = { ready: true, resetLabel: null, limit: null, numbers: [], options: [], situations: [], addTargets: null };

/** Rage Up (CB p.330): "mark a Stress … You can Rage Up twice per attack." */
const RAGE_UP: RiderOption = { ...base, source: "card", id: "rage-up", useId: "main", name: "Rage Up", phase: "before", when: "Before the roll", costs: ["X Stress"], numbers: [{ id: "n:times", label: "Times to Rage Up (a Stress each)", min: 1, max: 2 }] };
/** Hold Them Off (CB p.38): "two additional adversaries within range of the attack". */
const HOLD: RiderOption = { ...base, source: "feature", id: "hope:ranger", useId: "main", name: "Hold Them Off", phase: "after", when: "On a success", costs: ["3 Hope"], addTargets: { max: 2, range: "weapon" } };
/** Kick (CB p.58): knock back yourself or the target. */
const KICK: RiderOption = {
  ...base,
  source: "feature",
  id: "ancestry:faun:kick",
  useId: "main",
  name: "Kick",
  phase: "after",
  when: "On a success",
  costs: ["1 Stress"],
  options: [{ id: "opt:knock", label: "Knock back yourself or the target to Very Close range", options: [{ id: "self", label: "Yourself" }, { id: "target", label: "The target" }] }],
};
const USED: RiderOption = { ...base, source: "feature", id: "subclass:x:y", useId: "main", name: "Spent Feature", phase: "after", when: "On a success", costs: [], ready: false, resetLabel: "Back after a rest", limit: "Once per rest" };

const pick = (patch: Partial<RiderPick> = {}): RiderPick => ({ on: true, numbers: {}, options: {}, situations: [], extra: [], ...patch });

describe("rider picks", () => {
  it("Rage Up: toggled sends n:times at its minimum, then the number picked", () => {
    expect(ridersToSend([RAGE_UP], { "card|rage-up|main": pick() })).toEqual([{ source: "card", id: "rage-up", useId: "main", choices: [{ id: "n:times", value: 1 }] }]);
    expect(ridersToSend([RAGE_UP], { "card|rage-up|main": pick({ numbers: { "n:times": 2 } }) })[0]!.choices).toEqual([{ id: "n:times", value: 2 }]);
  });

  it("Hold Them Off: at most two more enemies as `picked`", () => {
    const three = pick({ extra: [tok("a"), tok("b"), tok("c")] });
    expect(extraMax(HOLD, three)).toBe(2);
    expect(ridersToSend([HOLD], { "feature|hope:ranger|main": three })).toEqual([{ source: "feature", id: "hope:ranger", useId: "main", choices: [{ id: "picked", value: ["a", "b"] }] }]);
  });

  it("Kick: an unanswered option blocks the attack until picked", () => {
    expect(riderProblem([KICK], { "feature|ancestry:faun:kick|main": pick() })).toBe("Kick: Knock back yourself or the target to Very Close range");
    const answered = { "feature|ancestry:faun:kick|main": pick({ options: { "opt:knock": "target" } }) };
    expect(riderProblem([KICK], answered)).toBeNull();
    expect(ridersToSend([KICK], answered)[0]!.choices).toEqual([{ id: "opt:knock", value: ["target"] }]);
  });

  it("sends nothing for an untoggled or used rider", () => {
    expect(ridersToSend([RAGE_UP, USED], { "feature|subclass:x:y|main": pick() })).toEqual([]);
    expect(riderProblem([USED], { "feature|subclass:x:y|main": pick() })).toBeNull();
  });
});

/** Rise to the Challenge (CB p.48): "While you have 2 or fewer Hit Points unmarked, you can roll a d20 as your Hope Die." */
const RISE: RiderOption = { ...base, source: "feature", id: "subclass:call-of-the-brave:rise-to-the-challenge", useId: "main", name: "Rise to the Challenge", phase: "before", when: "Before the roll", costs: [], defaultOn: true };

describe("DA2: Rise to the Challenge starts on (user 2026-10-30)", () => {
  it("starts on; nothing is sent while on, `false` once switched off", () => {
    expect(pickOf({}, RISE).on).toBe(true);
    expect(ridersToSend([RISE], {})).toEqual([]);
    expect(riseToSend([RISE], {})).toBeUndefined();
    const off = { [riderKey(RISE)]: pick({ on: false }) };
    expect(riseToSend([RISE], off)).toBe(false);
    expect(ridersToSend([RISE], off)).toEqual([]);
  });
});
