/**
 * The rule switches, server side (plan rule-switches RS0). Engine code reads a mode only through `ruleModesOf` /
 * `ruleMode`, and writes a Manual note only through `postRuleNote`. Guide: docs/tasks/TASK-RULES-RS0.md.
 *
 * ```ts
 * if (ruleMode(ctx.campaign, "hopeFearFromRolls") === "manual") {
 *   await postRuleNote(ctx, ctx.campaign, {
 *     ruleId: "hopeFearFromRolls", summary: "Mira rolled with Fear: gain 1 Fear?", characterId, groupId, actorId: ctx.user._id,
 *   });
 * } else {
 *   // Book: today's behaviour.
 * }
 * ```
 */
import { ruleMessages } from "../../src/lib/errors/rules";
import { appError } from "../../src/lib/errors/app-error";
import { resolveRuleModes } from "../../src/lib/rules/resolve";
import type { RuleId, RuleModeKey, RuleModes } from "../../src/lib/rules/registry";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { SUMMARY_MAX } from "./actionLog";
import { liveSession } from "./sessions";

type CampaignRules = Pick<Doc<"campaigns">, "frameId" | "ruleModes">;

/** Every rule's mode in this campaign (unset = Book / the optional rule's default; another frame's rule = Book). */
export function ruleModesOf(campaign: CampaignRules): RuleModes {
  return resolveRuleModes(campaign.frameId, campaign.ruleModes);
}

/** One rule's mode (or a rule's number, such as `spotlightTrackerTokens`) in this campaign. */
export function ruleMode<K extends RuleModeKey>(campaign: CampaignRules, key: K): RuleModes[K] {
  return ruleModesOf(campaign)[key];
}

/** Whether a session is live: rule switches and campaign options are locked then (user 2026-11-05; Q17 a). */
export async function rulesLocked(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<boolean> {
  return (await liveSession(ctx, campaignId)) !== null;
}

/** Throws RULES_LOCKED while a session is live. */
export async function assertRulesUnlocked(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<void> {
  if (await rulesLocked(ctx, campaignId)) throw appError("RULES_LOCKED", ruleMessages.RULES_LOCKED);
}

export type RuleNote = {
  ruleId: RuleId;
  /** One line for the GM: what the app did not do ("Mira rolled with Fear: gain 1 Fear?"). Cut at 300 characters. */
  summary: string;
  /** The character the note is about. Needs `groupId`: a note outside its action's group would block undoing that character's earlier actions. */
  characterId?: Id<"characters">;
  /** The action's `groupId`: undoing the action undoes the note. Without it the note is never undoable. */
  groupId?: string;
  /** Who did the action (the roller, the GM). */
  actorId: Id<"users">;
};

/**
 * Posts a Manual rule's note to the GM: one `actionLog` row, kind `rule`, visibility `gm` (players never receive it;
 * co-GMs do), with `ruleId`. It changes no state. With the action's `groupId` it is undone with the action (it is
 * marked undoable so the group's undo is not refused; Undo on the note undoes the whole action); without one it is
 * never undoable. Written here, not through `logAction`, because a note carries `ruleId` and never a sheet.
 */
export async function postRuleNote(ctx: MutationCtx, campaign: Pick<Doc<"campaigns">, "_id">, note: RuleNote): Promise<Id<"actionLog">> {
  if (note.characterId !== undefined && note.groupId === undefined) {
    throw new Error("postRuleNote: a note about a character needs its action's groupId.");
  }
  return ctx.db.insert("actionLog", {
    campaignId: campaign._id,
    ...(note.characterId !== undefined ? { characterId: note.characterId } : {}),
    actorId: note.actorId,
    kind: "rule",
    visibility: "gm",
    summary: note.summary.slice(0, SUMMARY_MAX),
    ...(note.groupId !== undefined ? { groupId: note.groupId } : {}),
    ruleId: note.ruleId,
    undoable: note.groupId !== undefined,
    at: Date.now(),
  });
}
