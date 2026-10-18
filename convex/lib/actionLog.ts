/**
 * The action log and undo (D5 T0). Every automated state change in D5 (a roll,
 * a feature, a rest, a death move, Wither, a session hook, an import) writes
 * one row per affected character through `logAction`, in the same mutation as
 * the change. Undo goes through `undoEntry` (public: `actionLog.undo`).
 *
 * Contract:
 * - Pass `before` = the character's sheet BEFORE the change (the `sheet` you
 *   read) and save the sheet before logging; undo restores exactly it, and is
 *   refused (UNDO_STALE) once the character changed after the row, logged or
 *   not, or a player's dice row is older than `PLAYER_DICE_UNDO_MS`.
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
import { assertOneActive, readSheet, storedSheet } from "./characterSheet";
import { revertFear } from "./fear";
import { campaignAccess } from "./permissions";
import type { ActionKind, StoredRoll, Visibility } from "./validators/actionLog";

/** The longest feed line; longer summaries are cut. */
export const SUMMARY_MAX = 300;
/** The most rows one action writes (a party rest: one per PC plus a campaign row). */
const GROUP_MAX = 50;
/** How far back undo looks for a character's latest live row. */
const LATEST_SCAN = 100;
/**
 * How long after a dice row (a roll or a death move) its actor may still undo
 * it; the GM can undo it any time (review M2: no rerolling by undo). A
 * reversible default pending the user's review.
 */
export const PLAYER_DICE_UNDO_MS = 60_000;

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
export async function latestLiveRow(ctx: MutationCtx, characterId: Id<"characters">): Promise<Doc<"actionLog"> | null> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(LATEST_SCAN);
  return rows.find((row) => row.undoneAt === undefined) ?? null;
}

export type UndoResult = { undone: Id<"actionLog">[]; fearReverted: number };

/** Log order: by `at`, then insertion. */
function byTime(a: Doc<"actionLog">, b: Doc<"actionLog">): number {
  return a.at - b.at || a._creationTime - b._creationTime;
}

/**
 * Checks that undoing a group loses nothing newer for one character (`own`:
 * the group's rows of that character):
 * - every live row of the character from its oldest group row on is in the
 *   group (review H2: a Tag Team roll and its apply may be minutes apart, and
 *   a roll in between would otherwise be wiped);
 * - when the group restores the character's sheet, the character has not
 *   changed since its newest group row (review H1: many writes, such as
 *   applyDamage, are not logged). Logged writes stamp `updatedAt` no later
 *   than their row's `at` and undo stamps the undo time, so a newer row undone
 *   since explains a newer `updatedAt`. Not caught: an unlogged change between
 *   two rows that are then undone newest first; closing that needs each row to
 *   store the character's `updatedAt` before the action.
 */
async function assertNothingNewer(ctx: MutationCtx, characterId: Id<"characters">, own: Doc<"actionLog">[], inGroup: Set<string>): Promise<void> {
  const [oldest] = [...own].sort(byTime);
  if (oldest === undefined) return;
  const since = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId).gte("at", oldest.at))
    .take(LATEST_SCAN);
  if (since.length === LATEST_SCAN) throw appError("UNDO_STALE");
  let explained = Math.max(...own.map((r) => r.at));
  for (const r of since) {
    if (inGroup.has(r._id) || byTime(r, oldest) < 0) continue;
    if (r.undoneAt === undefined) throw appError("UNDO_STALE");
    explained = Math.max(explained, r.undoneAt);
  }
  if (!own.some((r) => r.before !== undefined)) return;
  const character = await ctx.db.get("characters", characterId);
  if (character !== null && character.updatedAt > explained) throw appError("UNDO_STALE");
}

