/**
 * The rest lookups `rests.ts` (the GM's rest and the players' picks) and `restsReads.ts` (the HUD's and the party page's
 * reads) share. Split out of `convex/rests.ts` by dcm-uh6r so the rest reads load without the rest hooks and the card
 * runner the rest mutations need.
 */
import { allowedMoves } from "../../src/lib/domain/rest/index";
import { efficientMoves, extraMoveGrants, NO_REST_FEATURES, oasisPool, restFeaturesOf, restMoveSlots, type RestFeatures } from "../../src/lib/domain/rest/feature-moves";
import { holdsMartialPreparation } from "../../src/lib/domain/session-features/holders";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { MAX_CHARACTERS_PER_CAMPAIGN, readSheet } from "./characterSheet";
import { featureScope } from "./featureScope";
import { restMovesFor } from "./restMoves";
import { ruleMode } from "./ruleModes";
import type { RestKind, RestMove } from "./validators/rests";

/** Rests read back to count short rests; a long rest is never this far back in practice. */
export const REST_SCAN = 50;

export async function recentRests(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"rests">[]> {
  return ctx.db
    .query("rests")
    .withIndex("by_campaign_started", (q) => q.eq("campaignId", campaignId))
    .order("desc")
    .take(REST_SCAN);
}

export async function choicesOf(ctx: QueryCtx, restId: Id<"rests">): Promise<Doc<"restChoices">[]> {
  // One row per resting PC (at most REST_PARTY_MAX), so the campaign's character cap bounds it.
  return ctx.db
    .query("restChoices")
    .withIndex("by_rest_character", (q) => q.eq("restId", restId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
}

/** A resting PC: active (not dead, retired or away, HF 127). Unconscious PCs rest but pick no moves (decision 9) while C4 is Book. */
export const resting = (c: Doc<"characters">) => c.status === "active";

/**
 * Each resting PC's pickable moves for this rest. A sheet that fails to read gets the core moves. Read only while a
 * rest is open (`current`), bounded by the campaign's character cap.
 */
export async function pickableMoves(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  kind: RestKind,
): Promise<{ characterId: Id<"characters">; moves: RestMove[]; efficient: RestMove[]; slots: number; minSlots: number; trance: boolean; extraMoves: number; oasis: boolean }[]> {
  // T1 Two moves per rest (plan rule-switches WD): Manual takes 0 to 4 moves.
  const movesMode = ruleMode(campaign, "twoDowntimeMoves");
  const party = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
  const pcs = party.filter(resting).map((c) => ({ c, sheet: sheetOrNull(c) }));
  const martialPreparation = pcs.some(({ sheet }) => sheet !== null && holdsMartialPreparation(sheet));
  return pcs.map(({ c, sheet }) => {
    const rules = restMovesFor(campaign, sheet ?? { classId: "" }, { martialPreparation });
    const features = featuresOf(campaign, sheet);
    const base = allowedMoves(kind, rules.extra, rules.forbidden);
    // dcm-bxp.99.19.2: extra moves granted for this rest (Eloquent, CB 29).
    const extraMoves = sheet === null ? 0 : extraMoveGrants(sheet);
    return {
      characterId: c._id,
      moves: base,
      efficient: efficientMoves(kind, features, base, rules.forbidden),
      slots: restMoveSlots(features, extraMoves, movesMode).max,
      minSlots: restMoveSlots(features, extraMoves, movesMode).min,
      trance: features.trance,
      extraMoves,
      oasis: kind === "short" && features.oasis,
    };
  });
}

/** The rest-time heritage features the sheet holds (Hardy, Efficient, Celestial Trance, Oasis; SD-R), none for an unreadable sheet. */
export function featuresOf(campaign: Doc<"campaigns">, sheet: CharacterSheet | null): RestFeatures {
  return sheet === null ? NO_REST_FEATURES : restFeaturesOf(sheet, { hopeAndFear: featureScope(campaign).hopeAndFear });
}

/** The character's sheet, or null when it fails to read. */
export function sheetOrNull(c: Doc<"characters">): CharacterSheet | null {
  try {
    return readSheet(c.sheet);
  } catch {
    return null;
  }
}

/**
 * Martial Preparation (Call of the Slayer mastery, CB 48): "Your party gains access to the Martial Preparation
 * downtime move" while a resting PC holds the mastery card (user 2026-10-22). Bounded by the campaign's character cap.
 */
export async function partyHasMartialPreparation(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<boolean> {
  const party = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
  return party.some((c) => {
    if (!resting(c)) return false;
    const sheet = sheetOrNull(c);
    return sheet !== null && holdsMartialPreparation(sheet);
  });
}

/**
 * Whether the rest's actionLog group can still be undone: its first row is undoable and not undone. The daily
 * snapshot strip (`cleanup.stripActionLogSnapshots`) marks rows older than 30 days not undoable (dcm-c26), so an old
 * rest offers no Undo that `undo` would refuse with UNDO_STALE (dcm-bxp.63).
 */
export async function groupUndoable(ctx: QueryCtx, campaignId: Id<"campaigns">, groupId: string | undefined): Promise<boolean> {
  if (groupId === undefined) return false;
  const [row] = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", campaignId).eq("groupId", groupId))
    .take(1);
  return row !== undefined && row.undoable && row.undoneAt === undefined;
}

/** A countdown Work on a Project can tick: the character's own project (not an Endurance or Lycanthropy countdown). */
export const isProject = (c: Doc<"countdowns">, characterId: Id<"characters">) => c.ownerKey === characterId && c.kind === "project" && c.status !== "cancelled";

/** The rest's Oasis holders and who closed their panel (DA15), for `oasisPool` and `oasisReroll`. */
export const oasisPoolOf = (rest: Doc<"rests">) => ({ holders: rest.oasisHolders ?? [], closed: rest.oasisClosed ?? [] });

/**
 * The ended rest's Oasis window is open (DA15, user 2026-10-30): it rolled dice, the GM did not close it for everyone
 * under DA5 (`resultsClosedAt`, no longer written) and at least one holder has not closed their own panel. Starting
 * the next rest ends it too (only the latest rest counts; the callers check that).
 */
export function oasisWindowOpen(rest: Doc<"rests">): boolean {
  return (rest.dice ?? []).length > 0 && rest.resultsClosedAt === undefined && oasisPool(rest.dice ?? [], oasisPoolOf(rest)).open.length > 0;
}
