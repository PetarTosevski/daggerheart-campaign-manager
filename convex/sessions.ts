/**
 * The GM's temporary Start / End session buttons (D5 T5, decision 12) until
 * the Sessions board (D10) takes them over.
 *
 * - `start`: stamps `campaignState.sessionStartedAt` and runs the class hook
 *   `onSessionStart` for every active PC. Pressing it again does nothing.
 * - `end`: for every PC, clears session effects (`expire(sheet, "session")`),
 *   runs `onSessionEnd`, and clears Wither tokens; the tokens become GM Fear
 *   capped at 12, the rest reported as lost (CB 261; decision). Ending with
 *   nothing to change writes nothing, so a second End is a no-op.
 * - `current`: the started session, for every member, and whether extra
 *   characters are allowed in it.
 * - `allowExtraCharacters` (XC1, user 2026-10-18): while a session runs, the GM
 *   lifts the one-active-character rule for it (INVALID with no session). `end`
 *   switches it off; characters made active meanwhile stay active.
 * Each action writes one undoable `actionLog` group: a row per changed PC plus
 * a campaign row carrying the Fear. Undo restores the sheets and the Fear;
 * `sessionStartedAt` keeps its value.
 */
import { v } from "convex/values";

import { expire } from "../src/lib/domain/characters/expiry";
import { appError } from "../src/lib/errors/app-error";
import { onSessionEnd, onSessionStart } from "../src/lib/domain/class-features/hooks";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { readSheet, saveSheet } from "./lib/characterSheet";
import { rollDie } from "./lib/dice";
import { campaignFearState, gainFear } from "./lib/fear";
import { campaignQuery, keyedGmMutation } from "./lib/functions";

/** One party: a handful of characters (a group holds at most 50 rows, one is the campaign's). */
const PARTY_MAX = 49;

/** The campaign's characters with readable sheets; a corrupt sheet is left alone. More than PARTY_MAX is INVALID, never a silent skip (review M5). */
async function party(ctx: MutationCtx, campaignId: Id<"campaigns">) {
  const rows = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(PARTY_MAX + 1);
  if (rows.length > PARTY_MAX) throw appError("INVALID", `A session can update at most ${PARTY_MAX} characters; remove some from the campaign.`);
  return rows.flatMap((character) => {
    try {
      return [{ character, sheet: readSheet(character.sheet) }];
    } catch {
      return [];
    }
  });
}

const same = (a: CharacterSheet, b: CharacterSheet) => JSON.stringify(a) === JSON.stringify(b);

/** Saves each changed sheet with its row in `groupId`; returns how many changed. */
async function saveChanged(
  ctx: MutationCtx,
  { campaignId, actorId, groupId, summary }: { campaignId: Id<"campaigns">; actorId: Id<"users">; groupId: string; summary: string },
  changes: { character: Doc<"characters">; sheet: CharacterSheet; next: CharacterSheet }[],
): Promise<number> {
  let count = 0;
  for (const { character, sheet, next } of changes) {
    if (same(sheet, next)) continue;
    await saveSheet(ctx, character._id, next);
    await logAction(ctx, { campaignId, characterId: character._id, actorId, kind: "session", visibility: "public", summary: `${sheet.name}: ${summary}`, groupId, before: sheet, undoable: true });
    count += 1;
  }
  return count;
}

export const current = campaignQuery({
  need: "view",
  args: {},
  returns: v.object({ startedAt: v.union(v.number(), v.null()), extraCharacters: v.boolean() }),
  handler: async (ctx) => {
    const state = await campaignFearState(ctx, ctx.campaign._id);
    return {
      startedAt: state.sessionStartedAt ?? null,
      extraCharacters: state.sessionStartedAt !== undefined && state.extraCharactersSession === state.sessionStartedAt,
    };
  },
});

