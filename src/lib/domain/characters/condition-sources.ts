import type { CONDITION_UNTIL } from "../../validation/character-constants";

/**
 * A condition's provenance in words (dcm-bxp.99.32.1; board CmpTokens "Lasting effects": "From Vicious Entangle (Moss) -
 * until it breaks free"). The sheet and the encounter instance carry an optional `conditionSources` list
 * (`{ condition, source, casterId?, until?, endsWhen? }`); the HUD's sheet panel (through `combatHud.sheet`) and the GM's
 * stat block show it when present and their static "until" otherwise. Pure: shared by the server read and the client.
 */

export type ConditionUntil = (typeof CONDITION_UNTIL)[number];

export type ConditionSourceEntry = { condition: string; source: string; until?: ConditionUntil; endsWhen?: string };

/** The stored `until` kind in words. */
export const CONDITION_UNTIL_TEXT: Record<ConditionUntil, string> = {
  temporary: "until it is cleared",
  rest: "until the next rest",
  longRest: "until the next long rest",
  session: "until the end of the session",
  scene: "until the end of the scene",
  hit: "until hit",
  nextRoll: "until the next roll",
  manual: "until it is ended",
  permanent: "for good",
};

/** "until they break free": `endsWhen` (the event in words, "until" added when it lacks one), else the kind, else null. */
export function conditionUntilText(entry: Pick<ConditionSourceEntry, "until" | "endsWhen">): string | null {
  const ends = entry.endsWhen?.trim();
  if (ends) return /^(until|for)\b/i.test(ends) ? ends : `until ${ends}`;
  return entry.until ? CONDITION_UNTIL_TEXT[entry.until] : null;
}

/** The first stored provenance of `condition`, as `{ source, until }` in words; null when none is stored. */
export function conditionProvenance(sources: readonly ConditionSourceEntry[] | undefined, condition: string): { source: string; until: string | null } | null {
  const entry = sources?.find((s) => s.condition === condition);
  return entry ? { source: entry.source, until: conditionUntilText(entry) } : null;
}

/** The stat block's line: "From Vicious Entangle (Moss) - until it breaks free" (no until: just the source). */
export function provenanceLine(p: { source: string; until: string | null }): string {
  return p.until ? `From ${p.source} - ${p.until}` : `From ${p.source}`;
}
