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
 *   not, and (UNDO_EXPIRED) for a player when the action rolled (`groupRolled`).
 * - Pass `fearDelta` = the Fear `gainFear` actually gained (`gained`), never
 *   the requested amount; undo takes it back through `revertFear`.
 * - A row with `before` takes what the character's `saveSheet` calls in this mutation added to the live session's
 *   Hope spent / HP marked (`sessionTally`, dcm-z9rz.22); undo takes it back off that session's row (floor 0).
 * - One action touching several characters (rest, tag team, Life Support)
 *   gives every row the same `groupId` (`newGroupId()`); they undo together.
 * - `undoable: false` for rows with their own undo path (level-up).
 * - `visibility: "gm"` only for GM free rolls (decision 2) and the GM's row of a combat action (CA3: damage, severity,
 *   HP; U1); everything else is public.
 * - A combat action passes `adversaryBefore` (the instances before it, on its GM row); undo restores them (U4) unless an
 *   instance changed after the group's newest row (UNDO_STALE), and declines the group's open Minion offer.
 * - End day / a Witherwild day jump forward passes `timeChange` (the calendar before and after, CT2, dcm-jq4b) on its
 *   campaign row; undo moves the calendar (and the time of day End day reset) back while it still stands at `after`
 *   (the latest day's end). Undoing an older one gives back its uses only, with a feed line (user answer 2026-11-01).
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
import { formatCalendarDay } from "../../src/lib/domain/campaign-time/index";
import { appError } from "../../src/lib/errors/app-error";
import type { CharacterSheetInput } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { refundTokenSpends } from "./actionTokens";
import { assertOneActive, readSheet, revertSessionTally, storedSheet, takeSessionTally, takeWakeNote } from "./characterSheet";
import { closeRequest, declineGroupOffers, openRequests } from "./combatRequests";
import { revertTicks } from "./countdownTicks";
import { revertFear } from "./fear";
import { recordHistory } from "../tables/history";
import { refuseArchived } from "./archived";
import { campaignAccess } from "./permissions";
import type { ActionKind, AdversaryBefore, CampaignTimeSnapshot, ResultPanel, SpotlightBefore, StoredRoll, TargetDamage, TimeChange, Visibility } from "./validators/actionLog";

/** The longest feed line; longer summaries are cut. */
export const SUMMARY_MAX = 300;

/**
 * C4 Manual: posts the wake note a save left for this character ("Mira had a Hit Point cleared: wake her?"), once, as a
 * GM rule note (the row `postRuleNote` in ./ruleModes writes; written here so ./characterSheet needs no ./ruleModes).
 * `logAction` calls it for the character's next row in this mutation, with the row's group (undoing the action removes
 * the note); an unlogged write (`characters.adjustResource`) calls it with no group: the note then names no character
 * and is never undoable, like that write's other notes.
 */
export async function postWakeNote(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  characterId: Id<"characters">,
  actorId: Id<"users">,
  groupId?: string,
): Promise<void> {
  const summary = takeWakeNote(ctx, characterId);
  if (summary === undefined) return;
  await ctx.db.insert("actionLog", {
    campaignId,
    ...(groupId !== undefined ? { characterId, groupId } : {}),
    actorId,
    kind: "rule",
    visibility: "gm",
    summary: summary.slice(0, SUMMARY_MAX),
    ruleId: "unconscious",
    undoable: groupId !== undefined,
    at: Date.now(),
  });
}
/** The most rows one action writes (a party rest: one per PC plus a campaign row). */
const GROUP_MAX = 50;
/** How far back undo looks for a character's latest live row. */
const LATEST_SCAN = 100;
/**
 * THE player-undo rule (user answers 2026-11-02, Combat HUD: "If the roll has happened players can't undo rolls"; "Yes,
 * GM-only undo of rolls"). Decided per action (the row's `groupId` group) from the stored roll data:
 * - Rolled: any row of the group carries a `roll` (an action, reaction, damage or death-move roll, a PC's attack or card
 *   use that rolled, a GM-confirmed death move, a move whose Cloaked roll joined it). Only the GM undoes it; a player
 *   gets UNDO_EXPIRED ("Only the GM can undo a roll").
 * - Rolled nothing: a feature use without dice, a tracker edit, a death-move request still waiting for the GM (HD4's
 *   "Take it back"), an import. Its actor (or the GM) may undo it.
 * - Death moves (user 2026-11-03, "Players can't undo death moves"): a group holding any death-move row other than a
 *   waiting request (`isDeathRequestRow`) is GM-only too, rolled or not: a confirmed move, Blaze of Glory's finish step,
 *   Risk It All's split. A player gets UNDO_EXPIRED ("Only the GM can undo a death move.").
 * `groupGmOnly` is the whole rule. Token moves, requests and waiting uses are taken back through their own paths (`combatTokens.move`,
 * `combatWithdraw.withdraw`), never by undoing a roll.
 * `undoEntry` enforces it; `feed.list`'s `canUndo` and `deathMoves.state`'s `undoEntryId` apply it (`viewerCanUndo`), so
 * a player never sees an Undo they cannot use.
 */
export function groupRolled(group: readonly Pick<Doc<"actionLog">, "roll">[]): boolean {
  return group.some((r) => r.roll !== undefined);
}

/** The groupId prefix of a player's death-move request row (HD4, `deathMoves.choose`). */
export const DEATH_REQUEST_GROUP_PREFIX = "death-request:";

type UndoRuleRow = Pick<Doc<"actionLog">, "kind" | "roll" | "before" | "groupId">;

/** A player's death-move request row waiting for the GM (HD4): kind death, no roll, no `before`, a `death-request:` group. */
export function isDeathRequestRow(row: UndoRuleRow): boolean {
  return row.kind === "death" && row.roll === undefined && row.before === undefined && (row.groupId?.startsWith(DEATH_REQUEST_GROUP_PREFIX) ?? false);
}

/** The death-move exception (user 2026-11-03): the group holds a death-move row that is not a waiting request. */
export function groupDeathMove(group: readonly UndoRuleRow[]): boolean {
  return group.some((r) => r.kind === "death" && !isDeathRequestRow(r));
}

/** THE player-undo rule: whether only the GM may undo this group (it rolled, or it is a death move). */
export function groupGmOnly(group: readonly UndoRuleRow[]): boolean {
  return groupRolled(group) || groupDeathMove(group);
}

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
  /** Adversary instances before a combat action (CA3): undo writes them back. */
  adversaryBefore?: AdversaryBefore[];
  fearDelta?: number;
  /** An action roll with Hope: whether it gave the Hope (`rolls.storeSlayerDie` takes it back). */
  hopeGained?: boolean;
  /** End day / a day jump forward (CT2): the calendar before and after, on the group's campaign row. */
  timeChange?: TimeChange;
  /** dcm-uemx: only on the `visibility: "gm"` row of a PC's card use or attack (severity and HP per adversary hit, U1). */
  targetDamage?: TargetDamage[];
  undoable: boolean;
};

