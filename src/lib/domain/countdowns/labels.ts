// Reads a printed countdown label ("Countdown (Loop 1d4)", "a Progress Countdown (12)", "Long-Term Countdown (8)",
// "Countdown (Increasing 8)") into the countdown it describes (plan countdowns-advanced, K0). CB p.162-164 name the
// forms: a standard "Countdown 4", progress and consequence (dynamic) countdowns, "Countdown (1d6)" (randomized start),
// "Countdown (Loop 5)", "Countdown (Increasing 8)" / "(Decreasing 8)" and long-term countdowns.
//
// ```ts
// parseCountdownLabel("Countdown (Loop 1d4)");
// // { mode: "standard", repeat: "loop", start: { kind: "dice", count: 1, sides: 4 }, longTerm: false }
// ```

import type { CountdownMode, CountdownRepeat } from "./advanced";

export type ParsedCountdownStart = { kind: "fixed"; value: number } | { kind: "dice"; count: number; sides: number };

export type ParsedCountdownLabel = {
  mode: CountdownMode;
  repeat: CountdownRepeat | null;
  start: ParsedCountdownStart;
  longTerm: boolean;
};

const LABEL = /(?:\b(progress|consequence|long-term)\s+)?countdown\s*\(\s*(?:(loop|increasing|decreasing|long-term)\s+)?(?:(\d+)\s*d\s*(\d+)|(\d+))\s*\)/i;

/** The countdown a label describes, or null when it names no start (such as "Countdown (see “Beginning of the End”)"). */
export function parseCountdownLabel(label: string): ParsedCountdownLabel | null {
  const m = LABEL.exec(label);
  if (!m) return null;
  const kind = m[1]?.toLowerCase();
  const inner = m[2]?.toLowerCase();
  const longTerm = kind === "long-term" || inner === "long-term";
  const mode: CountdownMode = longTerm ? "longTerm" : kind === "progress" ? "progress" : kind === "consequence" ? "consequence" : "standard";
  const repeat = inner === "loop" || inner === "increasing" || inner === "decreasing" ? inner : null;
  const start: ParsedCountdownStart =
    m[5] !== undefined ? { kind: "fixed", value: Number(m[5]) } : { kind: "dice", count: Number(m[3]), sides: Number(m[4]) };
  return { mode, repeat, start, longTerm };
}
