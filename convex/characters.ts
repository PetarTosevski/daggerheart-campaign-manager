import { v } from "convex/values";

import {
  applyResourceDelta,
  hitPointsToMark,
  markStress,
  damageThresholds,
  STARTING_EXPERIENCE_VALUE,
  STARTING_HOPE,
  STARTING_PROFICIENCY,
  STARTING_STRESS,
  tierForLevel,
} from "../src/lib/domain/characters/index";
import { derivedDefense } from "../src/lib/domain/characters/derived";
import { appError, RuleError } from "../src/lib/errors/app-error";
import { resolveOptions } from "../src/lib/frames/options";
import {
  getAncestry,
  getArmor,
  getClass,
  getCommunity,
  getDomainCard,
  getSubclass,
  getWeapon,
  type Source,
} from "../src/lib/srd/index";
import { TRAIT_IDS } from "../src/lib/srd/types";
import {
  characterDraftSchema,
  characterSheetSchema,
  characterSheetV1Schema,
  sheetPatchSchema,
  SHEET_VERSION,
  type CharacterDraft,
  type CharacterSheet,
  type CharacterSheetV1,
} from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { readVersioned } from "./lib/blobs";
import { claimFile, deleteFilesOf, deleteOwnFile, isAllowedImage, isClaimed, ownFileUrl } from "./lib/files";
import { campaignQuery, keyedCampaignMutation, userMutation, userQuery } from "./lib/functions";
import { atLeast, permissionFor, type Permission } from "./lib/permissions";
import {
  characterDraftValidator,
  characterStatusValidator,
  characterViewValidator,
  goldValidator,
  sheetPatchValidator,
  traitIdValidator,
  type CharacterView,
} from "./lib/validators/characters";

export type { CharacterView };

/** A new stable id for an inventory item or Experience. */
function newId(): string {
  return crypto.randomUUID();
}

/** An expected validation failure, sent as `{ code: "INVALID", message }`. */
function invalid(message: string): never {
  throw appError("INVALID", message);
}

// ---------------------------------------------------------------- the stored sheet

/**
 * Reads a stored sheet, upgrading older versions (CD3), or throws
 * `CHARACTER_CORRUPT`. Version 1 (no `schemaVersion`) gets ids by position,
 * so an unmigrated sheet shows the same ids on every read.
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

/** The stored form of a sheet: validated (a ZodError becomes INVALID), with its `schemaVersion`. */
export function storedSheet(sheet: CharacterSheet) {
  return { schemaVersion: SHEET_VERSION, ...characterSheetSchema.parse(sheet) };
}

async function saveSheet(ctx: MutationCtx, characterId: Id<"characters">, sheet: CharacterSheet): Promise<void> {
  await ctx.db.patch("characters", characterId, { sheet: storedSheet(sheet), updatedAt: Date.now() });
}

