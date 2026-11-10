/**
 * Reading, writing and authorizing character sheets: the shared helpers every
 * D5 module uses (moved from convex/characters.ts in D5 T0; behaviour unchanged).
 *
 * - `readSheet(raw)`: the stored blob → a `CharacterSheet` with every D5
 *   default filled in, upgrading older versions; throws `CHARACTER_CORRUPT`.
 * - `storedSheet(sheet)` / `saveSheet(ctx, id, sheet)`: validate and store.
 * - `loadCharacter(ctx, user, id, need)`: the character, its live campaign and
 *   the user's permission through `permissionFor` (`view`: everyone in the
 *   campaign; `edit`: owner and GM; `owner`: GM). NOT_FOUND without access,
 *   FORBIDDEN with too little; in a mutation, CAMPAIGN_ARCHIVED for an archived
 *   campaign (queries still read it).
 * - `editable(ctx, user, id)`: `loadCharacter(..., "edit")` plus the read sheet.
 * - `assertCanAct(character, sheet, campaign)`: CHARACTER_UNAVAILABLE for a dead,
 *   away or unconscious character (decision 9; unconscious only while C4 is
 *   Book); call it before any roll or feature.
 *
 * ```ts
 * export const rollSomething = keyedUserMutation({
 *   rateLimit: "roll",
 *   args: { characterId: v.id("characters") },
 *   returns: v.null(),
 *   handler: async (ctx, { characterId }) =>
 *     ctx.once("roll_something", { characterId }, async () => {
 *       const { campaign, character, sheet } = await editable(ctx, ctx.user, characterId);
 *       assertCanAct(character, sheet);
 *       const next = { ...sheet, hope: sheet.hope + 1 };
 *       await saveSheet(ctx, character._id, next);
 *       await logAction(ctx, { campaignId: campaign._id, characterId, actorId: ctx.user._id, kind: "roll",
 *         visibility: "public", summary: "rolled", before: sheet, undoable: true });
 *       return null;
 *     }),
 * });
 * ```
 */
import { hpClearedWakeNote, keepUnconscious, unconsciousBlocksActing, withStressVulnerable } from "../../src/lib/domain/characters/index";
import { hopePaid } from "../../src/lib/domain/journal/tally";
import { resolveRuleModes } from "../../src/lib/rules/resolve";
import { appError } from "../../src/lib/errors/app-error";
import {
  characterSheetSchema,
  characterSheetV1Schema,
  SHEET_VERSION,
  type CharacterSheet,
  type CharacterSheetInput,
  type CharacterSheetV1,
} from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { readAppConfig } from "./appConfig";
import { CHARACTER_READ_BOUND } from "./characterLimits";
import { refuseArchivedWrite } from "./archived";
import { readVersioned } from "./blobs";
import { atLeast, campaignRoleOf, permissionFor, rolePermission, type Permission } from "./permissions";
import { postRuleNote, ruleMode } from "./ruleModes";

// ---------------------------------------------------------------- the stored sheet

/**
 * Reads a stored sheet, upgrading older versions (CD3), or throws
 * `CHARACTER_CORRUPT`. Version 1 (no `schemaVersion`) gets ids by position,
 * so an unmigrated sheet shows the same ids on every read. D5 fields missing
 * from a stored version 2 sheet come back with their defaults.
 */
export function readSheet(raw: unknown): CharacterSheet {
  return readVersioned(
    {
      1: {
        schema: characterSheetV1Schema,
        upgrade: (old: CharacterSheetV1) => ({
          ...old,
          inventory: old.inventory.map((name, i) => ({ id: `inv-${i}`, name })),
          experiences: old.experiences.map((e, i) => ({ id: `exp-${i}`, ...e })),
        }),
      },
      2: { schema: characterSheetSchema },
    },
    raw,
    "CHARACTER_CORRUPT",
  );
}

/** The stored form of a sheet: validated (a ZodError becomes INVALID), defaults filled, with its `schemaVersion`. */
export function storedSheet(sheet: CharacterSheetInput) {
  const parsed = characterSheetSchema.parse(sheet);
  // dcm-bxp.99.32.1: a condition's provenance goes with the condition (cleared by any path, it is no longer "from" anything).
  const sources = parsed.conditionSources?.filter((s) => parsed.conditions.includes(s.condition));
  const { conditionSources: _dropped, ...rest } = parsed;
  void _dropped;
  return { schemaVersion: SHEET_VERSION, ...rest, ...(sources && sources.length > 0 ? { conditionSources: sources } : {}) };
}