/** A new id for the rows of one action. */
export function newGroupId(): string {
  return crypto.randomUUID();
}

/**
 * Appends one row, stamped now. C4 Manual (plan rule-switches WD): when a save in this mutation kept the character
 * unconscious (`saveSheet`), the row is followed by the GM's note "Mira had a Hit Point cleared: wake her?" in the row's
 * group (undone with it); a row with no group gets a note that names no character and is never undoable.
 */
export async function logAction(ctx: MutationCtx, entry: LogEntry): Promise<Id<"actionLog">> {
  const { before, summary, ...rest } = entry;
  if (before !== undefined && entry.characterId === undefined) throw new Error("logAction: `before` needs a characterId.");
  // U1: severity and HP marked are adversary numbers; only a GM row may carry them.
  if (entry.targetDamage !== undefined && entry.visibility !== "gm") throw new Error("logAction: `targetDamage` goes on a GM row only.");
  // dcm-z9rz.22: a row that restores the sheet on undo carries what its saves added to the session tally.
  const sessionTally = before !== undefined && entry.characterId !== undefined ? takeSessionTally(ctx, entry.characterId) : undefined;
  const id = await ctx.db.insert("actionLog", {
    ...rest,
    summary: summary.slice(0, SUMMARY_MAX),
    ...(before !== undefined ? { before: JSON.stringify(storedSheet(before)) } : {}),
    ...(sessionTally !== undefined ? { sessionTally } : {}),
    at: Date.now(),
  });
  if (entry.characterId !== undefined) await postWakeNote(ctx, entry.campaignId, entry.characterId, entry.actorId, entry.groupId);
  return id;
}

