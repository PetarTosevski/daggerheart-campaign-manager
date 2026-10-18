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
 *   FORBIDDEN with too little.
 * - `editable(ctx, user, id)`: `loadCharacter(..., "edit")` plus the read sheet.
 * - `assertCanAct(character, sheet)`: CHARACTER_UNAVAILABLE for a dead, away
 *   or unconscious character (decision 9); call it before any roll or feature.
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
import { readVersioned } from "./blobs";
import { atLeast, permissionFor, type Permission } from "./permissions";

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
  return { schemaVersion: SHEET_VERSION, ...characterSheetSchema.parse(sheet) };
}

/** Saves a sheet. A cleared Hit Point also clears `deathMoveSpent` (LL1), so marking the last one again asks for a death move. */
export async function saveSheet(ctx: MutationCtx, characterId: Id<"characters">, sheet: CharacterSheetInput): Promise<void> {
  const stored = storedSheet(sheet);
  await ctx.db.patch("characters", characterId, { sheet: stored, updatedAt: Date.now(), ...(stored.hp < stored.hpMax ? { deathMoveSpent: undefined } : {}) });
}

// ---------------------------------------------------------------- access

export type LoadedCharacter = { campaign: Doc<"campaigns">; permission: Permission; character: Doc<"characters"> };

/** The character, its live campaign and the user's permission on it (exact up to `enough`), or null without access. */
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
  return found;
}

/** Loads a character the user edits, with its sheet. */
export async function editable(ctx: QueryCtx, user: Doc<"users">, characterId: Id<"characters">) {
  const { campaign, character } = await loadCharacter(ctx, user, characterId, "edit");
  return { campaign, character, sheet: readSheet(character.sheet) };
}

/**
 * Refuses a character who can't roll or use features: dead, away (Castle High)
 * or unconscious (decision 9; CB 106). Throws `CHARACTER_UNAVAILABLE`.
 */
export function assertCanAct(character: Pick<Doc<"characters">, "status">, sheet: Pick<CharacterSheet, "conditions">): void {
  if (character.status === "dead" || character.status === "away" || sheet.conditions.includes("unconscious")) {
    throw appError("CHARACTER_UNAVAILABLE");
  }
}

/** Reversible default (review M5; stays 50 while testing): the most characters a campaign holds. */
export const MAX_CHARACTERS_PER_CAMPAIGN = 50;

/** The campaign's characters, bounded by the cap itself. */
export function partyOf(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
}

/**
 * One active character per player (X6, user decision 2026-10-18): refuses
 * putting a character of `owner` in play while another of theirs (not
 * `except`) is active. Dead, retired and away characters don't count, and the
 * GM's own (unassigned) characters are exempt. Call it on every move into
 * `active`: create, hand-over, bring back, revive, return, undo.
 */
export async function assertOneActive(ctx: QueryCtx, campaign: Doc<"campaigns">, owner: Id<"users">, except?: Id<"characters">) {
  if (owner === campaign.ownerId) return;
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