/**
 * Saves a sheet. A cleared Hit Point also clears `deathMoveSpent` (LL1), so marking the last one again asks for a death move.
 *
 * Journal JD3b (user Q8): while the character's campaign has a live session, the save also adds the Hope it lowers
 * (`hopeSpent`) and the Hit Points it marks (`hpMarked`; the sheet's `hp` is the marked count) to the PC's
 * `sessionCharacterStats` row for that session, in the same mutation. Every engine path that changes a sheet (cards,
 * attacks, hits, death moves, rests, the manual steppers) saves through here, so every path counts. A save that
 * raises Hope or clears HP (rests, level-ups, healing) never subtracts. `current` is the stored character, for a
 * caller that already read it in this mutation; otherwise this reads it (one get).
 *
 * Exact spend (dcm-z9rz.23, user 2026-11-04 "count the spend"): a path that pays Hope says how much through
 * `noteHopeSpent` before the save, so a save that pays and gains in one go (an Experience on a roll with Hope, a card
 * cost paid by the roll's own Hope) still counts what was paid. The save counts the larger of the noted spend and the
 * net drop; a path that notes nothing counts the net drop. Hope lost because a scar closed its slot is no drop
 * (`hopePaid`, dcm-z9rz.27: only Hope a player pays counts).
 *
 * Undo (dcm-z9rz.22, user 2026-11-04 "undo removes it"): what a save counted waits for the character's next `logAction`
 * row with a `before` in this mutation, which records it (`sessionTally`); undoing the row takes it back off the same
 * session's row (`revertSessionTally`, floor 0). Undo itself restores sheets directly, never through here.
 *
 * C4 Unconscious on Manual (plan rule-switches WD, Q8 a): a save that clears Hit Points on an unconscious PC would wake
 * them (`applyResourceDelta`, CB p.106); here the condition stays and the GM is asked ("Mira had a Hit Point cleared:
 * wake her?", `postWakeNote`, posted by the character's next `logAction` row in this mutation, in its group).
 */
export async function saveSheet(
  ctx: MutationCtx,
  characterId: Id<"characters">,
  sheet: CharacterSheetInput,
  current?: Pick<Doc<"characters">, "campaignId" | "sheet">,
): Promise<void> {
  const previous = current ?? (await ctx.db.get("characters", characterId));
  const unconsciousKept = previous === null ? sheet : await keptUnconscious(ctx, characterId, previous, sheet);
  const stored = storedSheet(await stressVulnerable(ctx, previous, unconsciousKept));
  await ctx.db.patch("characters", characterId, { sheet: stored, updatedAt: Date.now(), ...(stored.hp < stored.hpMax ? { deathMoveSpent: undefined } : {}) });
  const state = tallyStateOf(ctx);
  const declared = state.declared.get(characterId) ?? 0;
  state.declared.delete(characterId);
  const before = previous === null ? null : trackedCounts(previous.sheet);
  if (previous === null || before === null) return;
  const hopeSpent = hopePaid(before, stored, declared);
  const hpMarked = Math.max(0, stored.hp - before.hp);
  if (hopeSpent === 0 && hpMarked === 0) return;
  const sessionId = await countLiveSessionStats(ctx, previous.campaignId, characterId, hopeSpent, hpMarked);
  if (sessionId === null) return;
  const waiting = state.pending.get(characterId);
  state.pending.set(
    characterId,
    waiting !== undefined && waiting.sessionId === sessionId
      ? { sessionId, hopeSpent: waiting.hopeSpent + hopeSpent, hpMarked: waiting.hpMarked + hpMarked }
      : { sessionId, hopeSpent, hpMarked },
  );
}

/**
 * D5 Full Stress = Vulnerable for PCs (CB p.92), at the one place every sheet write passes: `withStressVulnerable` adds
 * Vulnerable when the track fills and lifts it when a Stress clears. The campaign is read only when the track crosses
 * full, and its modes come from `resolveRuleModes` directly (read once, only on a crossing).
 */
