import { v } from "convex/values";

import { MAX_LEVEL } from "../src/lib/domain/characters/index";
import { applyLevelUp, LevelUpRuleError, revertLevelUp } from "../src/lib/domain/level-up/index";
import { appError } from "../src/lib/errors/app-error";
import { resolveOptions } from "../src/lib/frames/options";
import { ADVANCEMENT_OPTIONS, type CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { logAction } from "./lib/actionLog";
import { loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { campaignFearState } from "./lib/fear";
import { keyedGmMutation, keyedUserMutation, userQuery } from "./lib/functions";
import { applyRule } from "./lib/mechanics";
import { partyLevelUp as flagParty } from "./lib/partyLevelUp";
import { atLeast, type Permission } from "./lib/permissions";
import { traitIdValidator } from "./lib/validators/characters";

/**
 * Leveling up (D5 T2, CB 109-111). The GM flags the party; each owner then
 * levels up their own character one level at a time (decision 5). Undo takes
 * back only the latest level and can be repeated (decision 4); a player may
 * undo only within the session the level-up happened in, the GM any time
 * (decision 33). The GM can also set a level directly with no automation. Every call writes a public action
 * log row with `undoable: false`: level undo is its own path, and the row
 * stops `actionLog.undo` from restoring a sheet from before the level-up.
 */

const pickValidator = v.object({
  option: v.union(...ADVANCEMENT_OPTIONS.map((o) => v.literal(o))),
  tier: v.number(),
  targets: v.optional(v.array(v.string())),
});

const choiceValidator = v.object({
  picks: v.array(pickValidator),
  experienceName: v.optional(v.string()),
  cardId: v.string(),
  trade: v.optional(v.object({ out: v.string(), in: v.string() })),
  multiclass: v.optional(v.object({ classId: v.string(), domainId: v.string(), subclassId: v.string(), spellcastTrait: v.optional(traitIdValidator) })),
});

const levelResult = v.object({ level: v.number() });

/** The longest the choice's free text and lists may be (validated again by the engine). */
function assertSmall(choice: { picks: unknown[]; experienceName?: string }) {
  if (choice.picks.length > 2 || (choice.experienceName?.length ?? 0) > 200) throw appError("INVALID");
}

/** Rows read after a level-up to find a session boundary; more than this counts as one (conservative). */
const SESSION_SCAN = 200;

/**
 * A real session start or end row of `convex/sessions.ts` (its campaign rows "Session started" and
 * "Session ended…"). Scene ends (`convex/scenes.ts`) share kind "session" but are no boundary.
 */
const isSessionBoundary = (row: Doc<"actionLog">) =>
  row.kind === "session" && row.characterId === undefined && (row.summary === "Session started" || row.summary.startsWith("Session ended"));

/**
 * Whether a session started or ended after `at`. A session running now that started at or before `at`
 * has run throughout (an end clears `sessionStartedAt`, a new start stamps a later time). With none
 * running, the campaign's log rows from `at` on (index `by_campaign_at`, at most SESSION_SCAN) are checked;
 * a boundary in the same millisecond counts.
 */
async function sessionBoundaryAfter(ctx: QueryCtx, campaignId: Id<"campaigns">, at: number): Promise<boolean> {
  const { sessionStartedAt } = await campaignFearState(ctx, campaignId);
  if (sessionStartedAt !== undefined) return sessionStartedAt > at;
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId).gte("at", at))
    .take(SESSION_SCAN + 1);
  return rows.length > SESSION_SCAN || rows.some(isSessionBoundary);
}

const EARLIER_SESSION = "Only the GM can undo a level-up from an earlier session.";

/**
 * Why `permission` may not undo the sheet's latest level-up (decision 33), or null. The GM ("owner")
 * always may; a player only while no session boundary passed since the entry's `at`. An entry without
 * `at` (taken before SS3) is GM only. No entry: null (revertLevelUp refuses it).
 */
async function undoRefusal(ctx: QueryCtx, campaignId: Id<"campaigns">, sheet: CharacterSheet, permission: Permission): Promise<string | null> {
  if (permission === "owner") return null;
  const latest = sheet.advancements.at(-1);
  if (latest === undefined) return null;
  if (latest.at === undefined || (await sessionBoundaryAfter(ctx, campaignId, latest.at))) return EARLIER_SESSION;
  return null;
}

