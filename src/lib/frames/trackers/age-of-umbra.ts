// The Age of Umbra: Sacred Pyres, Blessed Branches and the Lurking Darkness
// (Core Book pp.288-289). Pure module: bundled into Convex, so no framework
// imports.

import { z } from "zod";

export const SETTLEMENT_MAX = 60;
export const MAX_WATCHERS = 8;
/** How many Lurking Darkness rolls the tracker keeps for the GM. */
export const LURKING_LOG_SIZE = 5;

/** "When ignited, all Enduring present gain 3 Hope" (Blessed Branch, p.288). */
export const BRANCH_HOPE_REMINDER = "All Enduring present gain 3 Hope.";

export const MAX_PYRES = 200;

const pyreSchema = z.object({
  id: z.string(),
  settlement: z.string(),
  lit: z.boolean(),
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
  atPyre: z.boolean(),
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
  if (!pyre) throw new Error("That Sacred Pyre is gone.");
  return pyre;
}

const withPyre = (state: UmbraState, id: string, patch: Partial<Pyre>): UmbraState => {
  findPyre(state, id);
  return { ...state, pyres: state.pyres.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
};

export function addPyre(state: UmbraState, settlement: string, lit: boolean): { state: UmbraState; pyreId: string } {
  if (state.pyres.length >= MAX_PYRES) throw new Error(`A campaign can track at most ${MAX_PYRES} pyres.`);
  const pyreId = `p${state.nextPyreId}`;
  return {
    state: { ...state, pyres: [...state.pyres, { id: pyreId, settlement, lit }], nextPyreId: state.nextPyreId + 1 },
    pyreId,
  };
}

export const renamePyre = (state: UmbraState, id: string, settlement: string) => withPyre(state, id, { settlement });

export const setPyreLit = (state: UmbraState, id: string, lit: boolean) => withPyre(state, id, { lit });

export function removePyre(state: UmbraState, id: string): UmbraState {
  findPyre(state, id);
  return { ...state, pyres: state.pyres.filter((p) => p.id !== id) };
}

export function adjustBranches(state: UmbraState, delta: 1 | -1): UmbraState {
  if (state.blessedBranches + delta < 0) throw new Error("The party has no Blessed Branch.");
  return { ...state, blessedBranches: state.blessedBranches + delta };
}

export type BranchUse = { mode: "relight"; pyreId: string } | { mode: "found"; settlement: string };

/**
 * "If the characters acquire a Blessed Branch, they can reignite an
 * extinguished Sacred Pyre or create a new Sacred Pyre" (p.288).
 */
export function igniteBranch(state: UmbraState, use: BranchUse): { state: UmbraState; pyreId: string; reminder: string } {
  if (state.blessedBranches < 1) throw new Error("The party has no Blessed Branch.");
  const spent = { ...state, blessedBranches: state.blessedBranches - 1 };
  if (use.mode === "relight") {
    if (findPyre(state, use.pyreId).lit) throw new Error("That Sacred Pyre is already burning.");
    return { state: setPyreLit(spent, use.pyreId, true), pyreId: use.pyreId, reminder: BRANCH_HOPE_REMINDER };
  }
  const added = addPyre(spent, use.settlement, true);
  return { ...added, reminder: BRANCH_HOPE_REMINDER };
}

/** The Lurking Darkness list (p.289). */
export function lurkingOutcome(result: number): LurkingOutcome {
  if (!Number.isInteger(result) || result < 1 || result > 12) throw new Error("A Lurking Darkness roll is a d12.");
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

/** "When the party finishes a short or long rest while not in the vicinity of a Sacred Pyre" (p.289). */
export function assertCanRollLurking(state: UmbraState): void {
  if (state.atPyre) throw new Error("The party rests at a Sacred Pyre: the Lurking Darkness can't reach them.");
}

export function logLurking(state: UmbraState, entry: LurkingRoll): UmbraState {
  return { ...state, log: [entry, ...state.log].slice(0, LURKING_LOG_SIZE) };
}