async function stressVulnerable(ctx: MutationCtx, previous: Pick<Doc<"characters">, "campaignId" | "sheet"> | null, sheet: CharacterSheetInput): Promise<CharacterSheetInput> {
  const before = previous === null ? null : stressTrack(previous.sheet);
  const next = withStressVulnerable(before, sheet);
  if (next === sheet) return sheet;
  const campaign = previous === null ? null : await ctx.db.get("campaigns", previous.campaignId);
  if (campaign !== null && resolveRuleModes(campaign.frameId, campaign.ruleModes).fullStressVulnerable === "manual") return sheet;
  return next;
}

function stressTrack(raw: unknown): { stress: number; stressMax: number } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { stress, stressMax } = raw as { stress?: unknown; stressMax?: unknown };
  return typeof stress === "number" && typeof stressMax === "number" ? { stress, stressMax } : null;
}

/** The previous stored sheet's unconscious bits: whether it held the condition, its Hit Points and the condition's source. */
function unconsciousBefore(raw: unknown): { hp: number; conditions: ["unconscious"]; source?: unknown } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { hp, conditions, conditionSources } = raw as { hp?: unknown; conditions?: unknown; conditionSources?: unknown };
  if (typeof hp !== "number" || !Array.isArray(conditions) || !conditions.includes("unconscious")) return null;
  const source = Array.isArray(conditionSources) ? conditionSources.find((s: { condition?: unknown }) => s?.condition === "unconscious") : undefined;
  return { hp, conditions: ["unconscious"], ...(source !== undefined ? { source } : {}) };
}

/**
 * C4 Manual: the sheet to store when this save woke an unconscious PC by clearing Hit Points (`keepUnconscious`): the
 * condition (and its source) stays and a wake note waits for the character's next logged row. The campaign is read
 * only when a save would wake someone. Book, and every other save, store the sheet as given.
 */
async function keptUnconscious(
  ctx: MutationCtx,
  characterId: Id<"characters">,
  previous: Pick<Doc<"characters">, "campaignId" | "sheet">,
  sheet: CharacterSheetInput,
): Promise<CharacterSheetInput> {
  const before = unconsciousBefore(previous.sheet);
  if (before === null || sheet.conditions?.includes("unconscious") === true || (sheet.hp ?? before.hp) >= before.hp) return sheet;
  const campaign = await ctx.db.get("campaigns", previous.campaignId);
  if (campaign === null) return sheet;
  const kept = keepUnconscious(before, { ...sheet, hp: sheet.hp ?? before.hp, conditions: sheet.conditions ?? [] }, ruleMode(campaign, "unconscious"));
  if (!kept.woke) return sheet;
  tallyStateOf(ctx).wakeNotes.set(characterId, hpClearedWakeNote(sheet.name ?? "A PC", sheet.pronouns));
  const sources = sheet.conditionSources ?? [];
  return {
    ...kept.sheet,
    ...(before.source !== undefined && !sources.some((s) => s.condition === "unconscious")
      ? { conditionSources: [...sources, before.source as (typeof sources)[number]] }
      : {}),
  };
}

/**
 * C4 Manual: posts the wake note a save left for this character ("Mira had a Hit Point cleared: wake her?"), once.
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
  const state = tallyStateOf(ctx);
  const summary = state.wakeNotes.get(characterId);
  if (summary === undefined) return;
  state.wakeNotes.delete(characterId);
  await postRuleNote(ctx, { _id: campaignId }, { ruleId: "unconscious", summary, ...(groupId !== undefined ? { characterId, groupId } : {}), actorId });
}

/** What one action added to a PC's `sessionCharacterStats` row (JD3b counters), as an action-log row records it. */
export type SessionTallyDelta = { sessionId: Id<"sessions">; hopeSpent: number; hpMarked: number };

/**
 * The tally side state of one mutation, keyed by its `ctx.db` (Convex makes one per function run, so nothing crosses
 * mutations or OCC retries): `declared` is the Hope a paying path noted for the character's next save (`noteHopeSpent`),
 * `pending` what the character's saves counted since its last logged row (`takeSessionTally`).
 */
