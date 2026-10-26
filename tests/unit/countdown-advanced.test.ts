import { describe, expect, it } from "vitest";

import type { RollOutcome } from "../../src/lib/domain/duality";
import {
  chaseEnded,
  chaseNeedsDecision,
  chaseRowValues,
  chaseStart,
  chaseTicks,
  countdownNoticeText,
  countsAsActionRoll,
  manualTickAmount,
  resumeAtZero,
  rollTicks,
  startFromDice,
  tickCountdown,
  validateSteps,
  type ChasePair,
} from "../../src/lib/domain/countdowns/advanced";
import { countdownForPlayer, COUNTDOWN_VISIBILITY_PRESETS, CountdownRuleError } from "../../src/lib/domain/countdowns/index";
import { parseCountdownLabel } from "../../src/lib/domain/countdowns/labels";
import { featureCountdownLabels } from "../../src/lib/domain/environments/index";
import { ENVIRONMENTS } from "../../src/lib/srd/environments";
import { countdownDetailsSchema } from "../../src/lib/validation/countdowns";

const active = (currentValue: number, startingValue: number, extra: object = {}) => ({ currentValue, startingValue, status: "active" as const, ...extra });

describe("rollTicks (R2, R4)", () => {
  const outcomes: RollOutcome[] = ["failFear", "failHope", "successFear", "successHope", "critical"];

  it("a standard countdown ticks 1 on every action roll, whatever the result", () => {
    for (const o of outcomes) {
      expect(rollTicks("standard", o)).toBe(1);
      expect(rollTicks(undefined, o)).toBe(1);
    }
  });

  // CB p.163 Dynamic Countdown Advancement, cell by cell.
  it.each([
    ["failFear", 0, 3],
    ["failHope", 0, 2],
    ["successFear", 1, 1],
    ["successHope", 2, 0],
    ["critical", 3, 0],
  ] as const)("%s: progress %i, consequence %i", (outcome, progress, consequence) => {
    expect(rollTicks("progress", outcome)).toBe(progress);
    expect(rollTicks("consequence", outcome)).toBe(consequence);
  });

  it("long-term countdowns and rolls without Duality Dice never tick", () => {
    for (const o of outcomes) expect(rollTicks("longTerm", o)).toBe(0);
    for (const m of ["standard", "progress", "consequence", "longTerm"] as const) expect(rollTicks(m, "none")).toBe(0);
  });
});