/**
 * dcm-uemx: stores what a PC's use showed its player in the result panel on the use's public row (`entryId`), so the GM's
 * HUD shows the same panel (`combatHud.playerResults`). Written once the use is resolved (its prompts and Minion offer
 * come after the row). Public rows only: it carries no adversary number (U1).
 */
export async function attachResultPanel(ctx: MutationCtx, entryId: Id<"actionLog">, panel: ResultPanel): Promise<void> {
  const row = await ctx.db.get("actionLog", entryId);
  if (row === null || row.visibility !== "public") throw new Error("attachResultPanel: a public row only.");
  await ctx.db.patch("actionLog", entryId, { resultPanel: panel });
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

/** The rows of a row's action (its group, at most `GROUP_MAX + 1` read: more is refused by undo). */
async function groupOf(ctx: QueryCtx, row: Doc<"actionLog">): Promise<Doc<"actionLog">[]> {
  if (row.groupId === undefined) return [row];
  return ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", row.campaignId).eq("groupId", row.groupId))
    .take(GROUP_MAX + 1);
}

/**
 * Whether the viewer may press Undo on a live undoable row, before the checks only the mutation makes (UNDO_STALE):
 * the GM always; a player only on their own public row of an action that rolled nothing and is no death move (`groupGmOnly`). One group
 * read for a player's own grouped row.
 */
export async function viewerCanUndo(ctx: QueryCtx, row: Doc<"actionLog">, viewerId: Id<"users">, isGm: boolean): Promise<boolean> {
  if (!row.undoable || row.undoneAt !== undefined) return false;
  if (isGm) return true;
  if (row.actorId !== viewerId || row.visibility !== "public") return false;
  return !groupGmOnly(await groupOf(ctx, row));
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
 *   store the character's `updatedAt` before the action (dcm-bxp.31 part 1,
 *   open: see docs/tasks/TASK-LN-N2.md).
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
 * The adversary instances a group changed (`adversaryBefore`, plan combat-actions CA0 / CA3), each with its oldest
 * snapshot (its state before the whole action). Refused with UNDO_STALE when an instance changed after the group's
 * newest row (a tracker click, another attack): undo would wipe it, as for sheets. A deleted instance is skipped.
 */
async function adversariesToRestore(ctx: MutationCtx, group: Doc<"actionLog">[]): Promise<AdversaryBefore[]> {
  const latest = Math.max(...group.map((r) => r.at));
  const oldest = new Map<string, AdversaryBefore>();
  for (const r of [...group].sort(byTime)) {
    for (const b of r.adversaryBefore ?? []) if (!oldest.has(b.instanceId)) oldest.set(b.instanceId, b);
  }
  const restore: AdversaryBefore[] = [];
  for (const b of oldest.values()) {
    const instance = await ctx.db.get("encounterAdversaries", b.instanceId);
    if (instance === null || instance.campaignId !== group[0]!.campaignId) continue;
    if (instance.updatedAt > latest) throw appError("UNDO_STALE");
    restore.push(b);
  }
  return restore;
}

/**
 * Declines the open `incomingHit` rows of an undone group (AA2b; AA2's open item: "actionLog undo declines open incomingHit
 * rows of the undone group"), and its open `gmPrompt` rows (dcm-bxp.99.32.27: an undone adversary feature use takes its
 * GM prompts with it), and its open `allyPick` rows (FH-AP, user 2026-11-05: undoing the use cancels its outstanding picks).
 * Open requests per campaign are few (`openRequests` is bounded).
 */
async function declineGroupHits(ctx: MutationCtx, campaignId: Id<"campaigns">, groupId: string, by: Id<"users">): Promise<void> {
  for (const r of await openRequests(ctx, campaignId)) {
    if ((r.payload.kind === "incomingHit" || r.payload.kind === "gmPrompt" || r.payload.kind === "allyPick") && r.payload.groupId === groupId) await closeRequest(ctx, r._id, "declined", by);
  }
}

const sameDay = (a: CampaignTimeSnapshot, b: CampaignTimeSnapshot) => a.week === b.week && a.cycle === b.cycle && a.cycleDay === b.cycleDay;

/**
 * The calendar half of undoing an End day / a day jump (CT2, dcm-jq4b; user answer 2026-11-01). While the campaign still
 * stands on the day the action reached (`after`: no later day has passed), the calendar goes back to `before` (recorded
 * in `history` as every time change is) and the time of day End day reset comes back. Otherwise a later day stands: the
 * group's uses come back (the caller restores them) and the calendar stays, with a public feed line saying so.
 */
async function restoreTime(ctx: MutationCtx, user: Doc<"users">, row: Doc<"actionLog">, time: TimeChange): Promise<void> {
  const current = await ctx.db
    .query("campaignTime")
    .withIndex("by_campaign", (q) => q.eq("campaignId", row.campaignId))
    .unique();
  if (current !== null && sameDay(current, time.after)) {
    const before = { week: time.before.week, cycle: time.before.cycle, cycleDay: time.before.cycleDay };
    await ctx.db.patch("campaignTime", current._id, before);
    await recordHistory(ctx, user._id, {
      campaignId: row.campaignId,
      kind: "campaignTime",
      action: "undoEndDay",
      before: { week: current.week, cycle: current.cycle, cycleDay: current.cycleDay },
      after: before,
    });
    if (time.timeOfDayBefore !== undefined) await ctx.db.patch("campaigns", row.campaignId, { timeOfDay: time.timeOfDayBefore });
    return;
  }
  const stands = current === null ? "" : `; the calendar stays on ${formatCalendarDay(current.week, current.cycleDay)}`;
  await logAction(ctx, {
    campaignId: row.campaignId,
    actorId: user._id,
    kind: "session",
    visibility: "public",
    summary: `End of ${formatCalendarDay(time.before.week, time.before.cycleDay)} undone: its uses are back${stands} (a later day has passed)`,
    undoable: false,
  });
}

/** How many of the GM's rows since the roll's move `restoreSpotlight` reads to see whether the GM acted. */
const GM_ACTED_SCAN = 50;

/**
 * The spotlight half of undoing a PC action roll that moved it to the GM (S1, plan rule-switches CU2, bead
 * dcm-bxp.99.32.10; CB p.100: "until someone fails a roll or rolls with Fear"). The roll's action stored the campaign's
 * spotlight row as it stood before (`spotlightBefore`, written by convex/lib/rollAftermath.ts). It goes back only while
 * the GM's hold is still the one the roll began: the GM holds it, since the move (`movedAt`), for a roll's reason, with no
 * adversary lit, and the GM made no adversary move since (a live `adversary` row outside the undone group). Then the row
 * before comes back as it was (none: the whole party holds it; a PC no longer in the campaign: the whole party).
 * Otherwise (the GM handed it on, spotlighted an adversary or acted with one) the spotlight stays where it is: the
 * GM's turn has begun, and undoing the roll doesn't undo it (the GM hands it back by hand). It is written here, not in
 * ./spotlight.ts, so this module does not import the spotlight helpers (which import this one); a restore is never a new
 * spotlight, so it counts no session spotlight.
 */
async function restoreSpotlight(ctx: MutationCtx, campaignId: Id<"campaigns">, before: SpotlightBefore, inGroup: Set<string>): Promise<void> {
  const current = await ctx.db
    .query("combatSpotlight")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .first();
  if (current === null || current.holder.kind !== "gm" || current.since !== before.movedAt) return;
  if ((current.reason !== "rollWithFear" && current.reason !== "failedRoll") || current.adversaryTokenId !== undefined) return;
  const gmRows = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_visibility_at", (q) => q.eq("campaignId", campaignId).eq("visibility", "gm").gte("at", before.movedAt))
    .take(GM_ACTED_SCAN);
  if (gmRows.some((r) => r.kind === "adversary" && r.undoneAt === undefined && !inGroup.has(r._id))) return;
  let row = before.row;
  if (row !== null && row.holder.kind === "pc") {
    const character = await ctx.db.get("characters", row.holder.characterId);
    if (character === null || character.campaignId !== campaignId) row = null;
  }
  if (row === null) await ctx.db.delete("combatSpotlight", current._id);
  else await ctx.db.replace("combatSpotlight", current._id, { campaignId, ...row });
}

/**
 * Undoes a row and the rest of its group. Allowed for the row's actor and the
 * campaign's GM (`permissionFor`); others with access get FORBIDDEN, outsiders
 * NOT_FOUND. Refused with UNDO_STALE when the row is not undoable, already
 * undone, or when anything newer happened to a character in the group
 * (`assertNothingNewer`); with UNDO_EXPIRED when a player undoes an action
 * that rolled (`groupRolled`: the player-undo rule); with
 * UNDO_USE_REST for a group holding a `refuse` kind (dcm-bxp.31). Restores each `before` sheet, reverts the
 * group's Fear (floor 0), takes back the countdown ticks the group's rows caused
 * where the countdown has not changed since (`revertTicks`, countdowns-advanced
 * D11), takes the group's `sessionTally` back off the session tally (dcm-z9rz.22), gives back the Spotlight Tracker
 * tokens the group spent (`refundTokenSpends`, plan rule-switches RFB), puts back the spotlight a PC roll of the group
 * moved to the GM (`restoreSpotlight`, plan rule-switches CU2), clears `deathMoveSpent` of a character whose death row
 * the group holds (the move is due again, plan rule-switches DEF), and marks every row undone.
 */
export async function undoEntry(
  ctx: MutationCtx,
  user: Doc<"users">,
  entryId: Id<"actionLog">,
  /** Kinds with their own undo path (`rest`: `rests.undo` also reopens the rest); refused with UNDO_USE_REST (`message` overrides its text when set). */
  refuse: { kinds: ActionKind[]; message: string } = { kinds: [], message: "" },
): Promise<UndoResult> {
  const row = await ctx.db.get("actionLog", entryId);
  if (row === null) throw appError("NOT_FOUND");
  const access = await campaignAccess(ctx, user, row.campaignId, "owner");
  if (access === null) throw appError("NOT_FOUND");
  refuseArchived(access.campaign); // Q9 a (dcm-jh6d.64): undo writes the campaign.
  const isGm = access.permission === "owner";
  if (!isGm && row.visibility === "gm") throw appError("NOT_FOUND");
  if (!isGm && row.actorId !== user._id) throw appError("FORBIDDEN");

  const group = await groupOf(ctx, row);
  // A partial group would restore some sheets and miss others: refuse instead.
  if (group.length > GROUP_MAX) throw appError("UNDO_STALE", "This action touched too many characters to undo.");
  if (group.some((r) => refuse.kinds.includes(r.kind))) throw appError("UNDO_USE_REST", refuse.message || undefined);
  if (group.some((r) => !r.undoable || r.undoneAt !== undefined)) throw appError("UNDO_STALE");

  // The player-undo rule (`groupRolled`): once the dice rolled, only the GM undoes the action.
  if (!isGm && groupRolled(group)) throw appError("UNDO_EXPIRED");
  if (!isGm && groupDeathMove(group)) throw appError("UNDO_EXPIRED", "Only the GM can undo a death move.");
  const now = Date.now();

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

  const adversaries = await adversariesToRestore(ctx, group);

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

  // RX (plan rule-switches DEF, bead dcm-jh6d.69): an undone death move is due again, as `deathMoves.undo` makes it (X2
  // Manual's Risk It All marked it spent).
  for (const characterId of new Set(group.flatMap((r) => (r.kind === "death" && r.characterId !== undefined ? [r.characterId] : [])))) {
    const character = await ctx.db.get("characters", characterId);
    if (character?.deathMoveSpent === true) await ctx.db.patch("characters", characterId, { deathMoveSpent: undefined });
  }

  for (const id of returning) {
    // Back in play only into a free slot: one active character per player (throws, rolling the undo back).
    const character = await ctx.db.get("characters", id);
    const campaign = await ctx.db.get("campaigns", row.campaignId);
    if (character && campaign) await assertOneActive(ctx, campaign, character.ownerId, id);
    await ctx.db.patch("characters", id, { status: "active", away: undefined, updatedAt: now });
  }

  // Adversary instances a combat action changed (CA3, U4): back to their state before the whole action.
  for (const b of adversaries) {
    await ctx.db.patch("encounterAdversaries", b.instanceId, {
      hp: b.hp,
      stress: b.stress,
      defeated: b.defeated,
      ...(b.minionCount !== undefined ? { minionCount: b.minionCount } : {}),
      ...(b.conditions !== undefined ? { conditions: b.conditions } : {}),
      ...(b.tags !== undefined ? { tags: b.tags } : {}),
      // CA4b: card modifiers the action put on the instance go too (an empty list clears the field).
      ...(b.effects !== undefined ? { effects: b.effects.length > 0 ? b.effects : undefined } : {}),
      // AA2c: a limited feature use the action recorded is given back (an empty list clears the field).
      ...(b.featureUses !== undefined ? { featureUses: b.featureUses.length > 0 ? b.featureUses : undefined } : {}),
      updatedAt: now,
    });
  }
  // An attack's open Minion offer goes with it.
  if (row.groupId !== undefined && group.some((r) => r.kind === "combat")) await declineGroupOffers(ctx, row.campaignId, row.groupId, user._id);
  // AA2b: the action's open incoming hits (reaction windows, after-hit offers) close with it.
  if (row.groupId !== undefined) await declineGroupHits(ctx, row.campaignId, row.groupId, user._id);

  // dcm-z9rz.22: the Hope spent / HP marked the group's saves counted come off their session's tally (rows written before
  // the field carry none, so their undo leaves the tally as it is).
  await revertSessionTally(
    ctx,
    group.flatMap((r) => (r.characterId !== undefined && r.sessionTally !== undefined ? [{ ...r.sessionTally, characterId: r.characterId }] : [])),
  );

  const fear = group.reduce((sum, r) => sum + (r.fearDelta ?? 0), 0);
  const fearReverted = fear === 0 ? 0 : (await revertFear(ctx, row.campaignId, fear)).reverted;

  await revertTicks(
    ctx,
    group.map((r) => r._id),
    user._id,
  );

  // Spotlight Tracker (plan rule-switches RFB, user answer 2026-11-06): the group's spent action tokens come back.
  await refundTokenSpends(ctx, group);

  for (const r of group) await ctx.db.patch("actionLog", r._id, { undoneAt: now, undoneBy: user._id });

  // CU2 (dcm-bxp.99.32.10): a roll that moved the spotlight to the GM puts it back to who held it before.
  const spotRow = group.find((r) => r.spotlightBefore !== undefined);
  if (spotRow?.spotlightBefore !== undefined) await restoreSpotlight(ctx, row.campaignId, spotRow.spotlightBefore, inGroup);

  // CT2: an End day / day jump moves the calendar back when it is the latest (after marking, so its feed line is newer).
  const timeRow = group.find((r) => r.timeChange !== undefined);
  if (timeRow?.timeChange !== undefined) await restoreTime(ctx, user, timeRow, timeRow.timeChange);
  return { undone: group.map((r) => r._id), fearReverted };
}
