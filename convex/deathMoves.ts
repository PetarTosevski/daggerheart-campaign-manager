import { v } from "convex/values";

import {
  avoidDeath,
  AWAY_REASON_LABELS,
  canMakeDeathMove,
  clearAllHpAndStress,
  DEATH_MOVE_LABELS,
  DeathMoveError,
  deathMovePrompted,
  deathStatus,
  deathSummary,
  dropUnconscious,
  manualMoveNote,
  manualMoveSummary,
  pendingDeathMove,
  resolvesItself,
  riskItAll,
  splitRiskItAll,
  type AwayReason,
  type DeathMove,
} from "../src/lib/domain/death/index";
import { appError, RuleError } from "../src/lib/errors/app-error";
import { deathMessages } from "../src/lib/errors/death";
import { resolveOptions } from "../src/lib/frames/options";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { DEATH_REQUEST_GROUP_PREFIX, logAction, undoEntry, viewerCanUndo } from "./lib/actionLog";
import { assertOneActive, editable, loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { withoutCondition } from "./lib/conditionMarkers";
import { rollDie } from "./lib/dice";
import { keyedUserMutation, userQuery } from "./lib/functions";
import { fearFor } from "./lib/fearVisibility";
import { applyRule } from "./lib/mechanics";
import { atLeast, campaignAccess, permissionFor } from "./lib/permissions";
import { postRuleNote, ruleMode } from "./lib/ruleModes";
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
 * HD4 (combat-hud answer 15b): a player's chosen move waits for the GM. A
 * player's `choose` stores it on the character (`deathRequest`) with a feed row
 * and rolls nothing; the GM's `confirm` makes the move exactly as the GM's own
 * `choose` does (dice and outcome), `decline` sends it back. The player takes
 * it back by undoing the request row. Contract: docs/tasks/TASK-HUD-HD4.md.
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

type DeathRequest = NonNullable<Doc<"characters">["deathRequest"]>;

/**
 * The player's death move waiting for the GM (HD4), or null. A request whose
 * feed row was undone (the player took it back, here or from the feed) no
 * longer counts, nor does one on a character who is no longer active.
 */
async function liveRequest(ctx: QueryCtx, character: Doc<"characters">): Promise<DeathRequest | null> {
  const request = character.deathRequest;
  if (request === undefined || character.status !== "active") return null;
  const row = await ctx.db.get("actionLog", request.entryId);
  return row === null || row.undoneAt !== undefined ? null : request;
}

/**
 * The character's latest live row, the death move waiting for its second step
 * (only while the character is active) and the move waiting for the GM.
 */
async function deathState(ctx: QueryCtx, character: Doc<"characters">) {
  const latest = await latestLiveRow(ctx, character._id);
  return { latest, pending: character.status === "active" ? pendingDeathMove(latest) : null, request: await liveRequest(ctx, character) };
}

/** Whether the caller is the campaign's GM (campaign-level `permissionFor`). */
async function isGmOf(ctx: QueryCtx & { user: Doc<"users"> }, campaign: Doc<"campaigns">): Promise<boolean> {
  return atLeast(await permissionFor(ctx, ctx.user, { type: "campaign", campaign }, "owner"), "owner");
}

function notWaiting(): never {
  throw appError("DEATH_MOVE_NOT_WAITING", deathMessages.DEATH_MOVE_NOT_WAITING);
}

/**
 * A death move is due (CB 106), except for a character the GM returned to play
 * with every Hit Point still marked, until they mark one again (LL1 decision 5).
 */
function dueNow(character: Doc<"characters">, sheet: CharacterSheet): boolean {
  return character.deathMoveSpent !== true && canMakeDeathMove({ status: character.status, hp: sheet.hp, hpMax: sheet.hpMax, conditions: sheet.conditions });
}

/** X1 Manual (rule switches RX, CB p.106): nobody is asked for a death move; the GM handles it at the table. */
function promptManual(campaign: Doc<"campaigns">): boolean {
  return ruleMode(campaign, "deathMovePrompt") === "manual";
}

/** The groupId prefix of an X2 Manual move made with no group of its own: its GM note joins the move's row. */
const DEATH_MANUAL_GROUP_PREFIX = "death-manual:";

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
  /** HD4: the GM's `confirm` says whether the away reason stays the player's request; otherwise the caller decides (LL1). */
  opts: MoveOptions = {},
) {
  const outcome = deathStatus(lessLethal(campaign), reason);
  const requested = outcome.status === "away" && (opts.requested ?? !(await isGmOf(ctx, campaign)));
  // dcm-bxp.99.19.63 (user 2026-10-30): a rogue who leaves play drops Cloaked here, saved with the death row (its `before`
  // is the sheet with Cloaked, so undo puts it back).
  const uncloaked = withoutCondition(sheet, "cloaked");
  if (uncloaked !== sheet) await saveSheet(ctx, character._id, uncloaked);
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
    ...(opts.groupId === undefined ? {} : { groupId: opts.groupId }),
    before: sheet,
    undoable: true,
  });
  return { entryId, status: outcome.status };
}

