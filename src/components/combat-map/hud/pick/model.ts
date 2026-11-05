import { rangeCheck, RANGE_ORDER } from "@/lib/domain/combat-actions/distance";
import type { Range } from "@/lib/domain/card-effects/types";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { fitsSide, outOfRange, RANGE_LABEL, type Creature } from "../../actions/hand/model";
import type { TargetHint } from "../../actions/targets";
import type { PickOption, PickReach, PickRow, PickRowInput, PickRule, PickSelection, PickState } from "./types";

/**
 * The picking panel's pure model (plan combat-hud H3.0). The rows reuse the classic rules, never a copy: who fits a
 * side and whether a creature is out of a card's range come from the Hand model (`fitsSide`, `outOfRange`, the same
 * check the server's card runner makes), a weapon's reach and line of sight from `combatActionsReads.targets` (the server's
 * hints), the band from the engine's `rangeCheck`. No React here, so the unit tests read it directly.
 */

/** A creature the rows can list: the Hand model's creature plus its condition names (answer 10a). */
export type PickCreature = Creature & { conditions?: readonly string[] };

const BAND_WORD: Record<Range, string> = {
  melee: "Melee",
  veryClose: "Very Close",
  close: "Close",
  far: "Far",
  veryFar: "Very Far",
};

export function bandLabel(band: Range | null): string | null {
  return band === null ? null : BAND_WORD[band];
}

/** "Pick 1 target within Far", "Pick up to 3 allies within Close", "Pick any number of targets in your weapon's range". */
export function ruleText(rule: Pick<PickRule, "side" | "max" | "range" | "text">): string {
  if (rule.text) return rule.text;
  const noun = (n: number | null) => {
    const one = rule.side === "ally" ? "ally" : rule.side === "selfOrAlly" ? "ally or yourself" : "target";
    const many = rule.side === "ally" ? "allies" : rule.side === "selfOrAlly" ? "allies or yourself" : "targets";
    return n === 1 ? one : many;
  };
  const count = rule.max === null ? `any number of ${noun(null)}` : rule.max === 1 ? `1 ${noun(1)}` : `up to ${rule.max} ${noun(rule.max)}`;
  const reach =
    rule.range === "weapon" ? "in your weapon’s range" : rule.range === "unlimited" ? "at any range" : `within ${RANGE_LABEL[rule.range] ?? rule.range}`;
  return `Pick ${count} ${reach}`;
}

const REACH_ORDER: Record<PickReach, number> = { in: 0, out: 1, los: 2 };

/**
 * The rows of a session: every creature that fits the rule's side, with its band and reach.
 * - `los`: the server's hint says no line of sight (Q2: never picked; "Can't see").
 * - `out`: a weapon range: the hint's `inRange` is false; a band: the Hand model's `outOfRange` (the card runner's check,
 *   anchored areas included). Out of range stays pickable: the GM approves (Q1).
 * Ordered in reach, then out of range, then out of sight, nearest first in each; the order never changes with a pick.
 */
export function buildRows({
  creatures,
  rule,
  hints,
  picked,
}: {
  creatures: readonly PickCreature[];
  rule: PickRule;
  /** `combatActionsReads.targets` for the actor (enemies it sees); undefined while loading or for no PC actor. */
  hints: readonly TargetHint[] | undefined;
  picked: readonly string[];
}): PickRow[] {
  const actor = creatures.find((c) => c.side === "self");
  const byHint = new Map<string, TargetHint>((hints ?? []).map((h) => [h.tokenId, h]));
  const rows: (PickRow & { distance: number })[] = [];
  for (const c of creatures) {
    if (!fitsSide(c, rule.side)) continue;
    const hint = byHint.get(c.tokenId);
    const check = c.side !== "self" && actor?.at !== undefined && c.at !== undefined ? rangeCheck(actor.at, c.at, "unlimited") : null;
    const band: Range | null = hint?.band ?? check?.band ?? (c.side === "self" ? "melee" : null);
    let reach: PickReach = "in";
    if (hint && !hint.lineOfSight) reach = "los";
    else if (rule.range === "weapon") reach = hint && !hint.inRange ? "out" : "in";
    else if (outOfRange(rule, creatures, picked, c)) reach = "out";
    rows.push({ tokenId: c.tokenId, name: c.side === "self" ? "You" : c.name, side: c.side, band, reach, conditions: c.conditions ?? [], distance: check?.distance ?? 0 });
  }
  rows.sort((a, b) => REACH_ORDER[a.reach] - REACH_ORDER[b.reach] || a.distance - b.distance);
  return rows.map((r) => ({ tokenId: r.tokenId, name: r.name, side: r.side, band: r.band, reach: r.reach, conditions: r.conditions }));
}

