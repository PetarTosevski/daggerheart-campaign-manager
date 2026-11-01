import { ConvexError } from "convex/values";

import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { effectSource, holdsSource } from "../lib/cardRows";
import { readSheet, storedSheet } from "../lib/characterSheet";
import { migrations } from "../lib/migrations";

/**
 * Plan lanes-2 wave 10, E6.4 (dcm-lztq; docs/tasks/TASK-LN4-E6.md). V4 widened sheet effects with an optional `casterId`
 * (the character who made the effect; src/lib/validation/characters.ts), so caster-tied ends ("until you take Severe
 * damage", Eye of the Storm, HF p.23) end only that caster's effects even when two PCs hold the card or feature. Writers
 * set it from this wave on; this backfills effects stored before, where the caster is derivable:
 *
 * - The effect names its source card or feature (`effectSource`: a `card:` / `feat:` effect, or a D5 alias such as
 *   Marked for Death), and exactly one character of the campaign holds that source (`holdsSource`: the card in their
 *   loadout, the feature owned). That character is the caster.
 * - Anything else is left as it is (no source, nobody or two holders, an unreadable sheet in the campaign, a campaign
 *   past `MAX_CAMPAIGN_CHARACTERS`): the readers keep the old single-holder guess for an effect without `casterId`.
 *
 * Widen only: no narrow follows (an effect without a derivable caster stays valid). Idempotent (an effect with a
 * `casterId` is never touched), so `reset: true` is safe. Written and tested, not run (the user runs it):
 *   npx convex run migrations/run:run '{fn: "migrations/sheetEffectCaster:backfillCaster", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/sheetEffectCaster:backfillCaster"}'
 */

/** The most characters read for one campaign; a bigger one is skipped (the guess stays). */
export const MAX_CAMPAIGN_CHARACTERS = 50;

/** One character of the campaign, as the backfill reads it. */
export type Holder = { id: string; sheet: CharacterSheet };

/**
 * The sheet with `casterId` on every effect whose caster is derivable from `party` (every character of the campaign,
 * this one included), or null when nothing changes.
 */
export function withDerivedCasters(sheet: CharacterSheet, party: readonly Holder[]): CharacterSheet | null {
  let changed = false;
  const effects = sheet.effects.map((e) => {
    if (e.casterId !== undefined) return e;
    const source = effectSource(e);
    if (source === null) return e;
    const holders = party.filter((p) => holdsSource(p.sheet, source.sourceId));
    if (holders.length !== 1) return e;
    changed = true;
    return { ...e, casterId: holders[0]!.id };
  });
  return changed ? { ...sheet, effects } : null;
}

/** Every character of the campaign with a readable sheet, or null when one is unreadable or there are too many. */
async function campaignHolders(ctx: QueryCtx, campaignId: Doc<"characters">["campaignId"]): Promise<Holder[] | null> {
  const rows = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CAMPAIGN_CHARACTERS + 1);
  if (rows.length > MAX_CAMPAIGN_CHARACTERS) return null;
  const out: Holder[] = [];
  for (const row of rows) {
    try {
      out.push({ id: row._id, sheet: readSheet(row.sheet) });
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      // An unreadable sheet may hold the source: no caster is derivable in this campaign.
      return null;
    }
  }
  return out;
}

export const backfillCaster = migrations.define({
  table: "characters",
  migrateOne: async (ctx, row) => {
    let sheet: CharacterSheet;
    try {
      sheet = readSheet(row.sheet);
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      console.warn(`Character ${row._id} has an unreadable sheet; no effect casters added.`);
      return;
    }
    if (!sheet.effects.some((e) => e.casterId === undefined)) return;
    const party = await campaignHolders(ctx, row.campaignId);
    if (party === null) {
      console.warn(`Character ${row._id}: campaign ${row.campaignId} has an unreadable sheet or too many characters; no effect casters added.`);
      return;
    }
    const next = withDerivedCasters(sheet, party);
    if (next === null) return;
    const added = next.effects.filter((e, i) => e.casterId !== sheet.effects[i]?.casterId).length;
    console.log(`Effect casters added: character ${row._id}, ${added} effect(s).`);
    return { sheet: storedSheet(next) };
  },
});
