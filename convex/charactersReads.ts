import { v, type Infer } from "convex/values";

import { TRAIT_IDS } from "../src/lib/srd/types";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { findCharacter, loadCharacter, partyOf, readSheet } from "./lib/characterSheet";
import { ownFileUrl } from "./lib/files";
import { campaignQuery, userQuery } from "./lib/functions";
import { atLeast, type Permission } from "./lib/permissions";
import { characterViewValidator, type CharacterView } from "./lib/validators/characters";

/**
 * The character reads (the party list, the dashboard's party cards, one sheet, a portrait URL). Moved out of
 * `characters.ts` by dcm-uh6r so these subscriptions, open on nearly every page, do not load the character mutations'
 * creation, level-up and Motherboard code. Same wrappers, arguments and returns as before.
 */

// ---------------------------------------------------------------- the stored sheet

/** Stands in for a sheet that fails to read, so one bad character doesn't fail the party list. */
function placeholderSheet(raw: unknown): CharacterView["sheet"] {
  const stored = typeof raw === "object" && raw !== null ? (raw as { name?: unknown }).name : undefined;
  const name = typeof stored === "string" && stored.trim() !== "" ? stored.trim().slice(0, 80) : "Unreadable character";
  return {
    name,
    pronouns: "",
    description: "",
    level: 1,
    classId: "",
    subclassId: "",
    ancestry: { kind: "single", id: "" },
    communityId: "",
    traits: Object.fromEntries(TRAIT_IDS.map((t) => [t, 0])) as CharacterSheet["traits"],
    traitMarks: {},
    evasion: 0,
    hpMax: 1,
    hp: 0,
    stressMax: 1,
    stress: 0,
    hope: 0,
    scars: 0,
    armorMarked: 0,
    proficiency: 1,
    primaryWeaponId: "",
    inventory: [],
    gold: { handfuls: 0, bags: 0, chest: false },
    experiences: [],
    domainCards: { owned: [], loadout: [] },
    background: [],
    connections: [],
    notes: "",
  };
}

// ---------------------------------------------------------------- reads

/** URL of the character's own uploaded portrait, or null (bad id, someone else's file, or gone). */
function portraitFileUrl(ctx: QueryCtx, characterId: Id<"characters">, storageId: string): Promise<string | null> {
  return ownFileUrl(ctx, "portrait", characterId, storageId);
}

/** `away` for the views: a death-move reason as `away`, a bench as `benched: true` (X6). */
function awayView(c: Doc<"characters">): Pick<CharacterView, "away" | "benched"> {
  if (c.away === undefined) return {};
  const { reason, note } = c.away;
  if (reason === "benched") return { benched: true };
  return { away: { reason, ...(note === undefined ? {} : { note }) } };
}

async function toView(ctx: QueryCtx, c: Doc<"characters">, sheet: CharacterSheet, viewer: Doc<"users">, canEdit: boolean): Promise<CharacterView> {
  const portraitUrl = sheet.portrait?.kind === "upload" ? await portraitFileUrl(ctx, c._id, sheet.portrait.storageId) : null;
  // Only editors get the upload's storage id; everyone else gets `portraitUrl` and a placeholder id.
  const shown: CharacterSheet = !canEdit && sheet.portrait?.kind === "upload" ? { ...sheet, portrait: { kind: "upload", storageId: "hidden" } } : sheet;
  return {
    _id: c._id,
    ownerId: c.ownerId,
    status: c.status,
    ...awayView(c),
    sheet: shown,
    portraitUrl,
    canEdit,
    mine: c.ownerId === viewer._id,
    updatedAt: c.updatedAt,
  };
}

/** Every character in the campaign as a view; a sheet that fails to read comes back marked `corrupt`. */
async function partyViews(ctx: QueryCtx, user: Doc<"users">, campaignId: Id<"campaigns">, permission: Permission): Promise<CharacterView[]> {
  // One party, bounded by the read bound (dcm-bxp.38).
  const rows = await partyOf(ctx, campaignId);
  // Edit on the campaign edits every sheet; otherwise only your own.
  const editsAll = atLeast(permission, "edit");
  return Promise.all(
    rows.map(async (c): Promise<CharacterView> => {
      let sheet: CharacterSheet;
      try {
        sheet = readSheet(c.sheet);
      } catch {
        const mine = c.ownerId === user._id;
        return { _id: c._id, ownerId: c.ownerId, status: c.status, ...awayView(c), sheet: placeholderSheet(c.sheet), portraitUrl: null, canEdit: false, mine, updatedAt: c.updatedAt, corrupt: true };
      }
      return toView(ctx, c, sheet, user, editsAll || c.ownerId === user._id);
    }),
  );
}

/** Every character in the campaign; everyone in it can read every sheet. A sheet that fails to read comes back marked `corrupt`. */
export const listByCampaign = campaignQuery({
  need: "view",
  enough: "edit",
  args: {},
  returns: v.array(characterViewValidator),
  handler: (ctx) => partyViews(ctx, ctx.user, ctx.campaign._id, ctx.permission),
});