/** A picker's own rows with the defaults filled in. */
export function rowsFrom(input: readonly PickRowInput[]): PickRow[] {
  return input.map((r) => ({ ...r, conditions: r.conditions ?? [] }));
}

/** A row's state: picked wins over its reach (an out-of-range pick shows picked on the row, amber on the ring). */
export function stateOf(row: Pick<PickRow, "tokenId" | "reach">, picked: readonly string[]): PickState {
  return picked.includes(row.tokenId) ? "picked" : row.reach;
}

/** Whether a tap on the row or ring may change the pick. */
export function canToggle(row: Pick<PickRow, "reach">, rule: Pick<PickRule, "locked">): boolean {
  return !rule.locked && row.reach !== "los";
}

/**
 * The picks after a tap on `tokenId`. Single (`max` 1): a tap replaces the pick, a tap on the picked one clears it.
 * Several: adds or removes; past `max` the tap is ignored. Out-of-sight rows and locked sessions never change.
 */
export function togglePick(picked: readonly Id<"combatTokens">[], tokenId: Id<"combatTokens">, rule: Pick<PickRule, "max" | "locked">, row: Pick<PickRow, "reach"> | undefined): Id<"combatTokens">[] {
  if (!row || !canToggle(row, rule)) return [...picked];
  const on = picked.includes(tokenId);
  if (rule.max === 1) return on ? [] : [tokenId];
  if (on) return picked.filter((id) => id !== tokenId);
  if (rule.max !== null && picked.length >= rule.max) return [...picked];
  return [...picked, tokenId];
}

/** The picks the rows still allow (a token that left the view or the side drops out; out of sight is never kept). */
export function keepPicks(picked: readonly Id<"combatTokens">[], rows: readonly PickRow[]): Id<"combatTokens">[] {
  const ok = new Map(rows.map((r) => [r.tokenId as string, r]));
  return picked.filter((id) => {
    const row = ok.get(id);
    return row !== undefined && row.reach !== "los";
  });
}

/** The option values a session starts with. */
export function initialOptions(options: readonly PickOption[] | undefined): Record<string, boolean> {
  return Object.fromEntries((options ?? []).map((o) => [o.id, o.defaultOn === true]));
}

export function selectionOf(rows: readonly PickRow[], picked: readonly Id<"combatTokens">[], options: Readonly<Record<string, boolean>>): PickSelection {
  const byId = new Map(rows.map((r) => [r.tokenId as string, r]));
  const targets = picked.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  return {
    targets,
    targetIds: targets.map((t) => t.tokenId),
    outOfRange: targets.some((t) => t.reach === "out"),
    options,
  };
}

/** Why the primary can't send: too few picks, or the picker's own reason. */
export function primaryProblem(selection: PickSelection, rule: Pick<PickRule, "min" | "max" | "side">, blocked: string | null): string | null {
  const min = rule.min ?? 1;
  if (selection.targets.length < min) return min === 1 ? `Pick ${rule.side === "ally" ? "an ally" : "a target"} first` : `Pick at least ${min}`;
  return blocked;
}

/**
 * Whether the GM's spotlight holds this session back (H6.2, answer 1c): a player's new action waits while the GM holds
 * it (`combatSpotlight.state.reactionsOnly`); a reaction, a step of a use under way (`followUp`) and the GM's own
 * adversary sessions never do.
 */
export function spotlightBlocks(reactionsOnly: boolean, spec: { source: { kind: string }; followUp?: boolean }): boolean {
  return reactionsOnly && spec.followUp !== true && spec.source.kind !== "reaction" && spec.source.kind !== "adversary";
}

/** The picker counter (CmpBlocked "picker counter"): "1 of 2" while several may be picked; null for one or any number. */
export function pickCount(picked: number, rule: Pick<PickRule, "max" | "locked">): { text: string; full: boolean } | null {
  if (rule.locked || rule.max === null || rule.max <= 1) return null;
  return { text: `${picked} of ${rule.max}`, full: picked >= rule.max };
}

/**
 * How a refusal marks the ring of the target it names (CmpBlocked "Shown before the click as"): BAD_TARGET dims it,
 * no line of sight makes it dotted, out of reach puts the hint below it. Null when the refusal names no target or
 * has no ring form.
 */
export function refusedRing(
  refused: { refusal: { before: readonly string[]; lead: string }; tokenId: Id<"combatTokens"> | null } | null,
): { tokenId: Id<"combatTokens">; form: "dimmed" | "dotted" | "hint"; text: string } | null {
  if (!refused || refused.tokenId === null) return null;
  const { before, lead } = refused.refusal;
  const form = before.includes("ring-dotted") ? "dotted" : before.includes("ring-hint") ? "hint" : before.includes("ring-dimmed") ? "dimmed" : null;
  return form ? { tokenId: refused.tokenId, form, text: lead } : null;
}