type TallyState = { declared: Map<string, number>; pending: Map<string, SessionTallyDelta>; wakeNotes: Map<string, string> };
const tallyStates = new WeakMap<object, TallyState>();

function tallyStateOf(ctx: MutationCtx): TallyState {
  let state = tallyStates.get(ctx.db);
  if (state === undefined) {
    state = { declared: new Map(), pending: new Map(), wakeNotes: new Map() };
    tallyStates.set(ctx.db, state);
  }
  return state;
}

/**
 * Says that the character's next `saveSheet` in this mutation pays `amount` Hope (dcm-z9rz.23), whatever it also gains.
 * Call it just before that save; notes for one character add up. A note no save takes is dropped with the mutation.
 */
export function noteHopeSpent(ctx: MutationCtx, characterId: Id<"characters">, amount: number): void {
  if (!(amount > 0)) return;
  const state = tallyStateOf(ctx);
  state.declared.set(characterId, (state.declared.get(characterId) ?? 0) + amount);
}

/** What the character's saves counted since its last logged row in this mutation, taken (once) by `logAction` (dcm-z9rz.22). */
export function takeSessionTally(ctx: MutationCtx, characterId: Id<"characters">): SessionTallyDelta | undefined {
  const state = tallyStates.get(ctx.db);
  const delta = state?.pending.get(characterId);
  if (delta !== undefined) state!.pending.delete(characterId);
  return delta;
}

/**
 * Takes counted deltas back off their sessions' rows (undo, dcm-z9rz.22), never below 0. One read per session and
 * character; a row that is gone (its session purged) is skipped.
 */
export async function revertSessionTally(ctx: MutationCtx, deltas: readonly (SessionTallyDelta & { characterId: Id<"characters"> })[]): Promise<void> {
  const sums = new Map<string, SessionTallyDelta & { characterId: Id<"characters"> }>();
  for (const d of deltas) {
    const key = `${d.sessionId}:${d.characterId}`;
    const seen = sums.get(key);
    sums.set(key, seen ? { ...seen, hopeSpent: seen.hopeSpent + d.hopeSpent, hpMarked: seen.hpMarked + d.hpMarked } : { ...d });
  }
  for (const d of sums.values()) {
    if (d.hopeSpent === 0 && d.hpMarked === 0) continue;
    const row = await ctx.db
      .query("sessionCharacterStats")
      .withIndex("by_session_character", (q) => q.eq("sessionId", d.sessionId).eq("characterId", d.characterId))
      .unique();
    if (row === null) continue;
    await ctx.db.patch("sessionCharacterStats", row._id, {
      hopeSpent: Math.max(0, row.hopeSpent - d.hopeSpent),
      hpMarked: Math.max(0, row.hpMarked - d.hpMarked),
    });
  }
}

/** Hope and marked HP of a stored sheet blob (every sheet version stores both as numbers), or null for a blob without them. */
function trackedCounts(raw: unknown): { hope: number; hp: number; scars: number; hopeSlotBonus?: number } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { hope, hp, scars, hopeSlotBonus } = raw as { hope?: unknown; hp?: unknown; scars?: unknown; hopeSlotBonus?: unknown };
  if (typeof hope !== "number" || typeof hp !== "number") return null;
  return { hope, hp, scars: typeof scars === "number" ? scars : 0, ...(typeof hopeSlotBonus === "number" ? { hopeSlotBonus } : {}) };
}

/**
 * Adds to the PC's `sessionCharacterStats` row of the campaign's live session (JD3b), creating it on the first drop, and
 * returns that session's id (null when nothing was counted). No live session: nothing. A session already holding `CHARACTER_READ_BOUND` rows (= `MAX_SESSION_CHARACTER_STATS`)
 * gets no new row, so a save never fails over a counter. The live session is read here (index `by_campaign_status_n`,
 * as `liveSession` in convex/lib/sessions.ts does) because that module imports this one.
 */
