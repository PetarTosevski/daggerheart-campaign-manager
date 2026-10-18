/**
 * The action log and undo (D5 T0). Every automated state change in D5 (a roll,
 * a feature, a rest, a death move, Wither, a session hook, an import) writes
 * one row per affected character through `logAction`, in the same mutation as
 * the change. Undo goes through `undoEntry` (public: `actionLog.undo`).
 *
 * Contract:
 * - Pass `before` = the character's sheet BEFORE the change (the `sheet` you
 *   read); undo restores exactly it, so later changes to that character must
 *   be logged too or they are lost on undo.
 * - Pass `fearDelta` = the Fear `gainFear` actually gained (`gained`), never
 *   the requested amount; undo takes it back through `revertFear`.
 * - One action touching several characters (rest, tag team, Life Support)
 *   gives every row the same `groupId` (`newGroupId()`); they undo together.
 * - `undoable: false` for rows with their own undo path (level-up).
 * - `visibility: "gm"` only for GM free rolls (decision 2); everything else is public.
 *
 * ```ts
 * const groupId = newGroupId();
 * const { gained } = await gainFear(ctx, campaign._id, 1);
 * await logAction(ctx, {
 *   campaignId: campaign._id, characterId, actorId: ctx.user._id, kind: "roll", visibility: "public",
 *   summary: "Agility 14 with Fear", roll, groupId, before: sheet, fearDelta: gained, undoable: true,
 * });
 * ```
 */
import { appError } from "../../src/lib/errors/app-error";
import type { CharacterSheetInput } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { readSheet, saveSheet, storedSheet } from "./characterSheet";
import { revertFear } from "./fear";
import { campaignAccess } from "./permissions";
import type { ActionKind, StoredRoll, Visibility } from "./validators/actionLog";

/** The longest feed line; longer summaries are cut. */
export const SUMMARY_MAX = 300;
/** The most rows one action writes (a party rest: one per PC plus a campaign row). */
const GROUP_MAX = 50;
/** How far back undo looks for a character's latest live row. */
const LATEST_SCAN = 100;

export type LogEntry = {
  campaignId: Id<"campaigns">;
  characterId?: Id<"characters">;
  actorId: Id<"users">;
  kind: ActionKind;
  visibility: Visibility;
  summary: string;
  roll?: StoredRoll;
  groupId?: string;
  /** The character's sheet before the change; needs `characterId`. */
  before?: CharacterSheetInput;
  fearDelta?: number;
  undoable: boolean;
};

/** A new id for the rows of one action. */
export function newGroupId(): string {
  return crypto.randomUUID();
}

/** Appends one row, stamped now. */
export async function logAction(ctx: MutationCtx, entry: LogEntry): Promise<Id<"actionLog">> {
  const { before, summary, ...rest } = entry;
  if (before !== undefined && entry.characterId === undefined) throw new Error("logAction: `before` needs a characterId.");
  return ctx.db.insert("actionLog", {
    ...rest,
    summary: summary.slice(0, SUMMARY_MAX),
    ...(before !== undefined ? { before: JSON.stringify(storedSheet(before)) } : {}),
    at: Date.now(),
  });
}

/** The character's newest row that is not undone (an undoable or not), or null: any newer action blocks undoing an older one. */
async function latestLiveRow(ctx: MutationCtx, characterId: Id<"characters">): Promise<Doc<"actionLog"> | null> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(LATEST_SCAN);
  return rows.find((row) => row.undoneAt === undefined) ?? null;
}

export type UndoResult = { undone: Id<"actionLog">[]; fearReverted: number };

/**
 * Undoes a row and the rest of its group. Allowed for the row's actor and the
 * campaign's GM (`permissionFor`); others with access get FORBIDDEN, outsiders
 * NOT_FOUND. Refused with UNDO_STALE when the row is not undoable, already
 * undone, or, for any character in the group, not that character's latest
 * live row. Restores each `before` sheet, reverts the group's Fear (floor 0),
 * and marks every row undone.
 */
export async function undoEntry(ctx: MutationCtx, user: Doc<"users">, entryId: Id<"actionLog">): Promise<UndoResult> {
  const row = await ctx.db.get("actionLog", entryId);
  if (row === null) throw appError("NOT_FOUND");
  const access = await campaignAccess(ctx, user, row.campaignId, "owner");
  if (access === null) throw appError("NOT_FOUND");
  const isGm = access.permission === "owner";
  if (!isGm && row.visibility === "gm") throw appError("NOT_FOUND");
  if (!isGm && row.actorId !== user._id) throw appError("FORBIDDEN");

  const group =
    row.groupId === undefined
      ? [row]
      : await ctx.db
          .query("actionLog")
          .withIndex("by_campaign_group", (q) => q.eq("campaignId", row.campaignId).eq("groupId", row.groupId))
          .take(GROUP_MAX);
  if (group.some((r) => !r.undoable || r.undoneAt !== undefined)) throw appError("UNDO_STALE");

  const inGroup = new Set<string>(group.map((r) => r._id));
  const characterIds = [...new Set(group.flatMap((r) => (r.characterId ? [r.characterId] : [])))];
  for (const characterId of characterIds) {
    const latest = await latestLiveRow(ctx, characterId);
    if (latest === null || !inGroup.has(latest._id)) throw appError("UNDO_STALE");
  }

  // The oldest snapshot of each character is its state before the whole action.
  const oldestFirst = [...group].sort((a, b) => a.at - b.at || a._creationTime - b._creationTime);
  const restored = new Set<string>();
  for (const r of oldestFirst) {
    if (r.characterId === undefined || r.before === undefined || restored.has(r.characterId)) continue;
    restored.add(r.characterId);
    if ((await ctx.db.get("characters", r.characterId)) === null) continue;
    await saveSheet(ctx, r.characterId, readSheet(JSON.parse(r.before)));
  }

  const fear = group.reduce((sum, r) => sum + (r.fearDelta ?? 0), 0);
  const fearReverted = fear === 0 ? 0 : (await revertFear(ctx, row.campaignId, fear)).reverted;

  const now = Date.now();
  for (const r of group) await ctx.db.patch("actionLog", r._id, { undoneAt: now, undoneBy: user._id });
  return { undone: group.map((r) => r._id), fearReverted };
}
