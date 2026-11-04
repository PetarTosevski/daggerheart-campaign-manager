// The Age of Umbra: Sacred Pyres, Blessed Branches and the Lurking Darkness
// (Core Book pp.288-289). Pure module: bundled into Convex, so no framework
// imports.

import { z } from "zod";

import { distanceKm, type MapScale } from "../../domain/travel/index";
import { RuleError } from "../../errors/app-error";

export const SETTLEMENT_MAX = 60;
export const MAX_WATCHERS = 8;
/** How many Lurking Darkness rolls the tracker keeps for the GM. */
export const LURKING_LOG_SIZE = 5;

/** "When ignited, all Enduring present gain 3 Hope" (Blessed Branch, p.288). */
export const BRANCH_HOPE_REMINDER = "All Enduring present gain 3 Hope.";

export const MAX_PYRES = 200;

/** Vicinity of a Sacred Pyre for the automatic "at a pyre" (dcm-bxp.18, user 2026-10-30): default 1 km, GM-set per campaign. */
export const DEFAULT_VICINITY_KM = 1;
export const MIN_VICINITY_KM = 0.1;
export const MAX_VICINITY_KM = 1000;

const pyreSchema = z.object({
  id: z.string(),
  settlement: z.string(),
  lit: z.boolean(),
  /** Optional link to a World map marker (`MapToken.id`), dcm-bxp.18. Widened: older pyres have none. */
  tokenId: z.number().int().min(1).optional(),
});
export type Pyre = z.infer<typeof pyreSchema>;

export const LURKING_OUTCOMES = ["conflict", "fear2", "fear1", "none", "hope"] as const;
export type LurkingOutcome = (typeof LURKING_OUTCOMES)[number];

export const lurkingRollSchema = z.object({
  gmRoll: z.number().int().min(1).max(12),
  /** The highest Keep Watch Hope Die, or null when nobody kept watch. */
  watchRoll: z.number().int().min(1).max(12).nullable(),
  /** The roll that counts. */
  result: z.number().int().min(1).max(12),
  outcome: z.enum(LURKING_OUTCOMES),
  fearGained: z.number().int().min(0),
  at: z.number(),
});
export type LurkingRoll = z.infer<typeof lurkingRollSchema>;

export const umbraStateSchema = z.object({
  pyres: z.array(pyreSchema).max(MAX_PYRES),
  nextPyreId: z.number().int().min(1),
  blessedBranches: z.number().int().min(0),
  /** The GM's checkbox; it decides "at a pyre" while `atPyreMode` is "gm". */
  atPyre: z.boolean(),
  /**
   * dcm-bxp.18: "auto" derives "at a pyre" from the map (the party marker
   * within `vicinityKm` of a lit linked pyre's marker); "gm" uses the
   * checkbox. Widened: unset reads as "gm" when the box is ticked, else "auto"
   * (`atPyreMode`).
   */
  atPyreMode: z.enum(["auto", "gm"]).optional(),
  /** Widened: unset is DEFAULT_VICINITY_KM. */
  vicinityKm: z.number().min(MIN_VICINITY_KM).max(MAX_VICINITY_KM).optional(),
  log: z.array(lurkingRollSchema),
});
export type UmbraState = z.infer<typeof umbraStateSchema>;

export const INITIAL_UMBRA: UmbraState = { pyres: [], nextPyreId: 1, blessedBranches: 0, atPyre: false, log: [] };

export const settlementSchema = z
  .string()
  .trim()
  .min(1, "Name the settlement.")
  .max(SETTLEMENT_MAX, `Keep the settlement name under ${SETTLEMENT_MAX + 1} characters.`);

export const watchersSchema = z
  .array(z.number().int().min(1, "Hope Die results are 1–12.").max(12, "Hope Die results are 1–12."))
  .max(MAX_WATCHERS, `At most ${MAX_WATCHERS} watchers.`);

