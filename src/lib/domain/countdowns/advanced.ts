// Countdown types and advanced features (plan countdowns-advanced, K0): how much a counted action roll ticks a
// countdown, what happens when it reaches 0 (trigger, loop / increasing / decreasing reset, the decreasing countdown's
// major event), chase pairs, long-term tracks and which rolls count. Pure and framework-free: the server's one tick path
// (convex/lib/countdownTicks.ts) and the client's optimistic updates both call these, so no rule has a second copy.
//
// Core Book p.162: "When the countdown ticks down from 1 to 0 (which doesn't appear on the die), the countdown ends and
//   triggers the event you were counting down to." / standard countdown: "ticks down every time a player makes an action
//   roll, regardless of the result."
// Core Book p.163: the Dynamic Countdown Advancement table (DYNAMIC_ADVANCEMENT below), Loop, Increasing or Decreasing,
//   Randomized Starting Value and Chase Countdowns.
// Core Book p.164: long-term countdowns, "usually between 4 and 12 ticks", a step written per box.
// Core Book p.97: "A Tag Team Roll counts as a single action roll for the purposes of any countdowns".
// Core Book p.99: reaction rolls "don't generate Hope, Fear, or additional GM moves" (they are not action rolls).
//
// ```ts
// rollTicks("consequence", "failFear"); // 3
// tickCountdown({ startingValue: 5, currentValue: 1, status: "active", repeat: "loop" }, 1);
// // { next: { currentValue: 5, startingValue: 5, status: "active", triggerCount: 1 }, triggered: true, reset: true, ... }
// chaseStart(6, "decent"); // { pursuers: 6, escapee: 3 }
// ```

import type { RollOutcome, RollRecord } from "../duality";
import { CountdownRuleError, type CountdownStatus } from "./index";

/** absent = standard (D1). */
export const COUNTDOWN_MODES = ["standard", "progress", "consequence", "longTerm"] as const;
export type CountdownMode = (typeof COUNTDOWN_MODES)[number];

/** absent = the countdown does not repeat (R6, R7). */
export const COUNTDOWN_REPEATS = ["loop", "increasing", "decreasing"] as const;
export type CountdownRepeat = (typeof COUNTDOWN_REPEATS)[number];

/** A long-term countdown on a finished long rest (user answer Q3): ticks by itself, or only reminds the GM. absent = auto. */
export const COUNTDOWN_REST_MODES = ["auto", "remind"] as const;
export type CountdownRestMode = (typeof COUNTDOWN_REST_MODES)[number];

/** The dice a randomized start may use (R5): 1-4 of one standard die. */
export const COUNTDOWN_DICE_SIDES = [4, 6, 8, 10, 12, 20] as const;
export type CountdownDiceSides = (typeof COUNTDOWN_DICE_SIDES)[number];
export const MAX_COUNTDOWN_DICE = 4;
export type CountdownStartDice = { count: number; sides: CountdownDiceSides };

/** An increasing countdown's start grows past MAX_COUNTDOWN_START (D7), up to this. */
export const MAX_REPEAT_START = 100;

/** Long-term tracks (D10): one optional step per value from the start down to 0. */
export const MAX_LONG_TERM_START = 20;
export const MAX_COUNTDOWN_STEPS = MAX_LONG_TERM_START + 1;
export const COUNTDOWN_STEP_TEXT_MAX = 200;
export type CountdownStep = { value: number; text: string; news?: boolean };

/** Chase leads (R8): "1 lower for a small lead, 3 lower for a decent lead, 5 lower for a substantial lead". */
export const CHASE_LEADS = { small: 1, decent: 3, substantial: 5 } as const;
export type ChaseLeadSize = keyof typeof CHASE_LEADS;
export type ChaseLead = ChaseLeadSize | number;
export type ChaseSide = "party" | "rivals";
export type ChaseRole = "pursuing" | "escaping";

type DynamicOutcome = Exclude<RollOutcome, "none">;

/** CB p.163, Dynamic Countdown Advancement: ticks per PC action roll, progress / consequence (R4). */
export const DYNAMIC_ADVANCEMENT: Record<DynamicOutcome, { progress: number; consequence: number }> = {
  failFear: { progress: 0, consequence: 3 },
  failHope: { progress: 0, consequence: 2 },
  successFear: { progress: 1, consequence: 1 },
  successHope: { progress: 2, consequence: 0 },
  critical: { progress: 3, consequence: 0 },
};

/**
 * How far one counted action roll ticks a countdown of this mode: 1 for standard (R2, whatever the result), the R4 table
 * for progress and consequence, 0 for long-term (it ticks on long rests, R9) and for a roll without Duality Dice.
 * An absent mode is standard (D1).
 */