describe("tickCountdown (R1, R6, R7, D6, D7, D8)", () => {
  it("ticks down and keeps going above 0", () => {
    expect(tickCountdown(active(4, 4), 1)).toEqual({
      next: { currentValue: 3, startingValue: 4, status: "active", triggerCount: 0 },
      triggered: false,
      reset: false,
      finished: false,
      notice: null,
    });
  });

  it("a tick larger than the value left stops at 0 and triggers (no carry-over)", () => {
    const r = tickCountdown(active(2, 6), 3);
    expect(r.next).toEqual({ currentValue: 0, startingValue: 6, status: "completed", triggerCount: 1 });
    expect(r).toMatchObject({ triggered: true, finished: true, reset: false, notice: { kind: "trigger", count: 1 } });
  });

  it("a tick of 0 changes nothing", () => {
    expect(tickCountdown(active(3, 5), 0)).toMatchObject({ next: { currentValue: 3 }, triggered: false });
  });

  it("a loop resets to its start and stays active", () => {
    const r = tickCountdown(active(1, 5, { repeat: "loop", triggerCount: 1 }), 1);
    expect(r.next).toEqual({ currentValue: 5, startingValue: 5, status: "active", triggerCount: 2 });
    expect(r).toMatchObject({ triggered: true, reset: true, finished: false, notice: { kind: "trigger", count: 2 } });
  });

  it("a loop with a rolled start reuses the value rolled (Q4)", () => {
    // startingValue holds the value rolled at creation; nothing is rolled again.
    expect(tickCountdown(active(1, 4, { repeat: "loop" }), 2).next.startingValue).toBe(4);
  });

  it("increasing: 8 resets to 9, then 10, past 20", () => {
    expect(tickCountdown(active(1, 8, { repeat: "increasing" }), 1).next).toMatchObject({ currentValue: 9, startingValue: 9 });
    expect(tickCountdown(active(1, 20, { repeat: "increasing" }), 1).next).toMatchObject({ currentValue: 21, startingValue: 21 });
  });

  it("decreasing: 8 resets to 7; at a start of 1 it ends with the major event", () => {
    expect(tickCountdown(active(1, 8, { repeat: "decreasing" }), 1).next).toMatchObject({ currentValue: 7, startingValue: 7, status: "active" });
    const end = tickCountdown(active(1, 1, { repeat: "decreasing", triggerCount: 7 }), 1);
    expect(end.next).toEqual({ currentValue: 0, startingValue: 1, status: "completed", triggerCount: 8 });
    expect(end).toMatchObject({ triggered: true, finished: true, reset: false, notice: { kind: "majorEvent", count: 8 } });
  });

  it("refuses paused, completed and cancelled countdowns and bad amounts; a correction may move a paused one", () => {
    expect(() => tickCountdown({ ...active(3, 4), status: "paused" }, 1)).toThrow(CountdownRuleError);
    expect(() => tickCountdown({ ...active(0, 4), status: "completed" }, 1)).toThrow(CountdownRuleError);
    expect(() => tickCountdown({ ...active(2, 4), status: "cancelled" }, 1)).toThrow(CountdownRuleError);
    expect(() => tickCountdown(active(3, 4), -1)).toThrow(CountdownRuleError);
    expect(() => tickCountdown(active(3, 4), 1.5)).toThrow(CountdownRuleError);
    expect(tickCountdown({ ...active(3, 4), status: "paused" }, 1, { whilePaused: true }).next).toMatchObject({ currentValue: 2, status: "paused" });
  });

  it("writes the GM notice line", () => {
    expect(countdownNoticeText("Doom", "The dam breaks", { kind: "trigger", count: 1 })).toBe("Doom triggered: The dam breaks");
    expect(countdownNoticeText("Doom", "", { kind: "trigger", count: 2 })).toBe("Doom triggered (2nd time)");
    expect(countdownNoticeText("Doom", "", { kind: "trigger", count: 13 })).toBe("Doom triggered (13th time)");
    expect(countdownNoticeText("Cave", "It collapses", { kind: "majorEvent", count: 8 })).toBe("Cave: major event: It collapses");
  });
});

describe("chase countdowns (R8, D9)", () => {
  it("the book's example: d6, the thief 3 lower; success with Hope moves the party 6 -> 4, failure with Fear the thief 3 -> 1", () => {
    expect(chaseStart(6, 3)).toEqual({ pursuers: 6, escapee: 3 });
    expect(chaseStart(6, "decent")).toEqual({ pursuers: 6, escapee: 3 });
    const pair: ChasePair = { party: { currentValue: 6, status: "active" }, rivals: { currentValue: 3, status: "active" } };
    expect(chaseTicks(pair, "successHope")).toEqual({ party: 2, rivals: 0 });
    expect(chaseTicks(pair, "failFear")).toEqual({ party: 0, rivals: 3 });
    expect(tickCountdown(active(6, 6), chaseTicks(pair, "successHope").party).next.currentValue).toBe(4);
    expect(tickCountdown(active(3, 6), 2).next.currentValue).toBe(1);
  });

  it("a success with Fear moves both rows", () => {
    const pair: ChasePair = { party: { currentValue: 6, status: "active" }, rivals: { currentValue: 3, status: "active" } };
    expect(chaseTicks(pair, "successFear")).toEqual({ party: 1, rivals: 1 });
  });

  it("leads: small 1, decent 3, substantial 5, or a typed number below the start", () => {
    expect(chaseStart(8, "small").escapee).toBe(7);
    expect(chaseStart(8, "substantial").escapee).toBe(3);
    expect(chaseStart(8, 7).escapee).toBe(1);
    expect(() => chaseStart(6, 6)).toThrow(CountdownRuleError);
    expect(() => chaseStart(4, "substantial")).toThrow(CountdownRuleError);
    expect(() => chaseStart(6, 0)).toThrow(CountdownRuleError);
    expect(() => chaseStart(1, 1)).toThrow(CountdownRuleError);
  });

  it("the PCs' row is the pursuers' when they pursue, the escapee's when they escape", () => {
    expect(chaseRowValues(6, "decent", "pursuing")).toEqual({ party: 6, rivals: 3 });
    expect(chaseRowValues(6, "decent", "escaping")).toEqual({ party: 3, rivals: 6 });
  });

  it("the chase ends when either side reaches 0, and stops ticking", () => {
    const over: ChasePair = { party: { currentValue: 2, status: "active" }, rivals: { currentValue: 0, status: "completed" } };
    expect(chaseEnded(over)).toBe(true);
    expect(chaseTicks(over, "critical")).toEqual({ party: 0, rivals: 0 });
    expect(chaseEnded({ party: { currentValue: 2, status: "active" }, rivals: { currentValue: 1, status: "active" } })).toBe(false);
  });
});

