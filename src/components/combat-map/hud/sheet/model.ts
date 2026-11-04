import type { FunctionReturnType } from "convex/server";

import { applyResourceDelta } from "@/lib/domain/characters";
import { CONDITIONS } from "@/lib/validation/characters";

import type { api } from "../../../../../convex/_generated/api";
import { D5_USES, REST_TIME_FEATURES } from "../../drawer/list/model";

/**
 * The sheet panel's pure parts (plan combat-hud H2.1; boards Main 'D · Sheet at hand', GMDesktop): who may do what in
 * each mode, the tracker lines (answer 2: "n of 6 marked"), each feature's right-hand control, and the optimistic
 * updates of the trackers and conditions on `combatHud.sheet` and `combatHud.party` (rule 12).
 */

export type HudSheetData = FunctionReturnType<typeof api.combatHud.sheet>;
export type HudSheetFeature = HudSheetData["features"][number];
export type HudSheetUse = NonNullable<HudSheetFeature["uses"]>[number];
export type HudSheetMode = HudSheetData["mode"];
type PartyRow = FunctionReturnType<typeof api.combatHud.party>[number];

export type TrackerResource = "hp" | "stress" | "hope" | "armor";
export const TRACKER_ORDER: readonly TrackerResource[] = ["hp", "stress", "hope", "armor"];

/** The group name, the board's short label and one slot's noun. */
export const TRACKERS: Record<TrackerResource, { name: string; short: string; one: string }> = {
  hp: { name: "Hit Points", short: "HP", one: "Hit Point" },
  stress: { name: "Stress", short: "Stress", one: "Stress" },
  hope: { name: "Hope", short: "Hope", one: "Hope" },
  armor: { name: "Armor Slots", short: "Armor", one: "Armor Slot" },
};

/**
 * What the caller may do on this sheet (answers 4a / 5a):
 * - `own`: the character's player (or an edit grant): trackers, conditions, feature Use, "Hide my hand".
 * - `gm`: trackers and conditions always; feature Use (and the cards) only with "Play for this character" on.
 * - `view`: any other member: reads everything, changes nothing.
 */
export function sheetRights(mode: HudSheetMode, playingFor: boolean): { edit: boolean; use: boolean; hideHand: boolean } {
  if (mode === "own") return { edit: true, use: true, hideHand: true };
  if (mode === "gm") return { edit: true, use: playingFor, hideHand: false };
  return { edit: false, use: false, hideHand: false };
}

/** The badge right of the name (Main 'Spotlight', 'View only'; GMDesktop 'GM edit'); null: none. */
export function sheetBadge(mode: HudSheetMode, holdsSpotlight: boolean): { text: string; tone: "spot" | "ro" | "gm" } | null {
  if (mode === "view") return { text: "View only", tone: "ro" };
  if (mode === "gm") return { text: "GM edit", tone: "gm" };
  return holdsSpotlight ? { text: "Spotlight", tone: "spot" } : null;
}

/** Filled / max of a tracker, and its number in words (answer 2: HP, Stress and Armor read "n of 6 marked"). */
export function trackerOf(t: HudSheetData["trackers"], r: TrackerResource): { value: number; max: number; text: string } {
  if (r === "hope") return { value: t.hope.value, max: t.hope.max, text: `${t.hope.value} of ${t.hope.max}` };
  const track = t[r];
  return { value: track.marked, max: track.max, text: `${track.marked} of ${track.max} marked` };
}

/** Pips lit: HP and Armor show what is left (answer 2, as the banners and rings), Stress what is marked, Hope what is held. */
export function pipsOn(t: HudSheetData["trackers"], r: TrackerResource): number {
  if (r === "hp") return t.hp.max - t.hp.marked;
  if (r === "armor") return t.armor.max - t.armor.marked;
  if (r === "stress") return t.stress.marked;
  return t.hope.value;
}