export function rollTicks(mode: CountdownMode | undefined, outcome: RollOutcome): number {
  if (outcome === "none" || mode === "longTerm") return 0;
  if (mode === "progress" || mode === "consequence") return DYNAMIC_ADVANCEMENT[outcome][mode];
  return 1;
}

/** The state tickCountdown reads. The optional fields are the stored row's; absent means today's countdown. */
export type TickableCountdown = {
  startingValue: number;
  currentValue: number;
  status: CountdownStatus;
  repeat?: CountdownRepeat;
  triggerCount?: number;
};

/** What a tick changes: the value, the current cycle's start (a reset moves it), the status and the trigger count. */
export type CountdownTickState = { currentValue: number; startingValue: number; status: CountdownStatus; triggerCount: number };

export type CountdownTickNotice = { kind: "trigger" | "majorEvent"; count: number };

export type CountdownTickResult = {
  next: CountdownTickState;
  /** The countdown reached 0 on this tick. */
  triggered: boolean;
  /** A repeating countdown went back to a start and stays active. */
  reset: boolean;
  /** It completed (a countdown that does not repeat, or the decreasing countdown's last loop). */
  finished: boolean;
  /** Set on a trigger: the feed notice to write (D7). */
  notice: CountdownTickNotice | null;
};

/** The start a repeating countdown resets to after a trigger, or null when it ends instead (R6, R7, D7, D8). */
export function nextCycleStart(repeat: CountdownRepeat, startingValue: number): number | null {
  if (repeat === "loop") return startingValue; // a rolled start is reused, never rolled again (Q4)
  if (repeat === "increasing") return Math.min(MAX_REPEAT_START, startingValue + 1);
  return startingValue - 1 > 0 ? startingValue - 1 : null; // "Once a decreasing countdown reaches 0, a major event triggers"
}

/**
 * Ticks an active countdown down by `amount` (D6: a tick larger than the value left stops at 0; it does not carry over).
 * Reaching 0 triggers (R1): a countdown that does not repeat completes; a loop resets to its start, an increasing one to
 * start + 1 and a decreasing one to start - 1, staying active (Q2); a decreasing countdown whose next start would be 0
 * completes with the major event (R7). `whilePaused` lets a GM's correction move a paused countdown (E1).
 */