async function countLiveSessionStats(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  characterId: Id<"characters">,
  hopeSpent: number,
  hpMarked: number,
): Promise<Id<"sessions"> | null> {
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_campaign_status_n", (q) => q.eq("campaignId", campaignId).eq("status", "live"))
    .first();
  if (session === null) return null;
  const row = await ctx.db
    .query("sessionCharacterStats")
    .withIndex("by_session_character", (q) => q.eq("sessionId", session._id).eq("characterId", characterId))
    .unique();
  if (row !== null) {
    await ctx.db.patch("sessionCharacterStats", row._id, { hopeSpent: row.hopeSpent + hopeSpent, hpMarked: row.hpMarked + hpMarked });
    return session._id;
  }
  const rows = await ctx.db
    .query("sessionCharacterStats")
    .withIndex("by_session_character", (q) => q.eq("sessionId", session._id))
    .take(CHARACTER_READ_BOUND);
  if (rows.length >= CHARACTER_READ_BOUND) return null;
  await ctx.db.insert("sessionCharacterStats", { campaignId, sessionId: session._id, characterId, hopeSpent, hpMarked });
  return session._id;
}

// ---------------------------------------------------------------- access

export type LoadedCharacter = { campaign: Doc<"campaigns">; permission: Permission; character: Doc<"characters"> };

/**
 * The character, its live campaign and the user's permission on it (exact up to `enough`), or null without access.
 * No archived guard here (its callers decide FORBIDDEN themselves): a mutation that writes after `findCharacter` calls
 * `refuseArchived` after its own permission check, as `rolls.tagTeamApply` does.
 */
export async function findCharacter(ctx: QueryCtx, user: Doc<"users">, characterId: Id<"characters">, enough: Permission): Promise<LoadedCharacter | null> {
  const character = await ctx.db.get("characters", characterId);
  if (character === null) return null;
  const campaign = await ctx.db.get("campaigns", character.campaignId);
  if (campaign === null || campaign.deletedAt !== undefined) return null;
  const permission = await permissionFor(ctx, user, { type: "character", campaign, character }, enough);
  return permission === null ? null : { campaign, permission, character };
}

/**
 * Loads a character the user has `need` on: `view` for everyone in the
 * campaign, `edit` for the GM and the character's owner, `owner` for the GM.
 * No access → NOT_FOUND; too little → FORBIDDEN. The permission is exact up
 * to `enough` (default `need`). The character's extras load through it too
 * (convex/characterExtras.ts), so a grant on a character covers its extras.
 */
export async function loadCharacter(
  ctx: QueryCtx,
  user: Doc<"users">,
  characterId: Id<"characters">,
  need: Permission,
  enough: Permission = need,
): Promise<LoadedCharacter> {
  const found = await findCharacter(ctx, user, characterId, enough);
  if (found === null) throw appError("NOT_FOUND");
  if (!atLeast(found.permission, need)) throw appError("FORBIDDEN");
  // Q9 a (dcm-jh6d.64): after the access check, a mutation never writes a character of an archived campaign; a query
  // still reads it. Every character write on `userMutation` / `keyedUserMutation` loads through here.
  refuseArchivedWrite(ctx, found.campaign);
  return found;
}

/** Loads a character the user edits, with its sheet. */
export async function editable(ctx: QueryCtx, user: Doc<"users">, characterId: Id<"characters">) {
  const { campaign, character } = await loadCharacter(ctx, user, characterId, "edit");
  return { campaign, character, sheet: readSheet(character.sheet) };
}

/**
 * Whether the user edits the character that cast a lasting effect (plan hud-pre-w9, dcm-bxp.99.32.37, user 2026-11-02:
 * the effect's caster may End it on another PC's sheet). The effect's stored `casterId` (E6.4) names a character of the
 * same campaign; the check is `permissionFor` on that character (`findCharacter`, edit). An effect without a caster,
 * or whose caster is not a character of this campaign, is nobody's by this rule.
 */
export async function editsCaster(ctx: QueryCtx, user: Doc<"users">, campaignId: Id<"campaigns">, effect: { casterId?: string }): Promise<boolean> {
  if (effect.casterId === undefined) return false;
  const casterId = ctx.db.normalizeId("characters", effect.casterId);
  if (casterId === null) return false;
  const caster = await findCharacter(ctx, user, casterId, "edit");
  return caster !== null && caster.campaign._id === campaignId && atLeast(caster.permission, "edit");
}

