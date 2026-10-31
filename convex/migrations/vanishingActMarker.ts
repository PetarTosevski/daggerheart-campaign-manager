import { ConvexError } from "convex/values";

import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import { owned } from "../../src/lib/domain/feature-effects/owned";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { logAction } from "../lib/actionLog";
import { conditionSources, endedConditionLine, sourceEnds, withoutCondition, writeSheetChanges } from "../lib/cardRunner";
import { readSheet, storedSheet } from "../lib/characterSheet";
import { migrations } from "../lib/migrations";

/**
 * MG (dcm-3ias, user 2026-10-31: "write a migration"; docs/tasks/TASK-LN2-MG.md). Lane C2 (a2b9bced) records where
 * Vanishing Act's Cloaked comes from: `writeSheetChanges` (convex/lib/cardRunner.ts) writes a source marker in the
 * sheet's `effects`. A rogue Cloaked by Vanishing Act before that deploy has the bare condition and no marker, so it reads
 * as an ordinary Cloaked (an attack or a move in sight ends it). This gives such a rogue the marker, written by
 * `writeSheetChanges` itself, so it is exactly what a use writes today, or removes the Cloaked when a rest has ended it.
 *
 * Which rogues: Cloaked, no marker for Cloaked, holding Vanishing Act (`owned`: Nightwalker at mastery). The character's
 * own feed then decides (`cloakSource`, after the pre-C2 stop-gap C2 removed):
 * - "active": the newest way Cloaked was turned on is a Vanishing Act use, with no rest since: the marker is added.
 * - "rested" (change 2026-10-31, user answer on dcm-3ias): a Vanishing Act use, then (newer) a rest, and no newer row turned
 *   Cloaked on another way. Old code did not end the Cloaked on a rest; the book does ("until your next rest", CB p.42), so
 *   the stale Cloaked is removed (`withoutCondition`).
 * - null: Cloaked came the ordinary way (Hidden -> Cloaked, or turned on again after the use) or cannot be traced in the
 *   newest rows: it stays bare (an ordinary Cloaked). The safe default, since a marker makes a Cloaked survive the attacks
 *   and moves that end it, and removing a Cloaked we cannot trace to Vanishing Act would take away an ordinary one.
 *
 * A removal also writes the character's feed row "<name>: Cloaked ends (Vanishing Act)" (dcm-3wt4, user answer).
 *
 * Each change is logged with its own prefix ("Vanishing Act marker added" / "Stale Vanishing Act Cloaked removed"), so the
 * two are counted apart in the logs (`grep -c`); a dry run logs its one batch, then rolls it back.
 *
 * Idempotent (a sheet with a marker, or no longer Cloaked, is skipped), so `reset: true` is safe. Run once per deployment
 * (see `run.ts`):
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

/** Where a bare Cloaked comes from, by the feed: Vanishing Act with no rest since, Vanishing Act ended by a rest, or neither. */
export type CloakSource = "active" | "rested" | null;

/**
 * Where the character's current Cloaked comes from, by the newest feed rows. Walking newest first (undone rows skipped): a
 * "<name> uses Vanishing Act" row gives "active", or "rested" when a rest row (Vanishing Act's Cloaked lasts "until your
 * next rest") came after it; a row whose `before` sheet was not Cloaked (Cloaked was turned on another way since) gives
 * null first. No such row in the newest rows: null. The pre-C2 stop-gap's rule, with the snapshot read fixed (`before` is
 * stored as JSON text) and the rest added.
 */
async function cloakSource(ctx: QueryCtx, characterId: Doc<"characters">["_id"], name: string): Promise<CloakSource> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(CLOAK_SOURCE_ROWS);
  let rested = false;
  for (const row of rows) {
    if (row.undoneAt !== undefined) continue;
    if (row.summary.startsWith(`${name} uses ${NAME}`)) return rested ? "rested" : "active";
    if (row.kind === "rest" && REST_ROW.test(row.summary)) rested = true;
    if (row.before === undefined) continue;
    let before: CharacterSheet;
    try {
      before = readSheet(JSON.parse(row.before));
    } catch {
      continue;
    }
    if (!before.conditions.includes("cloaked")) return null;
  }
  return null;
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
    const source = await cloakSource(ctx, row._id, sheet.name);
    if (source === "active") {
      console.log(`Vanishing Act marker added: character ${row._id}.`);
      return { sheet: storedSheet(withVanishingActMarker(sheet)) };
    }
    if (source === "rested") {
      console.log(`Stale Vanishing Act Cloaked removed (a rest since the use): character ${row._id}.`);
      // dcm-3wt4 (user answer 2026-10-31): the player sees why the Cloaked is gone. Not undoable: undoing it would bring
      // back a Cloaked the rest ended. A dry run rolls the row back with the batch.
      await logAction(ctx, {
        campaignId: row.campaignId,
        characterId: row._id,
        actorId: row.ownerId,
        kind: "feature",
        visibility: "public",
        summary: endedConditionLine(sheet.name, { condition: "cloaked", source: NAME }),
        before: sheet,
        undoable: false,
      });
      return { sheet: storedSheet(withoutCondition(sheet, "cloaked")) };
    }
  },
});