describe("countsAsActionRoll (D2, D3, R10, R11)", () => {
  const roll = (kind: "action" | "reaction" | "damage" | "free", outcome: RollOutcome = "successHope") => ({ kind, outcome });
  const pc = { logKind: "roll", undone: false };

  it("a PC's action roll counts, also one recorded as a success without a Difficulty", () => {
    expect(countsAsActionRoll(roll("action"), pc)).toBe(true);
    expect(countsAsActionRoll(roll("action", "failFear"), pc)).toBe(true);
  });

  it("reaction, damage and free rolls, GM rolls, undone rows and pending Tag Team rolls never count", () => {
    expect(countsAsActionRoll(roll("reaction"), pc)).toBe(false);
    expect(countsAsActionRoll(roll("damage", "none"), pc)).toBe(false);
    expect(countsAsActionRoll(roll("free", "none"), pc)).toBe(false);
    expect(countsAsActionRoll(roll("action"), { logKind: "gmRoll", undone: false })).toBe(false);
    expect(countsAsActionRoll(roll("action"), { ...pc, undone: true })).toBe(false);
    expect(countsAsActionRoll(roll("action"), { ...pc, tagTeam: "pending" })).toBe(false);
    expect(countsAsActionRoll(roll("action"), { ...pc, tagTeam: "result" })).toBe(true);
    expect(countsAsActionRoll(undefined, pc)).toBe(false);
  });
});

describe("parseCountdownLabel", () => {
  it.each([
    ["Countdown (Loop 1d4)", { mode: "standard", repeat: "loop", start: { kind: "dice", count: 1, sides: 4 }, longTerm: false }],
    ["Long-Term Countdown (8)", { mode: "longTerm", repeat: null, start: { kind: "fixed", value: 8 }, longTerm: true }],
    ["a Long-Term Countdown (8)", { mode: "longTerm", repeat: null, start: { kind: "fixed", value: 8 }, longTerm: true }],
    ["Countdown (Long-Term 4)", { mode: "longTerm", repeat: null, start: { kind: "fixed", value: 4 }, longTerm: true }],
    ["Progress Countdown (4)", { mode: "progress", repeat: null, start: { kind: "fixed", value: 4 }, longTerm: false }],
    ["Consequence Countdown (6)", { mode: "consequence", repeat: null, start: { kind: "fixed", value: 6 }, longTerm: false }],
    ["Countdown (Increasing 8)", { mode: "standard", repeat: "increasing", start: { kind: "fixed", value: 8 }, longTerm: false }],
    ["Countdown (Decreasing 8)", { mode: "standard", repeat: "decreasing", start: { kind: "fixed", value: 8 }, longTerm: false }],
    ["Countdown (1d6)", { mode: "standard", repeat: null, start: { kind: "dice", count: 1, sides: 6 }, longTerm: false }],
    ["Countdown (Loop 1d6)", { mode: "standard", repeat: "loop", start: { kind: "dice", count: 1, sides: 6 }, longTerm: false }],
    ["Countdown (12)", { mode: "standard", repeat: null, start: { kind: "fixed", value: 12 }, longTerm: false }],
    ["Divine Siege Countdown (10)", { mode: "standard", repeat: null, start: { kind: "fixed", value: 10 }, longTerm: false }],
  ])("%s", (label, parsed) => {
    expect(parseCountdownLabel(label)).toEqual(parsed);
  });

  it("is null for a label without a start", () => {
    expect(parseCountdownLabel("Countdown (see “Beginning of the End”)")).toBeNull();
    expect(parseCountdownLabel("Spend a Fear")).toBeNull();
  });

  it("reads every countdown label an SRD environment names", () => {
    const labels = ENVIRONMENTS.flatMap((e) => e.features.flatMap((f) => featureCountdownLabels(f)));
    expect(labels.length).toBeGreaterThan(30);
    for (const label of labels) expect(parseCountdownLabel(label), label).not.toBeNull();
    expect(labels.map((l) => parseCountdownLabel(l)!.mode)).toEqual(expect.arrayContaining(["standard", "progress", "consequence", "longTerm"]));
  });
});