/** The footer line when a pick is out of range (HANDOFF hard rule 3). */
export const GM_APPROVES_LINE = "Out of range: the GM approves first. Nothing is rolled or paid until then.";

/** The rows' status words (CmpPicking): out of range "GM approves", out of sight "Can't see". */
export const STATE_WORD: Record<Exclude<PickState, "in">, string> = {
  picked: "Picked",
  out: "GM approves",
  los: "Can’t see",
};

/** A row's accessible name: "Jagged Knife Sniper, Very Far, out of range: the GM approves, Vulnerable". */
export function rowLabel(row: PickRow, state: PickState): string {
  const parts = [row.name];
  const band = bandLabel(row.band);
  if (band && row.side !== "self") parts.push(band);
  if (row.reach === "out") parts.push("out of range: the GM approves");
  if (row.reach === "los") parts.push("no line of sight: can’t be picked");
  if (row.conditions.length > 0) parts.push(row.conditions.join(", "));
  if (state === "picked") parts.push("picked");
  return parts.join(", ");
}

/** The ring's band label above the token (CmpTokens "Target rings"): the band, or "No line of sight". */
export function ringLabel(row: PickRow): string | null {
  if (row.reach === "los") return "No line of sight";
  return row.side === "self" ? "You" : bandLabel(row.band);
}

/** The display name of a condition id ("vulnerable" → "Vulnerable"), as HD1's labels read. */
export function conditionName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Bands nearest first (for a picker that builds its own rows). */
export const BANDS = RANGE_ORDER;

// ---------------------------------------------------------------- Waiting for the GM (CmpPromptsPlayer)

/** One use waiting on the GM's approval, from any of the three open-request reads. */
export type WaitingUse = {
  requestId: Id<"combatRequests">;
  characterId: Id<"characters">;
  /** "Vicious Entangle", "Rally", "Attack". */
  use: string;
  createdAt: number;
  targets: readonly { tokenId: Id<"combatTokens">; name: string }[];
  outOfRange: readonly { tokenId: Id<"combatTokens">; band: Range }[];
};

type Sanctioned = { requestId: Id<"combatRequests">; characterId: Id<"characters">; createdAt: number; targets: readonly { tokenId: Id<"combatTokens">; name: string }[]; outOfRange: readonly { tokenId: Id<"combatTokens">; band: Range }[] };

/** The caller's uses waiting for the GM: attacks (`combatRequestsReads.mine` sanctions), cards and features, oldest first. */
export function waitingUses({
  attacks,
  cards,
  features,
  characterId,
}: {
  /** The attack sanctions of `combatRequestsReads.mine` (its other kinds filtered out by the caller). */
  attacks: readonly Sanctioned[] | undefined;
  cards: readonly (Sanctioned & { cardName: string })[] | undefined;
  features: readonly (Sanctioned & { featureName: string })[] | undefined;
  /** Only this character's (null: all the caller's). */
  characterId: Id<"characters"> | null;
}): WaitingUse[] {
  const out: WaitingUse[] = [];
  const pick = ({ requestId, characterId: c, createdAt, targets, outOfRange: away }: Sanctioned, use: string) =>
    out.push({ requestId, characterId: c, use, createdAt, targets, outOfRange: away });
  for (const a of attacks ?? []) pick(a, "Attack");
  for (const c of cards ?? []) pick(c, c.cardName);
  for (const f of features ?? []) pick(f, f.featureName);
  return out.filter((w) => characterId === null || w.characterId === characterId).sort((a, b) => a.createdAt - b.createdAt);
}

/** "Jagged Knife Sniper is Very Far." for every out-of-range target (names and bands only, U1). */
export function waitingReason(w: Pick<WaitingUse, "targets" | "outOfRange">): string {
  const names = new Map(w.targets.map((t) => [t.tokenId as string, t.name]));
  const lines = w.outOfRange.map((o) => `${names.get(o.tokenId) ?? "The target"} is ${BAND_WORD[o.band]}.`);
  return lines.length > 0 ? lines.join(" ") : "It is out of range.";
}

/** A box on screen, relative to the pop region. */
export type Box = { left: number; top: number; right: number; bottom: number };

/**
 * The panel's top, kept clear of the HUD's fixed controls (dcm-bxp.99.32.22: a player's map controls, Zoom out
 * first): a control the panel's columns would cover pushes the panel below it. The edge stays the floor.
 */
export function clearTop(y: number, x: number, width: number, obstacles: readonly Box[], edge: number): number {
  let top = edge;
  for (const o of obstacles) {
    if (o.right <= x || o.left >= x + width) continue;
    if (o.bottom <= top) continue;
    top = Math.max(top, o.bottom + edge);
  }
  return Math.max(y, top);
}