/** HD4: how a confirmed move is written. `groupId` joins the request's feed row, so one undo takes back both. */
type MoveOptions = { requested?: boolean; groupId?: string };

/**
 * Makes a death move now: the server rolls every die and applies the outcome
 * (CB 106). The GM's own `choose` and the GM's `confirm` of a player's request.
 */
async function makeMove(
  ctx: MutationCtx & { user: Doc<"users"> },
  campaign: Doc<"campaigns">,
  character: Doc<"characters">,
  sheet: CharacterSheet,
  move: DeathMove,
  action: string | undefined,
  awayReason: AwayReason | undefined,
  opts: MoveOptions = {},
) {
  const base = {
    characterId: character._id,
    campaignId: campaign._id,
    actorId: ctx.user._id,
    kind: "death" as const,
    visibility: "public" as const,
    before: sheet,
    undoable: true,
    ...(opts.groupId === undefined ? {} : { groupId: opts.groupId }),
  };
  const name = sheet.name;

  if (move === "blazeOfGlory") {
    const entryId = await logAction(ctx, {
      ...base,
      summary: `${name} goes out in a Blaze of Glory${action ? `: ${action}` : ""}. The action critically succeeds.`,
      roll: { kind: "action", dice: [], modifier: 0, total: 0, outcome: "critical", manual: false },
    });
    return { entryId, status: character.status, pending: { move: "blazeOfGlory" as const }, hopeDie: null, fearDie: null, scarred: false, journeyEnds: false };
  }

  // X2 Manual (rule switches RX, CB p.106): Avoid Death and Risk It All roll nothing; the move is logged, the player
  // rolls in the dice box and the GM's note says what to roll and what follows. The GM sets scar, death or healing.
  if (!resolvesItself(move, ruleMode(campaign, "deathMoveResolve"))) {
    const groupId = opts.groupId ?? `${DEATH_MANUAL_GROUP_PREFIX}${character._id}:${Date.now()}`;
    if (move === "avoidDeath") {
      // Avoid Death still drops the character unconscious (no roll decides it), so the move is no longer due.
      await saveSheet(ctx, character._id, withoutCondition(dropUnconscious(sheet), "cloaked"));
    } else {
      // Risk It All changes nothing yet: the move is spent until the last Hit Point is marked again (LL1's flag).
      await ctx.db.patch("characters", character._id, { deathMoveSpent: true, updatedAt: Date.now() });
    }
    const entryId = await logAction(ctx, { ...base, groupId, summary: manualMoveSummary(name, move) });
    // No characterId: the note must not become the character's latest row (the sheet's Undo reads that row).
    await postRuleNote(ctx, campaign, { ruleId: "deathMoveResolve", summary: manualMoveNote(name, move, sheet.level, lessLethal(campaign)), groupId, actorId: ctx.user._id });
    return { entryId, status: character.status, pending: null, hopeDie: null, fearDie: null, scarred: false, journeyEnds: false };
  }

  if (move === "avoidDeath") {
    const hopeDie = rollDie(12);
    const result = avoidDeath(sheet, hopeDie);
    // dcm-bxp.99.19.63 (user 2026-10-30): an unconscious rogue drops Cloaked (any Cloaked), in this same row.
    await saveSheet(ctx, character._id, withoutCondition(result.sheet, "cloaked"));
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
    const left = await leavePlay(ctx, campaign, character, sheet, awayReason, lead, roll("failFear"), opts);
    return { ...left, pending: null, ...rolled };
  }
  if (result === "critical") {
    await saveSheet(ctx, character._id, clearAllHpAndStress(sheet));
    const entryId = await logAction(ctx, { ...base, summary: `${lead}Matching dice: they stay up and clear all Hit Points and Stress.`, roll: roll("critical") });
    return { entryId, status: character.status, pending: null, ...rolled };
  }
  const entryId = await logAction(ctx, { ...base, summary: `${lead}They stay on their feet and clear ${hope} Hit Points or Stress.`, roll: roll("successHope") });
  return { entryId, status: character.status, pending: { move: "riskItAll" as const, value: hope }, ...rolled };
}