describe("validateSteps (D10)", () => {
  it("returns the steps from the highest value down, trimmed", () => {
    expect(
      validateSteps(8, [
        { value: 0, text: " War " },
        { value: 6, text: "Troops gather", news: true },
        { value: 8, text: "The deal is struck", news: false },
      ]),
    ).toEqual([
      { value: 8, text: "The deal is struck" },
      { value: 6, text: "Troops gather", news: true },
      { value: 0, text: "War" },
    ]);
  });

  it("refuses values outside 0..start, two steps on one value, empty or long text and bad starts", () => {
    expect(() => validateSteps(4, [{ value: 5, text: "x" }])).toThrow(CountdownRuleError);
    expect(() => validateSteps(4, [{ value: -1, text: "x" }])).toThrow(CountdownRuleError);
    expect(() => validateSteps(4, [{ value: 2, text: "x" }, { value: 2, text: "y" }])).toThrow(CountdownRuleError);
    expect(() => validateSteps(4, [{ value: 2, text: "  " }])).toThrow(CountdownRuleError);
    expect(() => validateSteps(4, [{ value: 2, text: "x".repeat(201) }])).toThrow(CountdownRuleError);
    expect(() => validateSteps(21, [])).toThrow(CountdownRuleError);
    expect(validateSteps(20, [])).toEqual([]);
  });
});

describe("startFromDice (R5, D8)", () => {
  it("adds the dice and keeps the total within 1..max", () => {
    expect(startFromDice([3, 4], 20)).toBe(7);
    expect(startFromDice([20, 20], 20)).toBe(20);
    expect(startFromDice([], 20)).toBe(1);
  });
});

describe("countdownDetailsSchema (advanced fields)", () => {
  const base = { name: "Doom", description: "", category: "threat" as const, consequence: "" };

  it("accepts today's countdown and each new field", () => {
    expect(countdownDetailsSchema.safeParse({ ...base, startingValue: 4 }).success).toBe(true);
    expect(countdownDetailsSchema.safeParse({ ...base, startDice: { count: 2, sides: 6 }, mode: "progress", repeat: "loop", armed: true }).success).toBe(true);
    expect(
      countdownDetailsSchema.safeParse({ ...base, startingValue: 8, mode: "longTerm", steps: [{ value: 0, text: "War", news: true }], restMode: "remind" }).success,
    ).toBe(true);
  });

  it("needs exactly one of a starting value and dice", () => {
    expect(countdownDetailsSchema.safeParse(base).success).toBe(false);
    expect(countdownDetailsSchema.safeParse({ ...base, startingValue: 4, startDice: { count: 1, sides: 6 } }).success).toBe(false);
  });

  it("refuses bad dice", () => {
    expect(countdownDetailsSchema.safeParse({ ...base, startDice: { count: 5, sides: 6 } }).success).toBe(false);
    expect(countdownDetailsSchema.safeParse({ ...base, startDice: { count: 0, sides: 6 } }).success).toBe(false);
    expect(countdownDetailsSchema.safeParse({ ...base, startDice: { count: 1, sides: 7 } }).success).toBe(false);
  });

  it("long-term: no repeat, no dice; steps and restMode only for long-term; steps within 0..start, one per value, <= 200 characters", () => {
    expect(countdownDetailsSchema.safeParse({ ...base, startingValue: 8, mode: "longTerm", repeat: "loop" }).success).toBe(false);
    expect(countdownDetailsSchema.safeParse({ ...base, startDice: { count: 1, sides: 6 }, mode: "longTerm" }).success).toBe(false);
    expect(countdownDetailsSchema.safeParse({ ...base, startingValue: 8, steps: [] }).success).toBe(false);
    expect(countdownDetailsSchema.safeParse({ ...base, startingValue: 8, mode: "progress", restMode: "auto" }).success).toBe(false);
    const longTerm = (steps: unknown) => countdownDetailsSchema.safeParse({ ...base, startingValue: 4, mode: "longTerm", steps }).success;
    expect(longTerm([{ value: 5, text: "x" }])).toBe(false);
    expect(longTerm([{ value: 1, text: "x" }, { value: 1, text: "y" }])).toBe(false);
    expect(longTerm([{ value: 1, text: "x".repeat(201) }])).toBe(false);
    expect(longTerm([{ value: 1, text: "x".repeat(200) }])).toBe(true);
  });
});