/**
 * Levels a character up by one with the player's choice. Owner or GM; the
 * owner only while the GM's "Party levels up" flag is set (CB 109), the GM
 * always. Clears the flag. LEVEL_UP_RULE for a choice the rules don't allow.
 */
export const apply = keyedUserMutation({
  args: { characterId: v.id("characters"), choice: choiceValidator },
  returns: levelResult,
  handler: async (ctx, { characterId, choice }) =>
    ctx.once("level_up_apply", { characterId, choice }, async () => {
      assertSmall(choice);
      const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
      const sheet = readSheet(character.sheet);
      if (!sheet.levelUpPending && permission !== "owner") throw appError("LEVEL_UP_RULE", "Wait for the GM to call for a level-up.");
      const allowExpansion = resolveOptions(campaign.frameId, campaign.options).hopeAndFear;
      const next = applyRule("LEVEL_UP_RULE", LevelUpRuleError, () =>
        applyLevelUp(sheet, choice, { allowExpansion, newId: () => crypto.randomUUID(), at: Date.now() }),
      );
      await saveSheet(ctx, character._id, next);
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId,
        actorId: ctx.user._id,
        kind: "levelUp",
        visibility: "public",
        summary: `${sheet.name} reached level ${next.level}.`,
        undoable: false,
      });
      return { level: next.level };
    }),
});

/**
 * Undoes the character's latest level (repeatable). Owner or GM. Sets the level-up flag again.
 * LEVEL_UP_RULE for a player once a session started or ended after it (decision 33).
 */
export const undoLast = keyedUserMutation({
  args: { characterId: v.id("characters") },
  returns: levelResult,
  handler: async (ctx, { characterId }) =>
    ctx.once("level_up_undo", { characterId }, async () => {
      const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit");
      const sheet = readSheet(character.sheet);
      const refusal = await undoRefusal(ctx, campaign._id, sheet, permission);
      if (refusal !== null) throw appError("LEVEL_UP_RULE", refusal);
      const next = applyRule("LEVEL_UP_RULE", LevelUpRuleError, () => revertLevelUp(sheet));
      await saveSheet(ctx, character._id, next);
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId,
        actorId: ctx.user._id,
        kind: "levelUp",
        visibility: "public",
        summary: `${sheet.name} went back to level ${next.level}.`,
        undoable: false,
      });
      return { level: next.level };
    }),
});

/**
 * Whether the viewer may undo the character's latest level-up now (the header's − button): false
 * without one, without edit access, or when undoLast would refuse it for a session boundary.
 */
export const canUndo = userQuery({
  args: { characterId: v.id("characters") },
  returns: v.boolean(),
  handler: async (ctx, { characterId }) => {
    const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "view");
    if (!atLeast(permission, "edit")) return false;
    let sheet: CharacterSheet;
    try {
      sheet = readSheet(character.sheet);
    } catch {
      return false;
    }
    const latest = sheet.advancements.at(-1);
    if (latest === undefined || latest.level !== sheet.level) return false;
    return (await undoRefusal(ctx, campaign._id, sheet, permission)) === null;
  },
});

/** GM only: sets the level directly, with no achievements, picks or cards (a correction). */
export const correctLevel = keyedUserMutation({
  args: { characterId: v.id("characters"), level: v.number() },
  returns: levelResult,
  handler: async (ctx, { characterId, level }) =>
    ctx.once("level_up_correct", { characterId, level }, async () => {
      if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw appError("LEVEL_UP_RULE", `Choose a level from 1 to ${MAX_LEVEL}.`);
      const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "owner");
      const sheet = readSheet(character.sheet);
      await saveSheet(ctx, character._id, { ...sheet, level });
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId,
        actorId: ctx.user._id,
        kind: "levelUp",
        visibility: "public",
        summary: `The GM set ${sheet.name} to level ${level}.`,
        undoable: false,
      });
      return { level };
    }),
});

/**
 * GM only: "Party levels up" (CB 109, decision 5). Flags every active
 * character below level 10; dead, retired and away ones are left out.
 * The body lives in convex/lib/partyLevelUp.ts (shared with D10's milestone, Q5).
 */
export const partyLevelUp = keyedGmMutation({
  args: {},
  returns: v.object({ flagged: v.number() }),
  handler: async (ctx) => ctx.once("level_up_party", {}, () => flagParty(ctx, ctx.campaign._id, ctx.user._id)),
});