const chooseResult = v.object({
  /** The move's feed row; for a player's request (`awaitingGm`), the request row (undo takes the request back). */
  entryId: v.id("actionLog"),
  status: storedCharacterStatusValidator,
  /** The step still to take: `finishBlaze` or `resolveRiskItAll`. */
  pending: pendingValidator,
  hopeDie: v.union(v.number(), v.null()),
  fearDie: v.union(v.number(), v.null()),
  scarred: v.boolean(),
  journeyEnds: v.boolean(),
  /** HD4: true when a player's move now waits for the GM's `confirm` (nothing rolled or applied yet). */
  awaitingGm: v.boolean(),
});

/** What `deathMoves.state` returns for the move waiting for the GM (HD4). */
const requestViewValidator = v.object({
  move: moveValidator,
  /** Blaze of Glory's narrated last action, when given. */
  action: v.optional(v.string()),
  /** Castle High (less lethal): where the player asks the character to go instead of dying. */
  awayReason: v.optional(awayReasonValidator),
  /** The request's feed row: undoing it takes the request back. */
  entryId: v.id("actionLog"),
  at: v.number(),
});

/**
 * Makes a death move for a character whose last Hit Point is marked (CB 106).
 * Owner or GM. Refused with DEATH_MOVE_RULE unless the character is active,
 * not unconscious, at full Hit Points and has no move under way or waiting for
 * the GM. `action` narrates Blaze of Glory's last action; `awayReason` says
 * where a Castle High character goes instead of dying.
 *
 * HD4 (answer 15b): the GM's move is made at once (the server rolls every
 * die). A player's move is stored as waiting for the GM (`awaitingGm: true`):
 * one undoable feed row, nothing rolled or applied until `confirm`.
 *
 * X1 Manual (rule switches RX; user 2026-11-06 "the GM may still record a death move in the app"): a player's `choose`
 * is refused with DEATH_MOVE_RULE (the move is made at the table); the GM's and a co-GM's is made as in Book, then
 * follows X2 (Manual while X1 is Manual: Avoid Death and Risk It All roll nothing, the GM gets the note).
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
      const gm = await isGmOf(ctx, campaign);
      // X1 Manual: nobody is asked, but the GM (or a co-GM) may still record the move made at the table (user 2026-11-06).
      if (promptManual(campaign) && !gm) rule("This campaign makes death moves at the table (House rules).");
      const { pending, request } = await deathState(ctx, character);
      if (!dueNow(character, sheet)) {
        rule("A death move is made by an active character whose last Hit Point is marked.");
      }
      if (pending !== null) rule(`Finish the ${DEATH_MOVE_LABELS[pending.move]} under way first.`);
      if (request !== null) rule(`The ${DEATH_MOVE_LABELS[request.move]} is waiting for the GM.`);
      const action = args.move === "blazeOfGlory" ? args.action?.trim().slice(0, ACTION_MAX) || undefined : undefined;

      if (gm) {
        return { ...(await makeMove(ctx, campaign, character, sheet, args.move, action, args.awayReason)), awaitingGm: false };
      }

      // A player's move waits for the GM (HD4). The request row has no `before` (nothing changed) and a group the
      // confirmed move joins while nothing came between, so one undo takes back both.
      const at = Date.now();
      const entryId = await logAction(ctx, {
        campaignId: campaign._id,
        characterId: character._id,
        actorId: ctx.user._id,
        kind: "death",
        visibility: "public",
        summary: `${sheet.name} chooses ${DEATH_MOVE_LABELS[args.move]}${action ? `: ${action}` : ""}. Waiting for the GM to confirm.`,
        groupId: `${DEATH_REQUEST_GROUP_PREFIX}${character._id}:${at}`,
        undoable: true,
      });
      await ctx.db.patch("characters", character._id, {
        deathRequest: {
          move: args.move,
          ...(action === undefined ? {} : { action }),
          ...(args.awayReason === undefined ? {} : { awayReason: args.awayReason }),
          requestedBy: ctx.user._id,
          entryId,
          at,
        },
        updatedAt: at,
      });
      return { entryId, status: character.status, pending: null, hopeDie: null, fearDie: null, scarred: false, journeyEnds: false, awaitingGm: true };
    }),
});

/**
 * GM only (HD4, answer 15b): confirms the player's death move waiting for the
 * GM and makes it now, exactly as the GM's own `choose` would (the server rolls
 * every die; Blaze of Glory and Risk It All won with Hope keep their second
 * step). `awayReason` (Castle High) sets where the character goes, final; left
 * out, the player's pick stays a request the GM settles later (`settleAway`,
 * LL1). DEATH_MOVE_NOT_WAITING when nothing waits; DEATH_MOVE_RULE when the
 * move is no longer due (a Hit Point was cleared meanwhile: send it back).
 * The rows are the GM's: the GM undoes them, which also takes back the
 * request when nothing came between (the character's death move is due again).
 */