function findPyre(state: UmbraState, id: string): Pyre {
  const pyre = state.pyres.find((p) => p.id === id);
  if (!pyre) throw new RuleError("TRACKER_RULE", "That Sacred Pyre is gone.");
  return pyre;
}

const withPyre = (state: UmbraState, id: string, patch: Partial<Pyre>): UmbraState => {
  findPyre(state, id);
  return { ...state, pyres: state.pyres.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
};

export function addPyre(state: UmbraState, settlement: string, lit: boolean): { state: UmbraState; pyreId: string } {
  if (state.pyres.length >= MAX_PYRES) throw new RuleError("TRACKER_RULE", `A campaign can track at most ${MAX_PYRES} pyres.`);
  const pyreId = `p${state.nextPyreId}`;
  return {
    state: { ...state, pyres: [...state.pyres, { id: pyreId, settlement, lit }], nextPyreId: state.nextPyreId + 1 },
    pyreId,
  };
}

/** Whether the checkbox or the map decides "at a pyre" (an older state with the box ticked is the GM's choice). */
export function atPyreMode(state: Pick<UmbraState, "atPyre" | "atPyreMode">): "auto" | "gm" {
  return state.atPyreMode ?? (state.atPyre ? "gm" : "auto");
}

export const vicinityKm = (state: Pick<UmbraState, "vicinityKm">) => state.vicinityKm ?? DEFAULT_VICINITY_KM;

/** The GM ticks or clears the checkbox (`atPyre` a boolean), or hands the decision back to the map (null). */
export function setAtPyreChoice(state: UmbraState, atPyre: boolean | null): UmbraState {
  return atPyre === null ? { ...state, atPyre: false, atPyreMode: "auto" } : { ...state, atPyre, atPyreMode: "gm" };
}

export function setVicinity(state: UmbraState, km: number): UmbraState {
  if (!Number.isFinite(km) || km < MIN_VICINITY_KM || km > MAX_VICINITY_KM) {
    throw new RuleError("TRACKER_RULE", `The vicinity is ${MIN_VICINITY_KM} to ${MAX_VICINITY_KM} km.`);
  }
  return { ...state, vicinityKm: Math.round(km * 10) / 10 };
}

/** Links a pyre to a World map marker, or unlinks it (null). The caller checks the marker exists. */
export function linkPyre(state: UmbraState, id: string, tokenId: number | null): UmbraState {
  const { id: pyreId, settlement, lit } = findPyre(state, id);
  const next: Pyre = tokenId === null ? { id: pyreId, settlement, lit } : { id: pyreId, settlement, lit, tokenId };
  return { ...state, pyres: state.pyres.map((p) => (p.id === id ? next : p)) };
}

type Point = { x: number; y: number };

/**
 * "In the vicinity of a Sacred Pyre" on the map (user 2026-10-30): the party
 * marker within `km` of the marker of a lit pyre linked to one. Markers no
 * longer on the map are ignored.
 */
export function partyNearLitPyre(pyres: readonly Pyre[], markers: ReadonlyMap<number, Point>, party: Point, scale: MapScale, km: number): boolean {
  return pyres.some((p) => {
    if (!p.lit || p.tokenId === undefined) return false;
    const at = markers.get(p.tokenId);
    return at !== undefined && distanceKm(party, at, scale) <= km;
  });
}

/** Whether the party is at a Sacred Pyre: the GM's checkbox, or the map (`near`) in automatic mode. */
export function effectiveAtPyre(state: Pick<UmbraState, "atPyre" | "atPyreMode">, near: boolean): boolean {
  return atPyreMode(state) === "gm" ? state.atPyre : near;
}

export const renamePyre = (state: UmbraState, id: string, settlement: string) => withPyre(state, id, { settlement });

export const setPyreLit = (state: UmbraState, id: string, lit: boolean) => withPyre(state, id, { lit });

export function removePyre(state: UmbraState, id: string): UmbraState {
  findPyre(state, id);
  return { ...state, pyres: state.pyres.filter((p) => p.id !== id) };
}

export function adjustBranches(state: UmbraState, delta: 1 | -1): UmbraState {
  if (state.blessedBranches + delta < 0) throw new RuleError("TRACKER_RULE", "The party has no Blessed Branch.");
  return { ...state, blessedBranches: state.blessedBranches + delta };
}

export type BranchUse = { mode: "relight"; pyreId: string } | { mode: "found"; settlement: string };

/**
 * "If the characters acquire a Blessed Branch, they can reignite an
 * extinguished Sacred Pyre or create a new Sacred Pyre" (p.288).
 */
export function igniteBranch(state: UmbraState, use: BranchUse): { state: UmbraState; pyreId: string; reminder: string } {
  if (state.blessedBranches < 1) throw new RuleError("TRACKER_RULE", "The party has no Blessed Branch.");
  const spent = { ...state, blessedBranches: state.blessedBranches - 1 };
  if (use.mode === "relight") {
    if (findPyre(state, use.pyreId).lit) throw new RuleError("TRACKER_RULE", "That Sacred Pyre is already burning.");
    return { state: setPyreLit(spent, use.pyreId, true), pyreId: use.pyreId, reminder: BRANCH_HOPE_REMINDER };
  }
  const added = addPyre(spent, use.settlement, true);
  return { ...added, reminder: BRANCH_HOPE_REMINDER };
}

/** The Lurking Darkness list (p.289). */
export function lurkingOutcome(result: number): LurkingOutcome {
  if (!Number.isInteger(result) || result < 1 || result > 12) throw new RuleError("TRACKER_RULE", "A Lurking Darkness roll is a d12.");
  if (result <= 2) return "conflict";
  if (result <= 5) return "fear2";
  if (result <= 9) return "fear1";
  if (result <= 11) return "none";
  return "hope";
}

export const LURKING_TEXT: Record<LurkingOutcome, string> = {
  conflict: "Something monstrous found them in the dark. An adversary of the GM's choice initiates conflict.",
  fear2: "Something terrifying stalks nearby. You gain 2 Fear.",
  fear1: "The imposing darkness intensifies. You gain a Fear.",
  none: "The characters rest undisturbed. No effect.",
  hope: "The characters stumble upon a hopeful omen. Each PC gains a Hope.",
};

export const LURKING_FEAR: Record<LurkingOutcome, number> = { conflict: 0, fear2: 2, fear1: 1, none: 0, hope: 0 };

/**
 * Keep Watch (p.289): each watcher rolls their Hope Die and the party "choose[s]
 * whether to replace [the GM's] roll with yours… you can take the highest die
 * roll". The list only gets kinder as the roll rises, so the party's best
 * choice is always the highest of the GM roll and the best watcher roll.
 */
export function resolveLurking(
  gmRoll: number,
  watchers: readonly number[],
): { gmRoll: number; watchRoll: number | null; result: number; outcome: LurkingOutcome } {
  lurkingOutcome(gmRoll);
  watchers.forEach(lurkingOutcome);
  const watchRoll = watchers.length ? Math.max(...watchers) : null;
  const result = watchRoll !== null && watchRoll > gmRoll ? watchRoll : gmRoll;
  return { gmRoll, watchRoll, result, outcome: lurkingOutcome(result) };
}

/** "When the party finishes a short or long rest while not in the vicinity of a Sacred Pyre" (p.289). `near`: the map's answer (`partyNearLitPyre`). */
export function assertCanRollLurking(state: UmbraState, near = false): void {
  if (effectiveAtPyre(state, near)) throw new RuleError("TRACKER_RULE", "The party rests at a Sacred Pyre: the Lurking Darkness can't reach them.");
}

export function logLurking(state: UmbraState, entry: LurkingRoll): UmbraState {
  return { ...state, log: [entry, ...state.log].slice(0, LURKING_LOG_SIZE) };
}
