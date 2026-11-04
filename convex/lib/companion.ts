/**
 * The Beastbound companion's numbers for the feature runner (plan lanes E8, dcm-2z2; the vocabulary of tracer V:
 * `DiceExpr.sidesOf: "companion"`, `DamageRoll` `companion`, `TargetSpec.companionRange`, `ModStat`
 * `companionTraining`). CB p.40: "At level 1, your companion's damage die is a d6 and their range is Melee. Choose whether
 * they deal physical or magic damage." Vicious (CB p.41) steps the die or the range; the sheet is
 * `src/lib/frames/extras/companion.ts` (`companionStats`), stored in `characterExtras` (convex/characterExtras.ts).
 *
 * Sheet-drawer SD-C (the companion token on the map, its attack and Stress) is not built yet; it owns this file there
 * too and builds on `companionFor` / `companionNumbers`.
 *
 * ```ts
 * const companion = await companionFor(ctx, character._id);          // null without a companion sheet
 * pickFeature({ ..., companion: companion && companionNumbers(companion, sheet.level) });
 * ```
 */
import type { Range } from "../../src/lib/domain/card-effects/types";
import type { Range as SheetRange } from "../../src/lib/srd/types";
import { companionStateSchema, companionStats, type CompanionState } from "../../src/lib/frames/extras/companion";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * The character's companion sheet, or null when they have none (no row, or a row that fails to read). A companion
 * still in the pre-H14 `frameTrackers` row is not read here (the migration moves it).
 */
export async function companionFor(ctx: QueryCtx, characterId: Id<"characters">): Promise<CompanionState | null> {
  const row = await ctx.db
    .query("characterExtras")
    .withIndex("by_character_extra", (q) => q.eq("characterId", characterId).eq("extra", "companion"))
    .unique();
  if (row === null) return null;
  const parsed = companionStateSchema.safeParse(row.data);
  return parsed.success ? parsed.data : null;
}

/** What the runner reads from the companion sheet: its damage die, range, damage type and training picks left. */
export type CompanionNumbers = {
  /** d6, stepped by Vicious (CB p.41). */
  dieSides: number;
  range: Range;
  damageType: "physical" | "magic";
  /** Training options still to pick (one per level-up, plus Expert / Advanced Training's `bonusTraining`, CB p.38). */
  trainingLeft: number;
  evasion: number;
  stressMax: number;
};

/** The sheet's range words as the runner's range ids. */
const RANGE_ID: Record<SheetRange, Range> = { Melee: "melee", "Very Close": "veryClose", Close: "close", Far: "far", "Very Far": "veryFar" };

/** The companion's numbers at the ranger's level (`companionStats`). */
export function companionNumbers(state: CompanionState, level: number): CompanionNumbers {
  const stats = companionStats(state, level);
  return {
    dieSides: stats.damageDie,
    range: RANGE_ID[stats.range],
    damageType: state.attack.damageType === "mag" ? "magic" : "physical",
    trainingLeft: Math.max(0, stats.trainingCap - stats.trainingUsed),
    evasion: stats.evasion,
    stressMax: stats.stressMax,
  };
}