export const confirm = keyedUserMutation({
  rateLimit: "roll",
  args: { characterId: v.id("characters"), awayReason: v.optional(awayReasonValidator) },
  returns: chooseResult,
  handler: async (ctx, args) =>
    ctx.once("death_confirm", args, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, args.characterId, "owner");
      const sheet = readSheet(character.sheet);
      const { latest, request } = await deathState(ctx, character);
      if (request === null) notWaiting();
      if (!dueNow(character, sheet)) rule("The death move is no longer due: send it back.");
      const groupId = latest?._id === request.entryId ? latest.groupId : undefined;
      await ctx.db.patch("characters", character._id, { deathRequest: undefined, updatedAt: Date.now() });
      const opts = { requested: args.awayReason === undefined, ...(groupId === undefined ? {} : { groupId }) };
      const made = await makeMove(ctx, campaign, character, sheet, request.move, request.action, args.awayReason ?? request.awayReason, opts);
      return { ...made, awaitingGm: false };
    }),
});

/**
 * GM only (HD4): sends the player's waiting death move back; nothing was
 * rolled or applied. The request row is undone when it is still the
 * character's latest (so it no longer blocks undoing earlier rows); a public
 * feed line without a character says so. The death move is due again.
 * DEATH_MOVE_NOT_WAITING when nothing waits.
 */
export const decline = keyedUserMutation({
  args: { characterId: v.id("characters") },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.once("death_decline", args, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, args.characterId, "owner");
      const { latest, request } = await deathState(ctx, character);
      if (request === null) notWaiting();
      if (latest?._id === request.entryId) await undoEntry(ctx, ctx.user, request.entryId);
      await ctx.db.patch("characters", character._id, { deathRequest: undefined, updatedAt: Date.now() });
      await logAction(ctx, {
        campaignId: campaign._id,
        actorId: ctx.user._id,
        kind: "death",
        visibility: "public",
        summary: `The GM sends back ${readSheet(character.sheet).name}'s ${DEATH_MOVE_LABELS[request.move]}: choose again.`,
        undoable: false,
      });
      return null;
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
 * is the character's latest live row; every death move, rolled or not (a
 * confirmed move, Blaze of Glory's finish, Risk It All's split), is the GM's
 * alone, while a player may still take back their own waiting request: the
 * player-undo rule, `groupGmOnly`) and puts the character back to active
 * when that row took them out of play. DEATH_MOVE_RULE for another kind of row.
 */