describe("countdownForPlayer (D12)", () => {
  const view = {
    name: "Doom",
    description: "",
    category: "threat" as const,
    consequence: "",
    startingValue: 6,
    currentValue: 4,
    mode: "progress" as const,
    repeat: "loop" as const,
    initialValue: 6,
    triggerCount: 2,
    lastTriggeredAt: 5,
    armed: true,
    startDice: { count: 1, sides: 6 as const },
    steps: [{ value: 0, text: "War" }],
    restMode: "auto" as const,
    chase: null,
  };

  it("armed, dice, steps and the rest mode are never sent to players; the rest travels with progress", () => {
    expect(countdownForPlayer(view, COUNTDOWN_VISIBILITY_PRESETS.public)).toEqual({ ...view, armed: null, startDice: null, steps: null, restMode: null });
    expect(countdownForPlayer(view, { mode: "public", hidden: ["progress"] })).toEqual({
      ...view,
      startingValue: null,
      currentValue: null,
      mode: null,
      repeat: null,
      initialValue: null,
      triggerCount: null,
      lastTriggeredAt: null,
      armed: null,
      startDice: null,
      steps: null,
      restMode: null,
    });
  });
});

describe("K6: paused countdowns, manualTickAmount, double-zero chases", () => {
  const paused = (currentValue: number, startingValue: number, extra: object = {}) => ({ currentValue, startingValue, status: "paused" as const, ...extra });

  it("manualTickAmount: Tick -1 and a downward correction of an active countdown tick; a paused one never does", () => {
    expect(manualTickAmount({ status: "active" }, "advance", 0)).toBe(1);
    expect(manualTickAmount({ status: "active" }, "correction", -3)).toBe(3);
    expect(manualTickAmount({ status: "active" }, "correction", 2)).toBe(0);
    expect(manualTickAmount({ status: "paused" }, "correction", -3)).toBe(0);
    for (const action of ["reverse", "pause", "resume", "cancel"]) expect(manualTickAmount({ status: "active" }, action, 0)).toBe(0);
  });

  it("resumeAtZero: a loop triggers and resets, active; increasing grows; decreasing at its last loop is the major event", () => {
    expect(resumeAtZero(paused(0, 5, { repeat: "loop", triggerCount: 1 }))).toEqual({
      next: { currentValue: 5, startingValue: 5, status: "active", triggerCount: 2 },
      triggered: true,
      reset: true,
      finished: false,
      notice: { kind: "trigger", count: 2 },
    });
    expect(resumeAtZero(paused(0, 8, { repeat: "increasing" })).next).toMatchObject({ currentValue: 9, startingValue: 9, status: "active" });
    expect(resumeAtZero(paused(0, 1, { repeat: "decreasing" }))).toMatchObject({
      finished: true,
      notice: { kind: "majorEvent", count: 1 },
      next: { status: "completed" },
    });
  });

  it("resumeAtZero: a countdown that doesn't repeat completes without a trigger; anything else is refused", () => {
    expect(resumeAtZero(paused(0, 4))).toEqual({
      next: { currentValue: 0, startingValue: 4, status: "completed", triggerCount: 0 },
      triggered: false,
      reset: false,
      finished: true,
      notice: null,
    });
    expect(() => resumeAtZero(paused(2, 4))).toThrow(CountdownRuleError);
    expect(() => resumeAtZero(active(0, 4))).toThrow(CountdownRuleError);
  });

  it("chaseNeedsDecision: only both sides at 0, never a cancelled side", () => {
    const side = (currentValue: number, status: "active" | "completed" | "cancelled" = "active") => ({ currentValue, status });
    expect(chaseNeedsDecision({ party: side(0, "completed"), rivals: side(0, "completed") })).toBe(true);
    expect(chaseNeedsDecision({ party: side(0, "completed"), rivals: side(2) })).toBe(false);
    expect(chaseNeedsDecision({ party: side(0, "cancelled"), rivals: side(0, "completed") })).toBe(false);
  });

  it("chaseResult travels with progress for players", () => {
    const row = { name: "x", description: "", category: "threat" as const, consequence: "", startingValue: 6, currentValue: 0, chaseResult: "caught" as const };
    expect(countdownForPlayer(row, COUNTDOWN_VISIBILITY_PRESETS.public)?.chaseResult).toBe("caught");
    expect(countdownForPlayer(row, { mode: "public", hidden: ["progress"] })?.chaseResult).toBeNull();
  });
});