export function tickCountdown(state: TickableCountdown, amount: number, options: { whilePaused?: boolean } = {}): CountdownTickResult {
  if (!Number.isInteger(amount) || amount < 0) throw new CountdownRuleError("A tick must be a whole number of at least 0.");
  const open = state.status === "active" || (options.whilePaused === true && state.status === "paused");
  if (!open) throw new CountdownRuleError("Only an active countdown ticks.");
  const triggerCount = state.triggerCount ?? 0;
  const same = { currentValue: state.currentValue, startingValue: state.startingValue, status: state.status, triggerCount };
  if (amount === 0 || state.currentValue === 0) return { next: same, triggered: false, reset: false, finished: false, notice: null };
  const currentValue = Math.max(0, state.currentValue - amount);
  if (currentValue > 0) return { next: { ...same, currentValue }, triggered: false, reset: false, finished: false, notice: null };

  const count = triggerCount + 1;
  const start = state.repeat === undefined ? null : nextCycleStart(state.repeat, state.startingValue);
  if (start === null) {
    const majorEvent = state.repeat === "decreasing";
    return {
      next: { currentValue: 0, startingValue: state.startingValue, status: "completed", triggerCount: count },
      triggered: true,
      reset: false,
      finished: true,
      notice: { kind: majorEvent ? "majorEvent" : "trigger", count },
    };
  }
  return {
    next: { currentValue: start, startingValue: start, status: "active", triggerCount: count },
    triggered: true,
    reset: true,
    finished: false,
    notice: { kind: "trigger", count },
  };
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** The GM's feed line for a trigger (D7): "Doom triggered (2nd time): The dam breaks", or the decreasing major event. */
export function countdownNoticeText(name: string, consequence: string, notice: CountdownTickNotice): string {
  const head = notice.kind === "majorEvent" ? `${name}: major event` : notice.count > 1 ? `${name} triggered (${ordinal(notice.count)} time)` : `${name} triggered`;
  return consequence.trim() === "" ? head : `${head}: ${consequence.trim()}`;
}

/** A chase pair's two rows as the rules read them (D9). */
export type ChasePair = { party: { currentValue: number; status: CountdownStatus }; rivals: { currentValue: number; status: CountdownStatus } };

/** The chase is over when either side reached 0 (or the pair was cancelled); it moves again once the GM reopens it (D9). */
export function chaseEnded(pair: ChasePair): boolean {
  const over = (row: ChasePair["party"]) => row.currentValue <= 0 || row.status === "completed" || row.status === "cancelled";
  return over(pair.party) || over(pair.rivals);
}

/**
 * Ticks for both rows of a chase from one counted roll (R8): the PCs' row is a progress countdown, the rivals' a
 * consequence countdown, whether the PCs pursue or escape. Nothing once the chase has ended.
 */
export function chaseTicks(pair: ChasePair, outcome: RollOutcome): { party: number; rivals: number } {
  if (chaseEnded(pair)) return { party: 0, rivals: 0 };
  return { party: rollTicks("progress", outcome), rivals: rollTicks("consequence", outcome) };
}

/** A lead size in ticks; a typed lead is a whole number. */
export function chaseLeadTicks(lead: ChaseLead): number {
  return typeof lead === "number" ? lead : CHASE_LEADS[lead];
}

/**
 * The two starting positions (R8): both dice share the start N; the pursuers sit at N, the escapee N - lead. The lead
 * must leave the escapee above 0 (1..N-1). Book example: chaseStart(6, 3) is { pursuers: 6, escapee: 3 }.
 */
export function chaseStart(start: number, lead: ChaseLead): { pursuers: number; escapee: number } {
  const ticks = chaseLeadTicks(lead);
  if (!Number.isInteger(start) || start < 2) throw new CountdownRuleError("A chase starts at 2 or more.");
  if (!Number.isInteger(ticks) || ticks < 1 || ticks >= start) throw new CountdownRuleError("The lead must be at least 1 and below the start.");
  return { pursuers: start, escapee: start - ticks };
}

/** Where each side of a chase starts, from the PCs' role. */
export function chaseRowValues(start: number, lead: ChaseLead, role: ChaseRole): Record<ChaseSide, number> {
  const { pursuers, escapee } = chaseStart(start, lead);
  return role === "pursuing" ? { party: pursuers, rivals: escapee } : { party: escapee, rivals: pursuers };
}

/** Which row of the log a roll sits on, for countsAsActionRoll. */
export type CountedRollContext = {
  /** The actionLog row's kind ("roll" = a PC's roll; "gmRoll" = the GM's, never counted). */
  logKind: string;
  /** The row was undone. */
  undone: boolean;
  /** A Tag Team roll still waiting for its pick is not counted; the applied result counts once for the pair (R10). */
  tagTeam?: "pending" | "result";
};

/**
 * Whether a logged roll advances countdowns (D2, D3): a PC's action roll, as recorded (a roll without a Difficulty is
 * recorded as a success and counts). Never reaction rolls (R11), damage or free rolls, GM rolls, pending Tag Team rolls
 * or undone rows.
 */
export function countsAsActionRoll(roll: Pick<RollRecord, "kind" | "outcome"> | undefined, context: CountedRollContext): boolean {
  if (roll === undefined || context.undone || context.logKind !== "roll" || context.tagTeam === "pending") return false;
  return roll.kind === "action" && roll.outcome !== "none";
}

/**
 * Checks a long-term track (D10) against its start and returns it from the highest value down: at most one step per value,
 * values whole numbers in 0..start, text trimmed, 1-200 characters.
 */
export function validateSteps(start: number, steps: readonly CountdownStep[]): CountdownStep[] {
  if (!Number.isInteger(start) || start < 1 || start > MAX_LONG_TERM_START) {
    throw new CountdownRuleError(`A long-term countdown starts between 1 and ${MAX_LONG_TERM_START}.`);
  }
  if (steps.length > MAX_COUNTDOWN_STEPS) throw new CountdownRuleError("Too many steps.");
  const seen = new Set<number>();
  const out = steps.map((step) => {
    if (!Number.isInteger(step.value) || step.value < 0 || step.value > start) throw new CountdownRuleError("A step must sit between 0 and the start.");
    if (seen.has(step.value)) throw new CountdownRuleError("Only one step per value.");
    seen.add(step.value);
    const text = step.text.trim();
    if (text === "") throw new CountdownRuleError("A step needs text.");
    if (text.length > COUNTDOWN_STEP_TEXT_MAX) throw new CountdownRuleError(`Steps cannot exceed ${COUNTDOWN_STEP_TEXT_MAX} characters.`);
    return step.news === true ? { value: step.value, text, news: true } : { value: step.value, text };
  });
  return out.sort((a, b) => b.value - a.value);
}

/** The total of a randomized start (R5) from the dice rolled, kept within 1..max (D8). */
export function startFromDice(rolled: readonly number[], max: number): number {
  const total = rolled.reduce((a, b) => a + b, 0);
  return Math.min(max, Math.max(1, total));
}
