import { v } from "convex/values";

import {
  avoidDeath,
  AWAY_REASON_LABELS,
  canMakeDeathMove,
  clearAllHpAndStress,
  DEATH_MOVE_LABELS,
  DeathMoveError,
  deathStatus,
  deathSummary,
  pendingDeathMove,
  riskItAll,
  splitRiskItAll,
  type AwayReason,
} from "../src/lib/domain/death/index";
import { appError, RuleError } from "../src/lib/errors/app-error";
import { resolveOptions } from "../src/lib/frames/options";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { assertOneActive } from "./characters";
import { logAction, undoEntry } from "./lib/actionLog";
import { editable, loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { rollDie } from "./lib/dice";
import { keyedUserMutation, userQuery } from "./lib/functions";
import { applyRule } from "./lib/mechanics";
import { atLeast, campaignAccess, permissionFor } from "./lib/permissions";
import { storedCharacterStatusValidator } from "./lib/validators/characters";
import type { StoredRoll } from "./lib/validators/actionLog";

/**
 * Death moves (D5 T4; Core Book p. 106), scars, and Castle High's less-lethal
 * rule (Hope & Fear p. 127). Under less-lethal, where the character goes
 * (infirmary or sent home) is the player's request when the player makes the
 * move (`away.requested`); the GM confirms or changes it (`settleAway`) and has
 * the final say. The GM's own death move is final at once (LL1). Every move writes an undoable `actionLog` row
 * (kind `death`); `undo` here also puts back the status a move changed.
 *
 * Two moves take two steps; the pending step is read back from the
 * character's latest live log row (`pendingDeathMove`):
 * - Blaze of Glory: `choose` logs the narrated critical success, `finishBlaze` ends the character.
 * - Risk It All won with Hope: `choose` logs the roll, `resolveRiskItAll` applies the player's split.
 */

const moveValidator = v.union(v.literal("blazeOfGlory"), v.literal("avoidDeath"), v.literal("riskItAll"));
const awayReasonValidator = v.union(v.literal("infirmary"), v.literal("sentHome"));
const pendingValidator = v.union(
  v.object({ move: v.literal("blazeOfGlory") }),
  v.object({ move: v.literal("riskItAll"), value: v.number() }),
  v.null(),
);

/** How far back to look for a character's latest live log row (as `undoEntry` does). */
const LATEST_SCAN = 100;
const ACTION_MAX = 200;

async function latestLiveRow(ctx: QueryCtx, characterId: Id<"characters">): Promise<Doc<"actionLog"> | null> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(LATEST_SCAN);
  return rows.find((row) => row.undoneAt === undefined) ?? null;
}

/** The character's latest live row and the death move waiting for its second step (only while the character is active). */
async function deathState(ctx: QueryCtx, character: Doc<"characters">) {
  const latest = await latestLiveRow(ctx, character._id);
  return { latest, pending: character.status === "active" ? pendingDeathMove(latest) : null };
}

/**
 * A death move is due (CB 106), except for a character the GM returned to play
 * with every Hit Point still marked, until they mark one again (LL1 decision 5).
 */
function dueNow(character: Doc<"characters">, sheet: CharacterSheet): boolean {
  return character.deathMoveSpent !== true && canMakeDeathMove({ status: character.status, hp: sheet.hp, hpMax: sheet.hpMax, conditions: sheet.conditions });
}

function lessLethal(campaign: Doc<"campaigns">): boolean {
  return resolveOptions(campaign.frameId, campaign.options).lessLethal;
}

function rule(message: string): never {
  throw new RuleError("DEATH_MOVE_RULE", message);
}

/**
 * Sets the character dead, or away under less-lethal, and logs it. A player's
 * away reason is stored as a request for the GM to settle (LL1); the GM's is
 * final. Returns the row and the new status.
 */