export const undo = keyedUserMutation({
  args: { entryId: v.id("actionLog") },
  /** `fearReverted` is absent for a player while "Players see the GM's Fear" is off (dcm-jh6d.62). */
  returns: v.object({ undone: v.array(v.id("actionLog")), fearReverted: v.optional(v.number()), status: storedCharacterStatusValidator }),
  handler: async (ctx, { entryId }) =>
    ctx.once("death_undo", { entryId }, async () => {
      const row = await ctx.db.get("actionLog", entryId);
      const access = row === null ? null : await campaignAccess(ctx, ctx.user, row.campaignId, "owner");
      if (row === null || access === null) throw appError("NOT_FOUND");
      if (row.kind !== "death" || row.characterId === undefined) rule("Only a death move is undone here.");
      const character = await ctx.db.get("characters", row.characterId);
      if (character === null) throw appError("NOT_FOUND");
      // undoEntry also returns a character this row took out of play (dead or away) to active.
      const result = await undoEntry(ctx, ctx.user, entryId);
      // HD4: undoing a player's request row takes the request back (a stale request is ignored anyway; this tidies it).
      if (character.deathRequest !== undefined && result.undone.includes(character.deathRequest.entryId)) {
        await ctx.db.patch("characters", character._id, { deathRequest: undefined });
      }
      // RX: an undone death move is due again (X2 Manual's Risk It All marked it spent).
      if (character.deathMoveSpent === true) await ctx.db.patch("characters", character._id, { deathMoveSpent: undefined });
      const after = await ctx.db.get("characters", character._id);
      // Back in play only while the player has no other active character (X6); the throw rolls the undo back.
      if (after?.status === "active" && character.status !== "active") {
        const campaign = await ctx.db.get("campaigns", character.campaignId);
        if (campaign !== null) await assertOneActive(ctx, campaign, character.ownerId, character._id);
      }
      return fearFor(ctx, ctx.user, access.campaign, { ...result, status: after?.status ?? character.status }, "fearReverted", access.permission);
    }),
});

/**
 * What the sheet's death-move modal needs: whether a death move is due, the
 * step waiting to be taken, the latest undoable death row, whether the
 * campaign plays less lethal, and whether the away reason is a player's
 * request the GM has yet to settle (LL1). HD4: `request` is the player's
 * move waiting for the GM's confirm (then `awaitingMove` is false and
 * `undoEntryId` is the request row, whose undo takes it back). `undoEntryId`
 * is null for a viewer who may not undo the row (`viewerCanUndo`: a player
 * never undoes a death move, only their waiting request). Everyone who can see the character.
 */
export const state = userQuery({
  args: { characterId: v.id("characters") },
  returns: v.object({
    awaitingMove: v.boolean(),
    pending: pendingValidator,
    request: v.union(requestViewValidator, v.null()),
    undoEntryId: v.union(v.id("actionLog"), v.null()),
    lessLethal: v.boolean(),
    awayRequested: v.boolean(),
    /**
     * X1 Manual (rule switches DEF): true for the GM or a co-GM while the character's death move is due but nobody is
     * asked (`awaitingMove` false): the GM may record the move made at the table with `choose`. Absent otherwise.
     */
    gmRecord: v.optional(v.literal(true)),
  }),
  handler: async (ctx, { characterId }) => {
    const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "view");
    const sheet = readSheet(character.sheet);
    const { latest, pending, request } = await deathState(ctx, character);
    // X1 Manual: nobody is asked (a move under way or waiting for the GM still shows).
    const due = dueNow(character, sheet) && deathMovePrompted({ status: character.status, hp: sheet.hp, hpMax: sheet.hpMax, conditions: sheet.conditions }, ruleMode(campaign, "deathMovePrompt"));
    const gm = await isGmOf(ctx, campaign);
    const undoable = latest !== null && latest.kind === "death" && (await viewerCanUndo(ctx, latest, ctx.user._id, gm));
    const gmRecord = gm && promptManual(campaign) && dueNow(character, sheet) && pending === null && request === null;
    return {
      awaitingMove: due && pending === null && request === null,
      pending,
      request:
        request === null
          ? null
          : {
              move: request.move,
              ...(request.action === undefined ? {} : { action: request.action }),
              ...(request.awayReason === undefined ? {} : { awayReason: request.awayReason }),
              entryId: request.entryId,
              at: request.at,
            },
      undoEntryId: undoable ? latest._id : null,
      lessLethal: lessLethal(campaign),
      awayRequested: character.status === "away" && character.away?.requested === true,
      ...(gmRecord ? { gmRecord: true as const } : {}),
    };
  },
});