/** The step buttons' names: "Mark 1 Hit Point" / "Clear 1 Hit Point", "Gain 1 Hope" / "Spend 1 Hope". */
export function stepLabel(r: TrackerResource, delta: -1 | 1): string {
  if (r === "hope") return delta > 0 ? "Gain 1 Hope" : "Spend 1 Hope";
  return `${delta > 0 ? "Mark" : "Clear"} 1 ${TRACKERS[r].one}`;
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

type Trackers = HudSheetData["trackers"];

/** The trackers after one step, as `characters.adjustResource` computes them (Stress past full marks a Hit Point, CB p.106). */
export function applyStep(t: Trackers, r: TrackerResource, delta: number): Trackers {
  if (r === "armor") return { ...t, armor: { ...t.armor, marked: clamp(t.armor.marked + delta, t.armor.max) } };
  if (r === "hope") return { ...t, hope: { ...t.hope, value: clamp(t.hope.value + delta, t.hope.max) } };
  const next = applyResourceDelta({ hp: t.hp.marked, hpMax: t.hp.max, stress: t.stress.marked, stressMax: t.stress.max, hope: 0, scars: 0 }, r, delta);
  return { ...t, hp: { ...t.hp, marked: next.hp }, stress: { ...t.stress, marked: next.stress } };
}

/** A banner row after the same step (the banners and token rings follow the panel at once). */
export function applyStepToParty(row: PartyRow, r: TrackerResource, delta: number): PartyRow {
  const t = applyStep({ hp: row.hp, stress: row.stress, hope: row.hope, armor: row.armor }, r, delta);
  return { ...row, hp: t.hp, stress: t.stress, hope: t.hope, armor: t.armor, down: t.hp.marked >= t.hp.max && t.hp.max > 0 };
}

/** Every condition a PC can have (CB pp.102-103, Unconscious CB p.106), as the toggles list them. */
export const SHEET_CONDITIONS = CONDITIONS;
export type SheetCondition = (typeof CONDITIONS)[number];

/** "vulnerable" → "Vulnerable" (the server's `conditionLabel`). */
export const conditionName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/** The sheet after switching one condition (on → off drops it, off → on adds it bare; the server's answer adds its source). */
export function toggleConditionIn(sheet: HudSheetData, id: string): HudSheetData {
  const on = sheet.conditions.some((c) => c.id === id);
  const conditions = on ? sheet.conditions.filter((c) => c.id !== id) : [...sheet.conditions, { id, label: conditionName(id), source: null, until: null }];
  return { ...sheet, conditions };
}

export function toggleConditionInParty(row: PartyRow, id: string): PartyRow {
  const on = row.conditions.some((c) => c.id === id);
  return { ...row, conditions: on ? row.conditions.filter((c) => c.id !== id) : [...row.conditions, { id, label: conditionName(id) }] };
}

/** The badge of a feature without a Use here: `auto` reads "Passive" (HD2 question 2, the board's Combat Training). */
export function kindLabel(kind: HudSheetFeature["kind"]): string {
  switch (kind) {
    case "action":
      return "Action";
    case "reaction":
      return "Reaction";
    case "rider":
      return "Rider";
    case "outOfCombat":
      return "Out of combat";
    case "narrative":
      return "Narrative";
    default:
      return "Passive";
  }
}

/** The uses a Use button runs on the map (as the classic drawer's `usableUses`): own / gm data only. */
export function mapUses(f: HudSheetFeature): HudSheetUse[] {
  if (f.uses === null || !f.automated || f.kind === "outOfCombat" || f.kind === "narrative" || REST_TIME_FEATURES.has(f.featureId)) return [];
  return f.uses.filter((u) => u.activation === "action" || u.activation === "reaction");
}

/** The existing D5 Use of an out-of-combat feature (Commune, Get In & Get Out), or null. */
export function d5Key(f: Pick<HudSheetFeature, "featureId" | "kind">): string | null {
  if (f.kind !== "outOfCombat" && f.kind !== "narrative") return null;
  return D5_USES[f.featureId] ?? null;
}

/** The muted line under a feature's text: cost, limit, uses left, tokens, or when it comes back. */
export function featureNotes(f: HudSheetFeature): string[] {
  if (f.used) return [f.resetLabel ? `Used · ${f.resetLabel}` : "Used"];
  const notes: string[] = [];
  if (f.cost) notes.push(f.cost);
  if (f.limit) notes.push(f.limit);
  if (f.usesLeft !== null) notes.push(`${f.usesLeft} left`);
  if (f.tokens > 0) notes.push(`${f.tokens} ${f.tokens === 1 ? "token" : "tokens"}`);
  return notes;
}

/** The read-only note (Main `.ro-note`, GMDesktop `.gm-note`). */
export function roNote(mode: HudSheetMode, name: string, playingFor: boolean): string | null {
  if (mode === "view") return `Only ${name}’s player and the GM can use or change this sheet.`;
  if (mode === "gm") {
    return playingFor
      ? "You’re the GM: you can change any value on this sheet."
      : "You’re the GM: you can change any value on this sheet. Turn on Play for this character to use features and cards.";
  }
  return null;
}