async function leavePlay(
  ctx: MutationCtx & { user: Doc<"users"> },
  campaign: Doc<"campaigns">,
  character: Doc<"characters">,
  sheet: CharacterSheet,
  reason: AwayReason | undefined,
  lead: string,
  roll?: StoredRoll,
) {
  const outcome = deathStatus(lessLethal(campaign), reason);
  const requested = outcome.status === "away" && !atLeast(await permissionFor(ctx, ctx.user, { type: "campaign", campaign }, "owner"), "owner");
  await ctx.db.patch("characters", character._id, {
    status: outcome.status,
    away: outcome.status === "away" ? { ...outcome.away, ...(requested ? { requested: true as const } : {}) } : undefined,
    updatedAt: Date.now(),
  });
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId: ctx.user._id,
    kind: "death",
    visibility: "public",
    summary: `${lead}${deathSummary(sheet.name, outcome, sheet.wither)}${requested ? " The player's request; the GM decides." : ""}`,
    ...(roll ? { roll } : {}),
    before: sheet,
    undoable: true,
  });
  return { entryId, status: outcome.status };
}

const chooseResult = v.object({
  entryId: v.id("actionLog"),
  status: storedCharacterStatusValidator,
  /** The step still to take: `finishBlaze` or `resolveRiskItAll`. */
  pending: pendingValidator,
  hopeDie: v.union(v.number(), v.null()),
  fearDie: v.union(v.number(), v.null()),
  scarred: v.boolean(),
  journeyEnds: v.boolean(),
});

/**
 * Makes a death move for a character whose last Hit Point is marked (CB 106).
 * Owner or GM. Refused with DEATH_MOVE_RULE unless the character is active,
 * not unconscious, at full Hit Points and has no move under way. The server
 * rolls every die. `action` narrates Blaze of Glory's last action;
 * `awayReason` says where a Castle High character goes instead of dying.
 */
export const choose = keyedUserMutation({
  rateLimit: "roll",
  args: {
    characterId: v.id("characters"),
    move: moveValidator,
    action: v.optional(v.string()),
    awayReason: v.optional(awayReasonValidator),
  },
  returns: chooseResult,
  handler: async (ctx, args) =>
    ctx.once("death_choose", args, async () => {
      const { campaign, character, sheet } = await editable(ctx, ctx.user, args.characterId);
      const { pending } = await deathState(ctx, character);
      if (!dueNow(character, sheet)) {
        rule("A death move is made by an active character whose last Hit Point is marked.");
      }
      if (pending !== null) rule(`Finish the ${DEATH_MOVE_LABELS[pending.move]} under way first.`);
      const base = { characterId: character._id, campaignId: campaign._id, actorId: ctx.user._id, kind: "death" as const, visibility: "public" as const, before: sheet, undoable: true };
      const name = sheet.name;

      if (args.move === "blazeOfGlory") {
        const action = args.action?.trim().slice(0, ACTION_MAX);
        const entryId = await logAction(ctx, {
          ...base,
          summary: `${name} goes out in a Blaze of Glory${action ? `: ${action}` : ""}. The action critically succeeds.`,
          roll: { kind: "action", dice: [], modifier: 0, total: 0, outcome: "critical", manual: false },
        });
        return { entryId, status: character.status, pending: { move: "blazeOfGlory" as const }, hopeDie: null, fearDie: null, scarred: false, journeyEnds: false };
      }

      if (args.move === "avoidDeath") {
        const hopeDie = rollDie(12);
        const result = avoidDeath(sheet, hopeDie);
        await saveSheet(ctx, character._id, result.sheet);
        const scar = result.scarred ? `gains a scar${result.journeyEnds ? "; the last Hope slot is gone and their journey ends" : ""}` : "no scar";
        const entryId = await logAction(ctx, {
          ...base,
          summary: `${name} avoids death and drops unconscious. Hope Die ${hopeDie} against level ${sheet.level}: ${scar}.`,
          roll: { kind: "free", dice: [{ sides: 12, value: hopeDie, role: "hope" }], modifier: 0, total: hopeDie, outcome: "none", manual: false },
        });
        return { entryId, status: character.status, pending: null, hopeDie, fearDie: null, scarred: result.scarred, journeyEnds: result.journeyEnds };
      }

      const hope = rollDie(12);
      const fear = rollDie(12);
      const { result } = riskItAll(hope, fear);
      const dice = [
        { sides: 12, value: hope, role: "hope" as const },
        { sides: 12, value: fear, role: "fear" as const },
      ];
      const roll = (outcome: StoredRoll["outcome"]): StoredRoll => ({ kind: "action", dice, modifier: 0, total: hope + fear, outcome, manual: false });
      const lead = `${name} risks it all: Hope ${hope}, Fear ${fear}. `;
      const rolled = { hopeDie: hope, fearDie: fear, scarred: false, journeyEnds: false };
      if (result === "fear") {
        const left = await leavePlay(ctx, campaign, character, sheet, args.awayReason, lead, roll("failFear"));
        return { ...left, pending: null, ...rolled };
      }
      if (result === "critical") {
        await saveSheet(ctx, character._id, clearAllHpAndStress(sheet));
        const entryId = await logAction(ctx, { ...base, summary: `${lead}Matching dice: they stay up and clear all Hit Points and Stress.`, roll: roll("critical") });
        return { entryId, status: character.status, pending: null, ...rolled };
      }
      const entryId = await logAction(ctx, { ...base, summary: `${lead}They stay on their feet and clear ${hope} Hit Points or Stress.`, roll: roll("successHope") });
      return { entryId, status: character.status, pending: { move: "riskItAll" as const, value: hope }, ...rolled };
    }),
});

