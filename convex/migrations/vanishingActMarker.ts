import { ConvexError } from "convex/values";

import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import { owned } from "../../src/lib/domain/feature-effects/owned";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { conditionSources, sourceEnds, writeSheetChanges } from "../lib/cardRunner";
import { readSheet, storedSheet } from "../lib/characterSheet";
import { migrations } from "../lib/migrations";

/**
 * MG (dcm-3ias, user 2026-10-31: "write a migration"; docs/tasks/TASK-LN2-MG.md). Lane C2 (a2b9bced) records where
 * Vanishing Act's Cloaked comes from: `writeSheetChanges` (convex/lib/cardRunner.ts) writes a source marker in the
 * sheet's `effects`. A rogue Cloaked by Vanishing Act before that deploy has the bare condition and no marker, so it reads
 * as an ordinary Cloaked (an attack or a move in sight ends it). This gives such a rogue the marker, written by
 * `writeSheetChanges` itself, so it is exactly what a use writes today.
 *
 * Which rogues: Cloaked, no marker for Cloaked, holding Vanishing Act (`owned`: Nightwalker at mastery), and whose own
 * feed says the Cloaked is Vanishing Act's (`cloakedByVanishingAct`, after the pre-C2 stop-gap C2 removed). One whose
 * Cloaked came the ordinary way (Hidden -> Cloaked), outlived a rest, or cannot be traced in the newest rows stays bare
 * (an ordinary Cloaked): the safe default, since a marker makes a Cloaked survive the attacks and moves that end it.
 *
 * Idempotent (a sheet with a marker is skipped), so `reset: true` is safe. Run once per deployment (see `run.ts`):
 *   npx convex run migrations/run:run '{fn: "migrations/vanishingActMarker:addMarker", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/vanishingActMarker:addMarker"}'
 */

/** Vanishing Act's feature id (src/lib/srd/feature-effects/ranger-rogue.ts). */
export const VANISHING_ACT = "subclass:nightwalker:vanishing-act";
/** The feature's name: the marker's `source` and the feed's "<name> uses Vanishing Act". */
const NAME = "Vanishing Act";
/** Feed rows read back, as the pre-C2 stop-gap. */
const CLOAK_SOURCE_ROWS = 20;

/** The sheet with Vanishing Act's marker for Cloaked, as the feature's use writes it. */
export function withVanishingActMarker(sheet: CharacterSheet): CharacterSheet {
  const ends = sourceEnds(VANISHING_ACT, "cloaked");
  if (ends?.duration === undefined) throw new Error("Vanishing Act has no Cloaked step with endings of its own");
  const step: PlanStep = {
    kind: "condition",
    targetId: "self",
    condition: { kind: "standard", condition: "cloaked" },
    duration: ends.duration,
    ...(ends.endsOn ? { endsOn: ends.endsOn } : {}),
  };
  // Only the effects are taken: the condition is already held, and nothing else on the sheet should move.
  return { ...sheet, effects: writeSheetChanges(sheet, [step], "self", VANISHING_ACT, NAME, false, true).effects };
}

/** A character's rest row (convex/rests.ts: "Short rest", "Long rest", "Interrupted long rest …"; not Oasis's rerolls). */
const REST_ROW = /^(Short rest|Long rest|Interrupted long rest)/;

/**
 * Whether the character's newest feed rows show Vanishing Act turned the current Cloaked on: walking newest first (undone
 * rows skipped), a "<name> uses Vanishing Act" row comes before both a rest row (the rest ended that Cloaked: "until your
 * next rest") and a row whose `before` sheet was not Cloaked (Cloaked was turned on another way since). The pre-C2
 * stop-gap's rule, with the snapshot read fixed (`before` is stored as JSON text) and the rest added.
 */
async function cloakedByVanishingAct(ctx: QueryCtx, characterId: Doc<"characters">["_id"], name: string): Promise<boolean> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(CLOAK_SOURCE_ROWS);
  for (const row of rows) {
    if (row.undoneAt !== undefined) continue;
    if (row.summary.startsWith(`${name} uses ${NAME}`)) return true;
    if (row.kind === "rest" && REST_ROW.test(row.summary)) return false;
    if (row.before === undefined) continue;
    let before: CharacterSheet;
    try {
      before = readSheet(JSON.parse(row.before));
    } catch {
      continue;
    }
    if (!before.conditions.includes("cloaked")) return false;
  }
  return false;
}

export const addMarker = migrations.define({
  table: "characters",
  migrateOne: async (ctx, row) => {
    let sheet: CharacterSheet;
    try {
      sheet = readSheet(row.sheet);
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      console.warn(`Character ${row._id} has an unreadable sheet; no Vanishing Act marker added.`);
      return;
    }
    if (!sheet.conditions.includes("cloaked") || conditionSources(sheet, "cloaked").length > 0) return;
    if (!owned(sheet).some((f) => f.featureId === VANISHING_ACT)) return;
    if (!(await cloakedByVanishingAct(ctx, row._id, sheet.name))) return;
    return { sheet: storedSheet(withVanishingActMarker(sheet)) };
  },
});