export const allowExtraCharacters = keyedGmMutation({
  args: { allow: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { allow }) =>
    ctx.once("session_extra_characters", { allow }, async () => {
      const state = await campaignFearState(ctx, ctx.campaign._id);
      if (state.sessionStartedAt === undefined) throw appError("INVALID", "Start a session first.");
      const on = state.extraCharactersSession === state.sessionStartedAt;
      if (on === allow) return null;
      await ctx.db.patch("campaignState", state._id, { extraCharactersSession: allow ? state.sessionStartedAt : undefined });
      await logAction(ctx, {
        campaignId: ctx.campaign._id,
        actorId: ctx.user._id,
        kind: "session",
        visibility: "public",
        summary: allow ? "Extra characters allowed this session" : "Extra characters no longer allowed",
        undoable: false,
      });
      return null;
    }),
});

export const start = keyedGmMutation({
  args: {},
  returns: v.object({ startedAt: v.number(), alreadyStarted: v.boolean() }),
  handler: async (ctx) =>
    ctx.once("session_start", {}, async () => {
      const campaignId = ctx.campaign._id;
      const state = await campaignFearState(ctx, campaignId);
      if (state.sessionStartedAt !== undefined) return { startedAt: state.sessionStartedAt, alreadyStarted: true };
      const startedAt = Date.now();
      await ctx.db.patch("campaignState", state._id, { sessionStartedAt: startedAt, extraCharactersSession: undefined });
      const groupId = newGroupId();
      const changes = (await party(ctx, campaignId))
        .filter(({ character }) => character.status === "active")
        .map((c) => ({ ...c, next: onSessionStart(c.sheet, rollDie) }));
      await saveChanged(ctx, { campaignId, actorId: ctx.user._id, groupId, summary: "session start" }, changes);
      await logAction(ctx, { campaignId, actorId: ctx.user._id, kind: "session", visibility: "public", summary: "Session started", groupId, undoable: true });
      return { startedAt, alreadyStarted: false };
    }),
});

export const end = keyedGmMutation({
  args: {},
  returns: v.object({
    /** Wither tokens cleared from every PC. */
    tokens: v.number(),
    fearGained: v.number(),
    /** Tokens past GM Fear's cap of 12: "N Fear lost". */
    fearLost: v.number(),
    /** PCs whose last Hope slot is scarred (CB 106): the GM ends their journey. */
    journeyEnds: v.array(v.object({ characterId: v.id("characters"), name: v.string() })),
    /** The campaign row of the group (undo it to undo the whole End), or null when nothing changed. */
    entryId: v.union(v.id("actionLog"), v.null()),
  }),
  handler: async (ctx) =>
    ctx.once("session_end", {}, async () => {
      const campaignId = ctx.campaign._id;
      const state = await campaignFearState(ctx, campaignId);
      const members = await party(ctx, campaignId);
      const tokens = members.reduce((sum, { sheet }) => sum + sheet.wither, 0);
      const changes = members.map((c) => ({ ...c, next: { ...onSessionEnd(expire(c.sheet, "session")), wither: 0 } }));
      const journeyEnds = members
        .filter(({ character, sheet }) => sheet.journeyEnds && character.status !== "dead" && character.status !== "retired")
        .map(({ character, sheet }) => ({ characterId: character._id, name: sheet.name }));

      const started = state.sessionStartedAt !== undefined;
      if (!started && changes.every(({ sheet, next }) => same(sheet, next))) {
        return { tokens: 0, fearGained: 0, fearLost: 0, journeyEnds, entryId: null };
      }
      if (started) await ctx.db.patch("campaignState", state._id, { sessionStartedAt: undefined, extraCharactersSession: undefined });

      const groupId = newGroupId();
      await saveChanged(ctx, { campaignId, actorId: ctx.user._id, groupId, summary: "session end" }, changes);
      const { gained, lost } = tokens > 0 ? await gainFear(ctx, campaignId, tokens) : { gained: 0, lost: 0 };
      const fearText = tokens > 0 ? `; ${tokens} Wither → +${gained} Fear${lost > 0 ? ` (${lost} Fear lost)` : ""}` : "";
      const entryId = await logAction(ctx, {
        campaignId,
        actorId: ctx.user._id,
        kind: "session",
        visibility: "public",
        summary: `Session ended${fearText}`,
        groupId,
        ...(gained > 0 ? { fearDelta: gained } : {}),
        undoable: true,
      });
      return { tokens, fearGained: gained, fearLost: lost, journeyEnds, entryId };
    }),
});