/** Blaze of Glory's second step: after the action, the character crosses through the veil (or goes away under less-lethal). Owner or GM. */
export const finishBlaze = keyedUserMutation({
  args: { characterId: v.id("characters"), awayReason: v.optional(awayReasonValidator) },
  returns: v.object({ entryId: v.id("actionLog"), status: storedCharacterStatusValidator }),
  handler: async (ctx, args) =>
    ctx.once("death_finish_blaze", args, async () => {
      const { campaign, character, sheet } = await editable(ctx, ctx.user, args.characterId);
      const { pending } = await deathState(ctx, character);
      if (pending?.move !== "blazeOfGlory" || character.status !== "active") rule("No Blaze of Glory is under way.");
      return leavePlay(ctx, campaign, character, sheet, args.awayReason, "");
    }),
});

/** Risk It All won with Hope: clears `hp` Hit Points and `stress` Stress, together the Hope Die (CB 106). Owner or GM. */
export const resolveRiskItAll = keyedUserMutation({
  args: { characterId: v.id("characters"), hp: v.number(), stress: v.number() },
  returns: v.object({ entryId: v.id("actionLog"), hp: v.number(), stress: v.number() }),
  handler: async (ctx, args) =>
    ctx.once("death_resolve_risk", args, async () => {
      const { campaign, character, sheet } = await editable(ctx, ctx.user, args.characterId);
      const { pending } = await deathState(ctx, character);
      if (pending?.move !== "riskItAll" || character.status !== "active") rule("No Risk It All is waiting for its split.");
      const next = applyRule("DEATH_MOVE_RULE", DeathMoveError, () => splitRiskItAll(sheet, pending.value, args.hp, args.stress));
      await saveSheet(ctx, character._id, next);
      const entryId = await logAction(ctx, {
        campaignId: campaign._id,
        characterId: character._id,
        actorId: ctx.user._id,
        kind: "death",
        visibility: "public",
        summary: `${sheet.name} clears ${args.hp} Hit Points and ${args.stress} Stress (Risk It All).`,
        before: sheet,
        undoable: true,
      });
      return { entryId, hp: next.hp, stress: next.stress };
    }),
});

/**
 * GM only: brings an away character (Castle High less-lethal, or benched) back
 * into play, unless its player has another active character (INVALID, X6).
 * Logged, not undoable.
 */
export const returnFromAway = keyedUserMutation({
  args: { characterId: v.id("characters") },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.once("death_return", args, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, args.characterId, "owner");
      if (character.status !== "away") rule("Only an away character can return.");
      await assertOneActive(ctx, campaign, character.ownerId, character._id);
      // LL1 decision 5: back with every Hit Point still marked, they aren't asked for a death move until they mark one again.
      const sheet = readSheet(character.sheet);
      await ctx.db.patch("characters", character._id, {
        status: "active",
        away: undefined,
        deathMoveSpent: sheet.hpMax > 0 && sheet.hp >= sheet.hpMax ? true : undefined,
        updatedAt: Date.now(),
      });
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId: character._id,
        actorId: ctx.user._id,
        kind: "death",
        visibility: "public",
        summary: `${sheet.name} is back in play.`,
        undoable: false,
      });
      return null;
    }),
});