/**
 * Refuses a character who can't roll or use features: dead, away (Castle High)
 * or unconscious (decision 9; CB 106). Throws `CHARACTER_UNAVAILABLE`. C4
 * Unconscious on Manual (plan rule-switches WD): an unconscious character acts;
 * pass the character's `campaign` so the mode is read (without it: Book).
 */
export function assertCanAct(
  character: Pick<Doc<"characters">, "status">,
  sheet: Pick<CharacterSheet, "conditions">,
  campaign?: Pick<Doc<"campaigns">, "frameId" | "ruleModes">,
): void {
  const unconscious = unconsciousBlocksActing(sheet, campaign === undefined ? "book" : ruleMode(campaign, "unconscious"));
  if (character.status === "dead" || character.status === "away" || unconscious) {
    throw appError("CHARACTER_UNAVAILABLE");
  }
}

// The character bounds live in ./characterLimits (a leaf module, so ./sessions can read them while it loads).
export { CHARACTER_READ_BOUND, MAX_CHARACTERS_CREATED_PER_CAMPAIGN, MAX_CHARACTERS_PER_CAMPAIGN } from "./characterLimits";

/**
 * The per-player character cap (config AD5b, Q19 a): `characters.create` refuses `owner`'s next character in the
 * campaign once they hold `caps.charactersPerPlayer` there (retired, dead and away included) with
 * CAP_CHARACTERS_PER_PLAYER. The GM's and every co-GM's characters are exempt (NPC-owned and secret frame characters),
 * by the same `permissionFor` role rank as `assertOneActive`. XC1's "Allow extra characters this session" lifts only
 * the one-active rule, never this cap. The count is one bounded read on `by_owner_campaign` (`take(cap + 1)`); the
 * campaign-wide `MAX_CHARACTERS_CREATED_PER_CAMPAIGN` stays the abuse bound.
 */
export async function assertCharacterCap(ctx: QueryCtx, campaign: Doc<"campaigns">, owner: Id<"users">): Promise<void> {
  if (atLeast(rolePermission(await campaignRoleOf(ctx, owner, campaign), { type: "campaign", campaign }, owner), "owner")) return;
  const cap = (await readAppConfig(ctx)).caps.charactersPerPlayer;
  const held = await ctx.db
    .query("characters")
    .withIndex("by_owner_campaign", (q) => q.eq("ownerId", owner).eq("campaignId", campaign._id))
    .take(cap + 1);
  if (held.length >= cap) throw appError("CAP_CHARACTERS_PER_PLAYER");
}


/** The campaign's characters, bounded by the read bound. */
export function partyOf(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(CHARACTER_READ_BOUND);
}

/** XC1: true while the GM allows extra active characters for the running session. */
export async function extraCharactersAllowed(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<boolean> {
  const state = await ctx.db
    .query("campaignState")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .unique();
  return state?.sessionStartedAt !== undefined && state.extraCharactersSession === state.sessionStartedAt;
}

/**
 * One active character per player (X6, user decision 2026-10-18): refuses
 * putting a character of `owner` in play while another of theirs (not
 * `except`) is active. Dead, retired and away characters don't count, and the
 * GM's own (unassigned) characters are exempt. Call it on every move into
 * `active`: create, hand-over, bring back, revive, return, undo.
 * XC1: skipped while the GM allows extra characters for the running session.
 */
export async function assertOneActive(ctx: QueryCtx, campaign: Doc<"campaigns">, owner: Id<"users">, except?: Id<"characters">) {
  // Role (config G2): the GM's and every co-GM's characters are exempt; `owner` is not the caller, so its role is
  // read (the creator costs nothing). A player, an invitee or a departed owner is held to one active character.
  if (atLeast(rolePermission(await campaignRoleOf(ctx, owner, campaign), { type: "campaign", campaign }, owner), "owner")) return;
  if (await extraCharactersAllowed(ctx, campaign._id)) return;
  const other = (await partyOf(ctx, campaign._id)).find((c) => c.ownerId === owner && c.status === "active" && c._id !== except);
  if (other === undefined) return;
  let name = "another character";
  try {
    name = readSheet(other.sheet).name;
  } catch {
    // A corrupt sheet still blocks; the message just can't name it.
  }
  throw appError("INVALID", `A player has one active character at a time. Send ${name} away first.`);
}