// ---------------------------------------------------------------- the dashboard's party summary (PF9)

/**
 * The sheet fields the dashboard party card and its badges read: name, class line (class, subclass, ancestry,
 * community, level), portrait, the HP/Stress/Hope tiles (with scars and Light in the Dark), armor, and the D5 badges
 * (level-up pending, conditions for "Unconscious", Wither tokens, journey ends). The optional ones come back only when
 * they show something, so an HP tick re-sends a few hundred bytes per character instead of the whole sheet. Every
 * field has `CharacterView`'s type, so a full view is also a `PartyMember` (the party card takes either).
 */
const partySheetValidator = v.object({
  name: v.string(),
  level: v.number(),
  classId: v.string(),
  subclassId: v.string(),
  ancestry: characterViewValidator.fields.sheet.fields.ancestry,
  communityId: v.string(),
  portrait: characterViewValidator.fields.sheet.fields.portrait,
  hp: v.number(),
  hpMax: v.number(),
  stress: v.number(),
  stressMax: v.number(),
  hope: v.number(),
  scars: v.number(),
  armorMarked: v.number(),
  hopeSlotBonus: v.optional(v.number()),
  levelUpPending: v.optional(v.boolean()),
  conditions: characterViewValidator.fields.sheet.fields.conditions,
  wither: v.optional(v.number()),
  journeyEnds: v.optional(v.boolean()),
});

/** One dashboard party card: `CharacterView` without `ownerId`, `mine`, `updatedAt` and most of the sheet. */
export const partyMemberValidator = v.object({
  _id: v.id("characters"),
  status: characterViewValidator.fields.status,
  away: characterViewValidator.fields.away,
  benched: characterViewValidator.fields.benched,
  sheet: partySheetValidator,
  portraitUrl: v.union(v.string(), v.null()),
  canEdit: v.boolean(),
  corrupt: v.optional(v.literal(true)),
});

export type PartyMember = Infer<typeof partyMemberValidator>;

/** The card's slice of a view; drops what the card never shows, and the optional fields that show nothing. */
function partyMember(view: CharacterView): PartyMember {
  const { sheet: s } = view;
  return {
    _id: view._id,
    status: view.status,
    ...(view.away === undefined ? {} : { away: view.away }),
    ...(view.benched === undefined ? {} : { benched: view.benched }),
    sheet: {
      name: s.name,
      level: s.level,
      classId: s.classId,
      subclassId: s.subclassId,
      ancestry: s.ancestry,
      communityId: s.communityId,
      ...(s.portrait === undefined ? {} : { portrait: s.portrait }),
      hp: s.hp,
      hpMax: s.hpMax,
      stress: s.stress,
      stressMax: s.stressMax,
      hope: s.hope,
      scars: s.scars,
      armorMarked: s.armorMarked,
      ...(s.hopeSlotBonus ? { hopeSlotBonus: s.hopeSlotBonus } : {}),
      ...(s.levelUpPending ? { levelUpPending: true as const } : {}),
      ...(s.conditions?.length ? { conditions: s.conditions } : {}),
      ...(s.wither ? { wither: s.wither } : {}),
      ...(s.journeyEnds ? { journeyEnds: true as const } : {}),
    },
    portraitUrl: view.portraitUrl,
    canEdit: view.canEdit,
    ...(view.corrupt ? { corrupt: true as const } : {}),
  };
}

/**
 * The dashboard's party (PF9): `listByCampaign`'s rows cut to what a party card shows. Same access, same reads (the
 * party's characters and their portrait files); everyone in the campaign sees every card, as with `listByCampaign`.
 */
export const partySummary = campaignQuery({
  need: "view",
  enough: "edit",
  args: {},
  returns: v.array(partyMemberValidator),
  handler: async (ctx) => (await partyViews(ctx, ctx.user, ctx.campaign._id, ctx.permission)).map(partyMember),
});

/** One character, or null when the id is bad, it is gone, or the caller can't see it. A corrupt sheet throws CHARACTER_CORRUPT. */
export const get = userQuery({
  args: { characterId: v.string() },
  returns: v.union(characterViewValidator, v.null()),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("characters", args.characterId);
    if (id === null) return null;
    const found = await findCharacter(ctx, ctx.user, id, "edit");
    if (found === null) return null;
    return toView(ctx, found.character, readSheet(found.character.sheet), ctx.user, atLeast(found.permission, "edit"));
  },
});

/** Resolves an uploaded portrait's URL. */
export const portraitUrl = userQuery({
  args: { characterId: v.id("characters") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { characterId }) => {
    const { character } = await loadCharacter(ctx, ctx.user, characterId, "view");
    const sheet = readSheet(character.sheet);
    if (sheet.portrait?.kind !== "upload") return null;
    return portraitFileUrl(ctx, character._id, sheet.portrait.storageId);
  },
});