/**
 * GM only (LL1): settles a player's less-lethal request. `reason` confirms the
 * requested place or sets the other one; either way it is final. Refused with
 * DEATH_MOVE_RULE when no request is waiting. Logged, not undoable; it also
 * ends the death move's undo (the GM can still return the character).
 */
export const settleAway = keyedUserMutation({
  args: { characterId: v.id("characters"), reason: awayReasonValidator },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.once("death_settle_away", args, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, args.characterId, "owner");
      const away = character.away;
      if (character.status !== "away" || away?.requested !== true || away.reason === "benched") rule("No less-lethal request is waiting.");
      await ctx.db.patch("characters", character._id, {
        away: { reason: args.reason, ...(away.note === undefined ? {} : { note: away.note }) },
        updatedAt: Date.now(),
      });
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId: character._id,
        actorId: ctx.user._id,
        kind: "death",
        visibility: "public",
        summary: `${away.reason === args.reason ? "The GM confirms" : "The GM decides"}: ${readSheet(character.sheet).name} is ${AWAY_REASON_LABELS[args.reason]}.`,
        undoable: false,
      });
      return null;
    }),
});

/**
 * Undoes a death-move row through `undoEntry` (its actor or the GM, while it
 * is the character's latest live row) and puts the character back to active
 * when that row took them out of play. DEATH_MOVE_RULE for another kind of row.
 */
export const undo = keyedUserMutation({
  args: { entryId: v.id("actionLog") },
  returns: v.object({ undone: v.array(v.id("actionLog")), fearReverted: v.number(), status: storedCharacterStatusValidator }),
  handler: async (ctx, { entryId }) =>
    ctx.once("death_undo", { entryId }, async () => {
      const row = await ctx.db.get("actionLog", entryId);
      if (row === null || (await campaignAccess(ctx, ctx.user, row.campaignId)) === null) throw appError("NOT_FOUND");
      if (row.kind !== "death" || row.characterId === undefined) rule("Only a death move is undone here.");
      const character = await ctx.db.get("characters", row.characterId);
      if (character === null) throw appError("NOT_FOUND");
      // undoEntry also returns a character this row took out of play (dead or away) to active.
      const result = await undoEntry(ctx, ctx.user, entryId);
      const after = await ctx.db.get("characters", character._id);
      // Back in play only while the player has no other active character (X6); the throw rolls the undo back.
      if (after?.status === "active" && character.status !== "active") {
        const campaign = await ctx.db.get("campaigns", character.campaignId);
        if (campaign !== null) await assertOneActive(ctx, campaign, character.ownerId, character._id);
      }
      return { ...result, status: after?.status ?? character.status };
    }),
});

/**
 * What the sheet's death-move modal needs: whether a death move is due, the
 * step waiting to be taken, the latest undoable death row, whether the
 * campaign plays less lethal, and whether the away reason is a player's
 * request the GM has yet to settle (LL1). Everyone who can see the character.
 */
export const state = userQuery({
  args: { characterId: v.id("characters") },
  returns: v.object({
    awaitingMove: v.boolean(),
    pending: pendingValidator,
    undoEntryId: v.union(v.id("actionLog"), v.null()),
    lessLethal: v.boolean(),
    awayRequested: v.boolean(),
  }),
  handler: async (ctx, { characterId }) => {
    const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "view");
    const sheet = readSheet(character.sheet);
    const { latest, pending } = await deathState(ctx, character);
    const due = dueNow(character, sheet);
    return {
      awaitingMove: due && pending === null,
      pending,
      undoEntryId: latest !== null && latest.kind === "death" && latest.undoable ? latest._id : null,
      lessLethal: lessLethal(campaign),
      awayRequested: character.status === "away" && character.away?.requested === true,
    };
  },
});