/** Stands in for a sheet that fails to read, so one bad character doesn't fail the party list. */
function placeholderSheet(raw: unknown): CharacterSheet {
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

// ---------------------------------------------------------------- access

type Loaded = { campaign: Doc<"campaigns">; permission: Permission; character: Doc<"characters"> };

/** The character, its live campaign and the user's permission on it (exact up to `enough`), or null without access. */
async function findCharacter(ctx: QueryCtx, user: Doc<"users">, characterId: Id<"characters">, enough: Permission): Promise<Loaded | null> {
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
 * No access → NOT_FOUND; too little → FORBIDDEN.
 */
async function loadCharacter(ctx: QueryCtx, user: Doc<"users">, characterId: Id<"characters">, need: Permission): Promise<Loaded> {
  const found = await findCharacter(ctx, user, characterId, need);
  if (found === null) throw appError("NOT_FOUND");
  if (!atLeast(found.permission, need)) throw appError("FORBIDDEN");
  return found;
}

/** Loads a character the user edits, with its sheet. */
async function editable(ctx: QueryCtx, user: Doc<"users">, characterId: Id<"characters">) {
  const { campaign, character } = await loadCharacter(ctx, user, characterId, "edit");
  return { campaign, character, sheet: readSheet(character.sheet) };
}

// ---------------------------------------------------------------- reads

/** URL of the character's own uploaded portrait, or null (bad id, someone else's file, or gone). */
function portraitFileUrl(ctx: QueryCtx, characterId: Id<"characters">, storageId: string): Promise<string | null> {
  return ownFileUrl(ctx, "portrait", characterId, storageId);
}

async function toView(ctx: QueryCtx, c: Doc<"characters">, sheet: CharacterSheet, viewer: Doc<"users">, canEdit: boolean): Promise<CharacterView> {
  const portraitUrl = sheet.portrait?.kind === "upload" ? await portraitFileUrl(ctx, c._id, sheet.portrait.storageId) : null;
  // Only editors get the upload's storage id; everyone else gets `portraitUrl` and a placeholder id.
  const shown: CharacterSheet = !canEdit && sheet.portrait?.kind === "upload" ? { ...sheet, portrait: { kind: "upload", storageId: "hidden" } } : sheet;
  return { _id: c._id, ownerId: c.ownerId, status: c.status, sheet: shown, portraitUrl, canEdit, mine: c.ownerId === viewer._id, updatedAt: c.updatedAt };
}

/** Every character in the campaign; everyone in it can read every sheet. A sheet that fails to read comes back marked `corrupt`. */
export const listByCampaign = campaignQuery({
  need: "view",
  // Edit on the campaign edits every sheet; otherwise only your own.
  enough: "edit",
  args: {},
  returns: v.array(characterViewValidator),
  handler: async (ctx) => {
    // One party: a handful of characters.
    const rows = await ctx.db
      .query("characters")
      .withIndex("by_campaign", (q) => q.eq("campaignId", ctx.campaign._id))
      .collect();
    const editsAll = atLeast(ctx.permission, "edit");
    return Promise.all(
      rows.map(async (c): Promise<CharacterView> => {
        let sheet: CharacterSheet;
        try {
          sheet = readSheet(c.sheet);
        } catch {
          const mine = c.ownerId === ctx.user._id;
          return { _id: c._id, ownerId: c.ownerId, status: c.status, sheet: placeholderSheet(c.sheet), portraitUrl: null, canEdit: false, mine, updatedAt: c.updatedAt, corrupt: true };
        }
        return toView(ctx, c, sheet, ctx.user, editsAll || c.ownerId === ctx.user._id);
      }),
    );
  },
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

// ---------------------------------------------------------------- creation

function assertSource(source: Source, allowExpansion: boolean, what: string) {
  if (source === "hope-and-fear" && !allowExpansion) {
    throw new RuleError("INVALID", `${what} is Hope & Fear content, which this campaign doesn't use.`);
  }
}

/** Builds the stored sheet from a validated wizard draft (Core ch. 1). */
export function sheetFromDraft(draft: CharacterDraft, allowExpansion: boolean): CharacterSheet {
  const cls = getClass(draft.classId);
  if (!cls) throw new RuleError("INVALID", "Unknown class.");
  assertSource(cls.source, allowExpansion, cls.name);
  const sub = getSubclass(draft.subclassId);
  if (!sub || sub.classId !== cls.id) throw new RuleError("INVALID", "That subclass doesn't belong to the class.");
  const ancestryIds =
    draft.ancestry.kind === "single"
      ? [draft.ancestry.id]
      : draft.ancestry.kind === "mixed"
        ? [draft.ancestry.first, draft.ancestry.second]
        : [draft.ancestry.form];
  for (const id of ancestryIds) {
    const a = getAncestry(id);
    if (!a) throw new RuleError("INVALID", "Unknown ancestry.");
    assertSource(a.source, allowExpansion, a.name);
  }
  if (draft.ancestry.kind === "shapeshifter") assertSource("hope-and-fear", allowExpansion, "Shapeshifter");
  if (draft.ancestry.kind === "mixed" && draft.ancestry.first === draft.ancestry.second) {
    throw new RuleError("INVALID", "A mixed ancestry needs two different ancestries.");
  }
  const community = getCommunity(draft.communityId);
  if (!community) throw new RuleError("INVALID", "Unknown community.");
  assertSource(community.source, allowExpansion, community.name);

  const primary = getWeapon(draft.primaryWeaponId);
  if (!primary || primary.slot !== "primary") throw new RuleError("INVALID", "Choose a primary weapon.");
  if (primary.tier !== 1) throw new RuleError("INVALID", "Starting weapons are Tier 1.");
  assertSource(primary.source, allowExpansion, primary.name);
  if (primary.classId && primary.classId !== cls.id) throw new RuleError("INVALID", `${primary.name} belongs to another class.`);
  if (draft.secondaryWeaponId) {
    const secondary = getWeapon(draft.secondaryWeaponId);
    if (!secondary || secondary.slot !== "secondary") throw new RuleError("INVALID", "Choose a secondary weapon.");
    if (primary.burden === "two-handed") throw new RuleError("INVALID", "A two-handed primary weapon leaves no hand for a secondary.");
    assertSource(secondary.source, allowExpansion, secondary.name);
  }
  if (primary.category === "magic" && !sub.spellcastTrait) {
    throw new RuleError("INVALID", "Magic weapons need a Spellcast trait from your subclass.");
  }
  const armor = getArmor(draft.armorId);
  if (!armor || armor.tier !== 1) throw new RuleError("INVALID", "Choose Tier 1 armor.");
  assertSource(armor.source, allowExpansion, armor.name);

  const allowedDomains = new Set<string>(cls.domains);
  for (const id of draft.domainCards) {
    const card = getDomainCard(id);
    if (!card || card.level !== 1 || !allowedDomains.has(card.domain)) {
      throw new RuleError("INVALID", "Starting domain cards must be level 1 from your class's domains.");
    }
  }
  if (new Set(draft.domainCards).size !== draft.domainCards.length) throw new RuleError("INVALID", "Choose two different domain cards.");

  if (!STARTING_POTIONS.includes(draft.potion)) throw new RuleError("INVALID", "Choose a Minor Health Potion or a Minor Stamina Potion.");

  const sheet: CharacterSheet = {
    name: draft.name,
    pronouns: draft.pronouns,
    description: draft.description,
    level: 1,
    classId: cls.id,
    subclassId: sub.id,
    ancestry: draft.ancestry,
    communityId: community.id,
    ...(draft.ancestry.kind === "shapeshifter" ? { transformationId: "shapeshifter" } : {}),
    traits: draft.traits,
    traitMarks: {},
    evasion: cls.startingEvasion,
    hpMax: cls.startingHp,
    hp: 0,
    stressMax: STARTING_STRESS,
    stress: 0,
    hope: STARTING_HOPE,
    scars: 0,
    armorMarked: 0,
    proficiency: STARTING_PROFICIENCY,
    primaryWeaponId: primary.id,
    ...(draft.secondaryWeaponId ? { secondaryWeaponId: draft.secondaryWeaponId } : {}),
    armorId: armor.id,
    inventory: ["Torch", "50 feet of rope", "Basic supplies", draft.potion, ...(draft.classItem ? [draft.classItem] : [])].map((name) => ({ id: newId(), name })),
    gold: { handfuls: 1, bags: 0, chest: false },
    experiences: draft.experiences.map((name) => ({ id: newId(), name, value: STARTING_EXPERIENCE_VALUE })),
    domainCards: { owned: [...draft.domainCards], loadout: [...draft.domainCards] },
    background: draft.background,
    connections: draft.connections,
    notes: "",
    ...(draft.portrait ? { portrait: draft.portrait } : {}),
  };
  assertEquipment(sheet, allowExpansion);
  return sheet;
}

/** "Your choice of a Minor Health Potion … or a Minor Stamina Potion" (Core ch. 1, step 5). */
const STARTING_POTIONS = ["Minor Health Potion", "Minor Stamina Potion"];

/**
 * Equipment the character can use: known items, at or below their tier,
 * Hope & Fear items only when the campaign uses them, class-bound weapons only
 * for that class, no secondary with a two-handed primary, and magic weapons
 * only with a Spellcast trait (Core ch. 1 step 5).
 */
function assertEquipment(sheet: CharacterSheet, allowExpansion: boolean) {
  const tier = tierForLevel(sheet.level);
  const sub = getSubclass(sheet.subclassId);
  const check = (weaponId: string, slot: "primary" | "secondary") => {
    const w = getWeapon(weaponId);
    if (!w || w.slot !== slot) throw new RuleError("INVALID", `Choose a ${slot} weapon.`);
    if (w.tier > tier) throw new RuleError("INVALID", `${w.name} is Tier ${w.tier}; this character is Tier ${tier}.`);
    assertSource(w.source, allowExpansion, w.name);
    if (w.classId && w.classId !== sheet.classId) throw new RuleError("INVALID", `${w.name} belongs to another class.`);
    if (w.category === "magic" && !sub?.spellcastTrait) throw new RuleError("INVALID", "Magic weapons need a Spellcast trait from your subclass.");
    return w;
  };
  const primary = check(sheet.primaryWeaponId, "primary");
  if (sheet.secondaryWeaponId) {
    check(sheet.secondaryWeaponId, "secondary");
    if (primary.burden === "two-handed") throw new RuleError("INVALID", "A two-handed primary weapon leaves no hand for a secondary.");
    if (primary.burden === "barehanded") throw new RuleError("INVALID", `${primary.name} can't be used with other weapons.`);
  }
  if (sheet.armorId) {
    const a = getArmor(sheet.armorId);
    if (!a) throw new RuleError("INVALID", "Unknown armor.");
    if (a.tier > tier) throw new RuleError("INVALID", `${a.name} is Tier ${a.tier}; this character is Tier ${tier}.`);
    assertSource(a.source, allowExpansion, a.name);
  }
}

/** The owner of a new or reassigned character: the caller, or (GM only) the GM or a member of the campaign. */
async function ownerFor(ctx: MutationCtx, campaign: Doc<"campaigns">, permission: Permission, user: Doc<"users">, ownerId?: Id<"users">) {
  if (!ownerId || ownerId === user._id) return user._id;
  if (permission !== "owner") throw appError("FORBIDDEN");
  if (ownerId === campaign.ownerId) return ownerId;
  const member = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", ownerId))
    .unique();
  if (!member) invalid("That player isn't in this campaign.");
  return ownerId;
}

/** Creates a character from the wizard. Players create their own; the GM may assign it to a player. */
export const create = keyedCampaignMutation({
  need: "view",
  // Telling the GM from a player decides who may assign another owner.
  enough: "owner",
  args: { draft: characterDraftValidator, ownerId: v.optional(v.id("users")) },
  returns: v.object({ characterId: v.id("characters") }),
  handler: async (ctx, { draft, ownerId }) => {
    const parsed = characterDraftSchema.parse(draft);
    if (parsed.portrait?.kind === "upload") invalid("Upload a portrait from the sheet after creating the character.");
    const sheet = sheetFromDraft(parsed, resolveOptions(ctx.campaign.frameId, ctx.campaign.options).hopeAndFear);
    const owner = await ownerFor(ctx, ctx.campaign, ctx.permission, ctx.user, ownerId);
    return ctx.once("character_create", { draft: parsed, owner }, async () => {
      const now = Date.now();
      const characterId = await ctx.db.insert("characters", {
        campaignId: ctx.campaign._id,
        ownerId: owner,
        createdBy: ctx.user._id,
        status: "active",
        sheet: storedSheet(sheet),
        createdAt: now,
        updatedAt: now,
      });
      return { characterId };
    });
  },
});

/** GM only: hand a character to a player in the campaign (or back to the GM). */
export const assignOwner = userMutation({
  args: { characterId: v.id("characters"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { characterId, ownerId }) => {
    const { campaign, permission } = await loadCharacter(ctx, ctx.user, characterId, "owner");
    const owner = await ownerFor(ctx, campaign, permission, ctx.user, ownerId);
    await ctx.db.patch("characters", characterId, { ownerId: owner, updatedAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------- sheet edits

/**
 * Edits sheet fields (identity, equipment, story, notes, maximums). Owner or GM.
 * Gold, traits, inventory and Experiences have intent mutations below; prefer
 * them, because a whole-list write here can undo a concurrent edit.
 */
export const updateSheet = userMutation({
  args: { characterId: v.id("characters"), patch: sheetPatchValidator },
  returns: v.null(),
  handler: async (ctx, { characterId, patch }) => {
    const { campaign, character, sheet } = await editable(ctx, ctx.user, characterId);
    const clean = sheetPatchSchema.parse(patch);
    const { secondaryWeaponId, armorId, inventory, experiences, ...rest } = clean;
    const next: CharacterSheet = { ...sheet, ...rest };
    if (inventory !== undefined) next.inventory = inventory.map((item) => (typeof item === "string" ? { id: newId(), name: item } : item));
    if (experiences !== undefined) next.experiences = experiences.map((e) => ({ ...e, id: e.id ?? newId() }));
    if (secondaryWeaponId === null) delete next.secondaryWeaponId;
    else if (secondaryWeaponId !== undefined) next.secondaryWeaponId = secondaryWeaponId;
    if (armorId === null) delete next.armorId;
    else if (armorId !== undefined) next.armorId = armorId;
    next.armorMarked = Math.min(next.armorMarked, derivedDefense(next).armorScore);
    if ("primaryWeaponId" in clean || secondaryWeaponId !== undefined || armorId !== undefined) {
      assertEquipment(next, resolveOptions(campaign.frameId, campaign.options).hopeAndFear);
    }
    if (clean.portrait?.kind === "upload") {
      // Uploaded portraits are attached through `attachPortrait`, never by id here.
      if (sheet.portrait?.kind !== "upload" || sheet.portrait.storageId !== clean.portrait.storageId) invalid("Upload the portrait from the sheet.");
    } else if ("portrait" in clean && sheet.portrait?.kind === "upload") {
      await deleteOwnFile(ctx, "portrait", character._id, sheet.portrait.storageId);
    }
    next.hp = Math.min(next.hp, next.hpMax);
    next.stress = Math.min(next.stress, next.stressMax);
    await saveSheet(ctx, character._id, next);
    return null;
  },
});

/** A whole-number change of at most `max` either way. */
function assertDelta(delta: number, max: number) {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > max) invalid("Change by a whole number.");
}

/** Adds `delta` handfuls or bags of gold (each kept within 0–99). Owner or GM. */
export const adjustGold = userMutation({
  args: { characterId: v.id("characters"), coin: v.union(v.literal("handfuls"), v.literal("bags")), delta: v.number() },
  returns: goldValidator,
  handler: async (ctx, { characterId, coin, delta }) => {
    assertDelta(delta, 99);
    const { character, sheet } = await editable(ctx, ctx.user, characterId);
    const gold = { ...sheet.gold, [coin]: Math.max(0, Math.min(99, sheet.gold[coin] + delta)) };
    await saveSheet(ctx, character._id, { ...sheet, gold });
    return gold;
  },
});

/** Sets whether the character has a chest of gold. Owner or GM. */
export const setGoldChest = userMutation({
  args: { characterId: v.id("characters"), chest: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { characterId, chest }) => {
    const { character, sheet } = await editable(ctx, ctx.user, characterId);
    await saveSheet(ctx, character._id, { ...sheet, gold: { ...sheet.gold, chest } });
    return null;
  },
});

/** Sets one trait's modifier. Owner or GM. */
export const setTrait = userMutation({
  args: { characterId: v.id("characters"), trait: traitIdValidator, value: v.number() },
  returns: v.null(),
  handler: async (ctx, { characterId, trait, value }) => {
    const { character, sheet } = await editable(ctx, ctx.user, characterId);
    await saveSheet(ctx, character._id, { ...sheet, traits: { ...sheet.traits, [trait]: value } });
    return null;
  },
});

/** Adds an item to the inventory; returns its id. Owner or GM. */
export const addInventory = userMutation({
  args: { characterId: v.id("characters"), name: v.string() },
  returns: v.object({ itemId: v.string() }),
  handler: async (ctx, { characterId, name }) => {
    const { character, sheet } = await editable(ctx, ctx.user, characterId);
    if (sheet.inventory.length >= 60) invalid("The inventory holds at most 60 items.");
    const itemId = newId();
    await saveSheet(ctx, character._id, { ...sheet, inventory: [...sheet.inventory, { id: itemId, name }] });
    return { itemId };
  },
});

/** Removes an inventory item by id; an item already gone is a no-op. Owner or GM. */
export const removeInventory = userMutation({
  args: { characterId: v.id("characters"), itemId: v.string() },
  returns: v.null(),
  handler: async (ctx, { characterId, itemId }) => {
    const { character, sheet } = await editable(ctx, ctx.user, characterId);
    if (!sheet.inventory.some((item) => item.id === itemId)) return null;
    await saveSheet(ctx, character._id, { ...sheet, inventory: sheet.inventory.filter((item) => item.id !== itemId) });
    return null;
  },
});

/** Adds an Experience (default +2); returns its id. Owner or GM. */
export const addExperience = userMutation({
  args: { characterId: v.id("characters"), name: v.string(), value: v.optional(v.number()) },
  returns: v.object({ experienceId: v.string() }),
  handler: async (ctx, { characterId, name, value }) => {
    const { character, sheet } = await editable(ctx, ctx.user, characterId);
    if (sheet.experiences.length >= 12) invalid("A character has at most 12 Experiences.");
    const experienceId = newId();
    const experience = { id: experienceId, name, value: value ?? STARTING_EXPERIENCE_VALUE };
    await saveSheet(ctx, character._id, { ...sheet, experiences: [...sheet.experiences, experience] });
    return { experienceId };
  },
});

/** Renames an Experience or sets its bonus, by id. Owner or GM. */
export const setExperience = userMutation({
  args: { characterId: v.id("characters"), experienceId: v.string(), name: v.optional(v.string()), value: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { characterId, experienceId, name, value }) => {
    const { character, sheet } = await editable(ctx, ctx.user, characterId);
    if (!sheet.experiences.some((e) => e.id === experienceId)) throw appError("NOT_FOUND");
    const experiences = sheet.experiences.map((e) =>
      e.id === experienceId ? { ...e, ...(name !== undefined ? { name } : {}), ...(value !== undefined ? { value } : {}) } : e,
    );
    await saveSheet(ctx, character._id, { ...sheet, experiences });
    return null;
  },
});

/** Removes an Experience by id; one already gone is a no-op. Owner or GM. */
export const removeExperience = userMutation({
  args: { characterId: v.id("characters"), experienceId: v.string() },
  returns: v.null(),
  handler: async (ctx, { characterId, experienceId }) => {
    const { character, sheet } = await editable(ctx, ctx.user, characterId);
    if (!sheet.experiences.some((e) => e.id === experienceId)) return null;
    await saveSheet(ctx, character._id, { ...sheet, experiences: sheet.experiences.filter((e) => e.id !== experienceId) });
    return null;
  },
});

/**
 * Marks or clears Hit Points, Stress, Hope, Armor Slots and scars by a delta,
 * within each track's slots. Extra Stress beyond full marks one Hit Point
 * (Core, "Marking Stress"). Owner or GM.
 */
export const adjustResource = userMutation({
  args: {
    characterId: v.id("characters"),
    resource: v.union(v.literal("hp"), v.literal("stress"), v.literal("hope"), v.literal("armor"), v.literal("scars")),
    delta: v.number(),
  },
  returns: v.object({ hp: v.number(), stress: v.number(), hope: v.number(), armorMarked: v.number(), scars: v.number() }),
  handler: async (ctx, { characterId, resource, delta }) => {
    assertDelta(delta, 12);
    const { character, sheet: s } = await editable(ctx, ctx.user, characterId);
    const next: CharacterSheet =
      resource === "armor"
        ? { ...s, armorMarked: Math.max(0, Math.min(derivedDefense(s).armorScore, s.armorMarked + delta)) }
        : applyResourceDelta(s, resource, delta);
    await saveSheet(ctx, character._id, next);
    return { hp: next.hp, stress: next.stress, hope: next.hope, armorMarked: next.armorMarked, scars: next.scars };
  },
});

/**
 * Takes damage in one step: compares it with the character's thresholds,
 * optionally marks an Armor Slot to reduce the severity by one, and marks the
 * resulting Hit Points (Core, "Hit Points and Damage Thresholds"). Owner or GM.
 */
export const applyDamage = userMutation({
  args: { characterId: v.id("characters"), damage: v.number(), useArmorSlot: v.boolean() },
  returns: v.object({
    severity: v.union(v.literal("none"), v.literal("minor"), v.literal("major"), v.literal("severe")),
    marks: v.number(),
    hp: v.number(),
    armorMarked: v.number(),
  }),
  handler: async (ctx, { characterId, damage, useArmorSlot }) => {
    if (!Number.isInteger(damage) || damage < 1 || damage > 999) invalid("Enter the damage as a whole number.");
    const { character, sheet: s } = await editable(ctx, ctx.user, characterId);
    const defense = derivedDefense(s);
    const armor = s.armorId ? getArmor(s.armorId) : undefined;
    const thresholds = damageThresholds(s.level, armor?.baseThresholds ?? null);
    if (useArmorSlot && s.armorMarked >= defense.armorScore) invalid("No Armor Slot is free.");
    const result = hitPointsToMark(damage, thresholds, useArmorSlot);
    const next: CharacterSheet = {
      ...s,
      armorMarked: useArmorSlot ? s.armorMarked + 1 : s.armorMarked,
      hp: Math.min(s.hpMax, s.hp + result.marks),
    };
    await saveSheet(ctx, character._id, next);
    return { severity: result.severity, marks: result.marks, hp: next.hp, armorMarked: next.armorMarked };
  },
});

/**
 * Moves a domain card between loadout (max 5) and vault. From the vault into
 * the loadout costs the card's Recall Cost in Stress unless it happens during
 * a rest (Core, "Domain Cards"). Owner or GM.
 */
export const moveCard = userMutation({
  args: { characterId: v.id("characters"), cardId: v.string(), to: v.union(v.literal("loadout"), v.literal("vault")), duringRest: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { characterId, cardId, to, duringRest }) => {
    const { character, sheet: s } = await editable(ctx, ctx.user, characterId);
    if (!s.domainCards.owned.includes(cardId)) invalid("That card isn't in your deck.");
    const inLoadout = s.domainCards.loadout.includes(cardId);
    let next: CharacterSheet = { ...s };
    if (to === "vault") {
      if (!inLoadout) return null;
      next.domainCards = { ...s.domainCards, loadout: s.domainCards.loadout.filter((c) => c !== cardId) };
    } else {
      if (inLoadout) return null;
      if (s.domainCards.loadout.length >= 5) invalid("Your loadout holds at most 5 cards; vault one first.");
      if ((getDomainCard(cardId)?.level ?? 99) > s.level) invalid("That card is above your level.");
      next.domainCards = { ...s.domainCards, loadout: [...s.domainCards.loadout, cardId] };
      const recall = getDomainCard(cardId)?.recallCost ?? 0;
      if (!duringRest && recall > 0) {
        const { stress, hp } = markStress(next, recall);
        next = { ...next, stress, hp };
      }
    }
    await saveSheet(ctx, character._id, next);
    return null;
  },
});

/** Marks a character dead, retired or active again. Owner or GM. (Death moves come in D5.) */
export const setStatus = userMutation({
  args: { characterId: v.id("characters"), status: characterStatusValidator },
  returns: v.null(),
  handler: async (ctx, { characterId, status }) => {
    await loadCharacter(ctx, ctx.user, characterId, "edit");
    await ctx.db.patch("characters", characterId, { status, updatedAt: Date.now() });
    return null;
  },
});

/** GM only: delete a character, its portrait files and its frame trackers. */
export const remove = userMutation({
  args: { characterId: v.id("characters") },
  returns: v.null(),
  handler: async (ctx, { characterId }) => {
    const { character } = await loadCharacter(ctx, ctx.user, characterId, "owner");
    await deleteFilesOf(ctx, "portrait", characterId);
    const prefix = `character:${characterId}:`;
    // One character's trackers: a few rows.
    const trackers = await ctx.db
      .query("frameTrackers")
      .withIndex("by_campaign_key", (q) => q.eq("campaignId", character.campaignId).gte("key", prefix).lt("key", `${prefix}￿`))
      .collect();
    for (const row of trackers) await ctx.db.delete("frameTrackers", row._id);
    await ctx.db.delete("characters", characterId);
    return null;
  },
});

// ---------------------------------------------------------------- portraits

export const MAX_PORTRAIT_BYTES = 3 * 1024 * 1024;

/** An upload URL for a portrait image of a character the caller edits. Rate-limited per user. */
export const portraitUploadUrl = userMutation({
  rateLimit: "uploadUrl",
  args: { characterId: v.id("characters") },
  returns: v.string(),
  handler: async (ctx, { characterId }) => {
    await loadCharacter(ctx, ctx.user, characterId, "edit");
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Attaches a just-uploaded file as the character's portrait. The file must be
 * a PNG, JPEG, WebP or GIF of at most 3 MB that no other character uses; the previous upload
 * is deleted. Owner or GM.
 */
export const attachPortrait = userMutation({
  args: { characterId: v.id("characters"), storageId: v.id("_storage") },
  returns: v.object({ error: v.union(v.string(), v.null()) }),
  handler: async (ctx, { characterId, storageId }) => {
    const { character, sheet } = await editable(ctx, ctx.user, characterId);
    const meta = await ctx.db.system.get(storageId);
    // Only an unclaimed file may be attached, so the rejections below only ever delete unclaimed files.
    if (meta === null || (await isClaimed(ctx, storageId))) throw appError("NOT_FOUND");
    if (!isAllowedImage(meta, MAX_PORTRAIT_BYTES)) {
      // Returned, not thrown: a throw would roll back the deletion.
      await ctx.storage.delete(storageId);
      return { error: "Portraits must be PNG, JPEG, WebP or GIF images of at most 3 MB." };
    }
    // Validated before the file is claimed, so a rejected sheet leaves no orphan file.
    const next = characterSheetSchema.safeParse({ ...sheet, portrait: { kind: "upload", storageId } });
    if (!next.success) {
      await ctx.storage.delete(storageId);
      return { error: next.error.issues[0]?.message ?? "Invalid character." };
    }
    await claimFile(ctx, { storageId, campaignId: character.campaignId, uploadedBy: ctx.user._id, kind: "portrait", refId: characterId });
    if (sheet.portrait?.kind === "upload") await deleteOwnFile(ctx, "portrait", characterId, sheet.portrait.storageId);
    await saveSheet(ctx, character._id, next.data);
    return { error: null };
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