/**
 * Undoes a row and the rest of its group. Allowed for the row's actor and the
 * campaign's GM (`permissionFor`); others with access get FORBIDDEN, outsiders
 * NOT_FOUND. Refused with UNDO_STALE when the row is not undoable, already
 * undone, when a player undoes a dice row (roll or death move) older than
 * `PLAYER_DICE_UNDO_MS`, or when anything newer happened to a character in
 * the group (`assertNothingNewer`). Restores each `before` sheet, reverts the
 * group's Fear (floor 0), and marks every row undone.
 */
export async function undoEntry(
  ctx: MutationCtx,
  user: Doc<"users">,
  entryId: Id<"actionLog">,
  /** Kinds with their own undo path (`rest`: `rests.undo` also reopens the rest); refused with UNDO_STALE. */
  refuse: { kinds: ActionKind[]; message: string } = { kinds: [], message: "" },
): Promise<UndoResult> {
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
          .take(GROUP_MAX + 1);
  // A partial group would restore some sheets and miss others: refuse instead.
  if (group.length > GROUP_MAX) throw appError("UNDO_STALE", "This action touched too many characters to undo.");
  if (group.some((r) => refuse.kinds.includes(r.kind))) throw appError("UNDO_STALE", refuse.message);
  if (group.some((r) => !r.undoable || r.undoneAt !== undefined)) throw appError("UNDO_STALE");

  const now = Date.now();
  const dice = group.filter((r) => r.roll !== undefined && (r.kind === "roll" || r.kind === "death"));
  if (!isGm && dice.some((r) => now - r.at > PLAYER_DICE_UNDO_MS)) {
    throw appError("UNDO_STALE", "Only the GM can undo a roll after the first minute.");
  }

  const inGroup = new Set<string>(group.map((r) => r._id));
  const characterIds = [...new Set(group.flatMap((r) => (r.characterId ? [r.characterId] : [])))];
  for (const characterId of characterIds) {
    await assertNothingNewer(
      ctx,
      characterId,
      group.filter((r) => r.characterId === characterId),
      inGroup,
    );
  }

  // A death move starts from an active character; if its row took them out of
  // play (dead or away) and nothing changed them since, undo puts them back.
  const returning: Id<"characters">[] = [];
  for (const r of group) {
    if (r.kind !== "death" || r.characterId === undefined) continue;
    const character = await ctx.db.get("characters", r.characterId);
    if (character && (character.status === "dead" || character.status === "away") && character.updatedAt <= r.at) returning.push(character._id);
  }

  // The oldest snapshot of each character is its state before the whole action.
  // Stamped with the undo time, which the next undo's `assertNothingNewer` relies on.
  const restored = new Set<string>();
  for (const r of [...group].sort(byTime)) {
    if (r.characterId === undefined || r.before === undefined || restored.has(r.characterId)) continue;
    restored.add(r.characterId);
    if ((await ctx.db.get("characters", r.characterId)) === null) continue;
    const sheet = readSheet(JSON.parse(r.before));
    // As saveSheet does: a Hit Point cleared again makes a death move due the next time the last one is marked (decision 5).
    await ctx.db.patch("characters", r.characterId, { sheet: storedSheet(sheet), updatedAt: now, ...(sheet.hp < sheet.hpMax ? { deathMoveSpent: undefined } : {}) });
  }

  for (const id of returning) {
    // Back in play only into a free slot: one active character per player (throws, rolling the undo back).
    const character = await ctx.db.get("characters", id);
    const campaign = await ctx.db.get("campaigns", row.campaignId);
    if (character && campaign) await assertOneActive(ctx, campaign, character.ownerId, id);
    await ctx.db.patch("characters", id, { status: "active", away: undefined, updatedAt: now });
  }

  const fear = group.reduce((sum, r) => sum + (r.fearDelta ?? 0), 0);
  const fearReverted = fear === 0 ? 0 : (await revertFear(ctx, row.campaignId, fear)).reverted;

  for (const r of group) await ctx.db.patch("actionLog", r._id, { undoneAt: now, undoneBy: user._id });
  return { undone: group.map((r) => r._id), fearReverted };
}
