/**
 * R7 "Help an Ally" (CB p.90; plan rule-switches WR, user answer Q3 a). The roller names the PCs who help; each helper
 * spends 1 Hope and adds a d6 advantage die (the highest advantage die counts, `advantagePlan`). Nobody helps on a
 * reaction roll (CB p.99).
 *
 * - Book: `helpers` (character ids, intents only) names them. Each must be an active PC of the campaign other than the
 *   roller, able to act (not unconscious) and holding a Hope; else the roll is refused (DICE_RULE, NOT_ENOUGH_HOPE naming
 *   the helper). The bare `help` counter is refused. `payHelpers` takes 1 Hope from each in the roll's group, one public
 *   row per helper ("Theo helped Mira (−1 Hope)") with the sheet before, so undoing the roll gives the Hope back.
 * - Manual: today's counter (`help`, plus any `helpers` sent, as dice only); no Hope is taken and the GM gets "2 PCs
 *   helped Mira: each spends 1 Hope?" in the roll's group.
 *
 * Callers: `rolls.duality` (the dice box, typed-in dice) and `resolveAttack` (the attack panel). Card uses keep the
 * counter (open question in docs/tasks/TASK-RULES-WR.md).
 *
 * ```ts
 * const help = await planHelp(ctx, campaign, { characterId, name: "Mira" }, args);   // reads and checks only
 * const rolled = await resolveDuality(ctx, loaded, { ...args, help: help.help }, rng, false);
 * // ... log the roll's row in `groupId` ...
 * await payHelpers(ctx, campaign, help, { groupId, actorId, rollerName: "Mira" });   // Book: Hope and rows; Manual: the note
 * ```
 */
import { v } from "convex/values";

import { spendHope } from "../../src/lib/domain/dice/index";
import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction } from "./actionLog";
import { noteHopeSpent, readSheet, saveSheet } from "./characterSheet";
import { postRuleNote, ruleMode } from "./ruleModes";

/** The most helpers a roll names (the dice box's advantage limit). */
export const MAX_HELPERS = 6;

/** The roll argument: the PCs who help (R7 Book). Optional: absent = nobody. */
export const helpersField = v.optional(v.array(v.id("characters")));

export type HelpPlan = {
  /** The help dice the roll adds. */
  help: number;
  /** Book: the helpers who pay 1 Hope each. Manual: empty. */
  helpers: { characterId: Id<"characters">; name: string }[];
  /** Manual: the GM's line, or null. */
  note: string | null;
};

export const NO_HELP: HelpPlan = { help: 0, helpers: [], note: null };

/** R7 Manual's GM line: "2 PCs helped Mira: each spends 1 Hope?". */
export function helpNote(name: string, help: number): string {
  return help === 1 ? `1 PC helped ${name}: spend 1 Hope?` : `${help} PCs helped ${name}: each spends 1 Hope?`;
}

/**
 * Reads and checks the roll's help (writes nothing). Refusals: DICE_RULE (help on a reaction roll, too many or repeated
 * helpers, the roller, a character of another campaign or not active or unconscious, the bare counter in Book),
 * NOT_ENOUGH_HOPE (a helper without Hope, named).
 */
export async function planHelp(
  ctx: QueryCtx,
  campaign: Pick<Doc<"campaigns">, "_id" | "frameId" | "ruleModes">,
  roller: { characterId: Id<"characters">; name: string },
  args: { kind: "action" | "reaction"; help: number; helpers?: readonly Id<"characters">[] },
): Promise<HelpPlan> {
  const ids = args.helpers ?? [];
  if (args.kind === "reaction" && (args.help > 0 || ids.length > 0)) throw appError("DICE_RULE", "Nobody can help on a reaction roll (CB p.99).");
  if (ids.length > MAX_HELPERS || new Set(ids).size !== ids.length) throw appError("DICE_RULE", "Name each helper once.");
  if (ruleMode(campaign, "helpAnAlly") === "manual") {
    const help = args.help + ids.length;
    return { help, helpers: [], note: help > 0 ? helpNote(roller.name, help) : null };
  }
  if (args.help > 0) throw appError("DICE_RULE", "Tick the PCs who help: each spends 1 Hope (CB p.90).");
  const helpers: HelpPlan["helpers"] = [];
  for (const id of ids) {
    if (id === roller.characterId) throw appError("DICE_RULE", "You can't help your own roll.");
    const character = await ctx.db.get("characters", id);
    if (character === null || character.campaignId !== campaign._id) throw appError("DICE_RULE", "Pick helpers from this campaign's PCs.");
    const sheet = readSheet(character.sheet);
    if (character.status !== "active" || sheet.conditions.includes("unconscious")) throw appError("DICE_RULE", `${sheet.name} can't help right now.`);
    if (sheet.hope < 1) throw appError("NOT_ENOUGH_HOPE", `${sheet.name} has no Hope to help.`, { resource: "hope", need: 1, have: sheet.hope });
    helpers.push({ characterId: id, name: sheet.name });
  }
  return { help: helpers.length, helpers, note: null };
}

/**
 * Applies a planned help in the roll's group: Book takes 1 Hope from each helper (read again, so a write earlier in this
 * mutation is kept) and logs "Theo helped Mira (−1 Hope)" with the sheet before (undo refunds it); Manual posts the note.
 */
export async function payHelpers(ctx: MutationCtx, campaign: Pick<Doc<"campaigns">, "_id">, plan: HelpPlan, row: { groupId: string; actorId: Id<"users">; rollerName: string }): Promise<void> {
  if (plan.note !== null) await postRuleNote(ctx, campaign, { ruleId: "helpAnAlly", summary: plan.note, groupId: row.groupId, actorId: row.actorId });
  for (const helper of plan.helpers) {
    const character = await ctx.db.get("characters", helper.characterId);
    if (character === null) throw appError("NOT_FOUND");
    const sheet = readSheet(character.sheet);
    if (sheet.hope < 1) throw appError("NOT_ENOUGH_HOPE", `${sheet.name} has no Hope to help.`, { resource: "hope", need: 1, have: sheet.hope });
    await saveSheet(ctx, character._id, spendHope(sheet, 1), character);
    noteHopeSpent(ctx, character._id, 1);
    await logAction(ctx, {
      campaignId: campaign._id,
      characterId: character._id,
      actorId: row.actorId,
      kind: "feature",
      visibility: "public",
      summary: `${sheet.name} helped ${row.rollerName} (−1 Hope)`,
      groupId: row.groupId,
      before: sheet,
      undoable: true,
    });
  }
}
