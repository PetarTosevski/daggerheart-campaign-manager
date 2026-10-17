import { ConvexError, v } from "convex/values";
import { ZodError } from "zod";

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
import {
  characterDraftSchema,
  characterSheetSchema,
  sheetPatchSchema,
  type CharacterDraft,
  type CharacterSheet,
} from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { loadCampaign, type Role } from "./lib/access";
import { requireUser } from "./lib/auth";
import { claimFile, deleteFilesOf, deleteOwnFile, isClaimed, ownFileUrl } from "./lib/files";
import { campaignScope, withIdempotency } from "./lib/operations";
import { atLeast, liveCampaign, requirePermission, type Permission } from "./lib/permissions";

function invalid(error: unknown): never {
  if (error instanceof ZodError) throw new ConvexError({ code: "INVALID", message: error.issues[0]?.message ?? "Invalid character." });
  if (error instanceof Error) throw new ConvexError({ code: "INVALID", message: error.message });
  throw error;
}

function parseSheet(raw: unknown): CharacterSheet {
  const parsed = characterSheetSchema.safeParse(raw);
  if (!parsed.success) throw new ConvexError("CHARACTER_CORRUPT");
  return parsed.data;
}

/** URL of the character's own uploaded portrait, or null (bad id, someone else's file, or gone). */
function portraitFileUrl(ctx: QueryCtx, characterId: Id<"characters">, storageId: string): Promise<string | null> {
  return ownFileUrl(ctx, "portrait", characterId, storageId);
}

type Access = { user: Doc<"users">; campaign: Doc<"campaigns">; permission: Permission; character: Doc<"characters">; canEdit: boolean };

/** Loads a character the user can see; `edit` requires edit permission (the GM or the character's owner). */
async function loadCharacter(ctx: QueryCtx, characterId: Id<"characters">, { edit = false } = {}): Promise<Access> {
  const user = await requireUser(ctx);
  const character = await ctx.db.get(characterId);
  if (character === null) throw new ConvexError("NOT_FOUND");
  const campaign = await liveCampaign(ctx, character.campaignId);
  const permission = await requirePermission(ctx, user, { type: "character", campaign, character }, edit ? "edit" : "view", "owner");
  return { user, campaign, permission, character, canEdit: atLeast(permission, "edit") };
}

async function toView(ctx: QueryCtx, c: Doc<"characters">, viewer: Doc<"users">, canEdit: boolean) {
  const sheet = parseSheet(c.sheet);
  const portraitUrl = sheet.portrait?.kind === "upload" ? await portraitFileUrl(ctx, c._id, sheet.portrait.storageId) : null;
  // Only editors get the upload's storage id; everyone else gets `portraitUrl` and a placeholder id.
  if (!canEdit && sheet.portrait?.kind === "upload") sheet.portrait = { kind: "upload", storageId: "hidden" };
  return {
    _id: c._id,
    ownerId: c.ownerId,
    status: c.status,
    sheet,
    /** Resolved URL of an uploaded portrait, or null. */
    portraitUrl,
    canEdit,
    mine: c.ownerId === viewer._id,
    updatedAt: c.updatedAt,
  };
}

export type CharacterView = Awaited<ReturnType<typeof toView>>;

/** Every character in the campaign; everyone in it can read every sheet. */
export const listByCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    const campaign = await liveCampaign(ctx, campaignId);
    // One permission check per request: edit on the campaign edits every sheet; otherwise only your own.
    const permission = await requirePermission(ctx, user, { type: "campaign", campaign }, "view", "edit");
    const rows = await ctx.db
      .query("characters")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
    return Promise.all(rows.map((c) => toView(ctx, c, user, atLeast(permission, "edit") || c.ownerId === user._id)));
  },
});

export const get = query({
  args: { characterId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("characters", args.characterId);
    if (id === null) return null;
    const { user, canEdit, character } = await loadCharacter(ctx, id).catch((e) => {
      if (e instanceof ConvexError && e.data === "NOT_FOUND") return { user: null, canEdit: false, character: null } as never;
      throw e;
    });
    if (!character) return null;
    return toView(ctx, character, user, canEdit);
  },
});

function assertSource(source: Source, allowExpansion: boolean, what: string) {
  if (source === "hope-and-fear" && !allowExpansion) {
    throw new Error(`${what} is Hope & Fear content, which this campaign doesn't use.`);
  }
}

/** Builds the stored sheet from a validated wizard draft (Core ch. 1). */
export function sheetFromDraft(draft: CharacterDraft, allowExpansion: boolean): CharacterSheet {
  const cls = getClass(draft.classId);
  if (!cls) throw new Error("Unknown class.");
  assertSource(cls.source, allowExpansion, cls.name);
  const sub = getSubclass(draft.subclassId);
  if (!sub || sub.classId !== cls.id) throw new Error("That subclass doesn't belong to the class.");
  const ancestryIds =
    draft.ancestry.kind === "single"
      ? [draft.ancestry.id]
      : draft.ancestry.kind === "mixed"
        ? [draft.ancestry.first, draft.ancestry.second]
        : [draft.ancestry.form];
  for (const id of ancestryIds) {
    const a = getAncestry(id);
    if (!a) throw new Error("Unknown ancestry.");
    assertSource(a.source, allowExpansion, a.name);
  }
  if (draft.ancestry.kind === "shapeshifter") assertSource("hope-and-fear", allowExpansion, "Shapeshifter");
  if (draft.ancestry.kind === "mixed" && draft.ancestry.first === draft.ancestry.second) {
    throw new Error("A mixed ancestry needs two different ancestries.");
  }
  const community = getCommunity(draft.communityId);
  if (!community) throw new Error("Unknown community.");
  assertSource(community.source, allowExpansion, community.name);

  const primary = getWeapon(draft.primaryWeaponId);
  if (!primary || primary.slot !== "primary") throw new Error("Choose a primary weapon.");
  if (primary.tier !== 1) throw new Error("Starting weapons are Tier 1.");
  assertSource(primary.source, allowExpansion, primary.name);
  if (primary.classId && primary.classId !== cls.id) throw new Error(`${primary.name} belongs to another class.`);
  if (draft.secondaryWeaponId) {
    const secondary = getWeapon(draft.secondaryWeaponId);
    if (!secondary || secondary.slot !== "secondary") throw new Error("Choose a secondary weapon.");
    if (primary.burden === "two-handed") throw new Error("A two-handed primary weapon leaves no hand for a secondary.");
    assertSource(secondary.source, allowExpansion, secondary.name);
  }
  if (primary.category === "magic" && !sub.spellcastTrait) {
    throw new Error("Magic weapons need a Spellcast trait from your subclass.");
  }
  const armor = getArmor(draft.armorId);
  if (!armor || armor.tier !== 1) throw new Error("Choose Tier 1 armor.");
  assertSource(armor.source, allowExpansion, armor.name);

  const allowedDomains = new Set<string>(cls.domains);
  for (const id of draft.domainCards) {
    const card = getDomainCard(id);
    if (!card || card.level !== 1 || !allowedDomains.has(card.domain)) {
      throw new Error("Starting domain cards must be level 1 from your class's domains.");
    }
  }
  if (new Set(draft.domainCards).size !== draft.domainCards.length) throw new Error("Choose two different domain cards.");

  if (!STARTING_POTIONS.includes(draft.potion)) throw new Error("Choose a Minor Health Potion or a Minor Stamina Potion.");

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
    inventory: ["Torch", "50 feet of rope", "Basic supplies", draft.potion, ...(draft.classItem ? [draft.classItem] : [])],
    gold: { handfuls: 1, bags: 0, chest: false },
    experiences: draft.experiences.map((name) => ({ name, value: STARTING_EXPERIENCE_VALUE })),
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
    if (!w || w.slot !== slot) throw new Error(`Choose a ${slot} weapon.`);
    if (w.tier > tier) throw new Error(`${w.name} is Tier ${w.tier}; this character is Tier ${tier}.`);
    assertSource(w.source, allowExpansion, w.name);
    if (w.classId && w.classId !== sheet.classId) throw new Error(`${w.name} belongs to another class.`);
    if (w.category === "magic" && !sub?.spellcastTrait) throw new Error("Magic weapons need a Spellcast trait from your subclass.");
    return w;
  };
  const primary = check(sheet.primaryWeaponId, "primary");
  if (sheet.secondaryWeaponId) {
    check(sheet.secondaryWeaponId, "secondary");
    if (primary.burden === "two-handed") throw new Error("A two-handed primary weapon leaves no hand for a secondary.");
    if (primary.burden === "barehanded") throw new Error(`${primary.name} can't be used with other weapons.`);
  }
  if (sheet.armorId) {
    const a = getArmor(sheet.armorId);
    if (!a) throw new Error("Unknown armor.");
    if (a.tier > tier) throw new Error(`${a.name} is Tier ${a.tier}; this character is Tier ${tier}.`);
    assertSource(a.source, allowExpansion, a.name);
  }
}

async function ownerFor(ctx: MutationCtx, campaign: Doc<"campaigns">, role: Role, user: Doc<"users">, ownerId?: Id<"users">) {
  if (!ownerId || ownerId === user._id) return user._id;
  if (role !== "gm") throw new ConvexError("FORBIDDEN");
  if (ownerId === campaign.ownerId) return ownerId;
  const member = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", ownerId))
    .unique();
  if (!member) throw new ConvexError({ code: "INVALID", message: "That player isn't in this campaign." });
  return ownerId;
}

/** Creates a character from the wizard. Players create their own; the GM may assign it to a player. */
export const create = mutation({
  args: { campaignId: v.id("campaigns"), draft: v.any(), ownerId: v.optional(v.id("users")), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, draft, ownerId, idempotencyKey }) => {
    const user = await requireUser(ctx);
    const { campaign, role } = await loadCampaign(ctx, user, campaignId);
    let parsed: CharacterDraft;
    try {
      parsed = characterDraftSchema.parse(draft);
    } catch (e) {
      invalid(e);
    }
    if (parsed.portrait?.kind === "upload") invalid(new Error("Upload a portrait from the sheet after creating the character."));
    const options = resolveOptions(campaign.frameId, campaign.options);
    let sheet: CharacterSheet;
    try {
      sheet = sheetFromDraft(parsed, options.hopeAndFear);
    } catch (e) {
      invalid(e);
    }
    const owner = await ownerFor(ctx, campaign, role, user, ownerId);
    return withIdempotency(
      ctx,
      { scopeKey: campaignScope(campaignId), key: idempotencyKey, kind: "character_create", request: { draft: parsed, owner }, createdBy: user._id, campaignId },
      async () => {
        const now = Date.now();
        const characterId = await ctx.db.insert("characters", {
          campaignId,
          ownerId: owner,
          createdBy: user._id,
          status: "active",
          sheet,
          createdAt: now,
          updatedAt: now,
        });
        return { characterId };
      },
    );
  },
});

/** GM only: hand a character to a player in the campaign (or back to the GM). */
export const assignOwner = mutation({
  args: { characterId: v.id("characters"), ownerId: v.id("users") },
  handler: async (ctx, { characterId, ownerId }) => {
    const { user, campaign, permission } = await loadCharacter(ctx, characterId);
    if (permission !== "owner") throw new ConvexError("FORBIDDEN");
    const owner = await ownerFor(ctx, campaign, "gm", user, ownerId);
    await ctx.db.patch(characterId, { ownerId: owner, updatedAt: Date.now() });
  },
});

async function saveSheet(ctx: MutationCtx, character: Doc<"characters">, sheet: CharacterSheet) {
  const parsed = characterSheetSchema.safeParse(sheet);
  if (!parsed.success) invalid(parsed.error);
  await ctx.db.patch(character._id, { sheet: parsed.data, updatedAt: Date.now() });
}

/** Edits sheet fields (identity, traits, equipment, experiences, story, notes). Owner or GM. */
export const updateSheet = mutation({
  args: { characterId: v.id("characters"), patch: v.any() },
  handler: async (ctx, { characterId, patch }) => {
    const { campaign, character } = await loadCharacter(ctx, characterId, { edit: true });
    let clean;
    try {
      clean = sheetPatchSchema.parse(patch);
    } catch (e) {
      invalid(e);
    }
    const sheet = parseSheet(character.sheet);
    const { secondaryWeaponId, armorId, ...rest } = clean;
    const next: CharacterSheet = { ...sheet, ...rest };
    if (secondaryWeaponId === null) delete next.secondaryWeaponId;
    else if (secondaryWeaponId !== undefined) next.secondaryWeaponId = secondaryWeaponId;
    if (armorId === null) delete next.armorId;
    else if (armorId !== undefined) next.armorId = armorId;
    next.armorMarked = Math.min(next.armorMarked, derivedDefense(next).armorScore);
    if ("primaryWeaponId" in clean || secondaryWeaponId !== undefined || armorId !== undefined || "level" in clean) {
      try {
        assertEquipment(next, resolveOptions(campaign.frameId, campaign.options).hopeAndFear);
      } catch (e) {
        invalid(e);
      }
    }
    if (clean.portrait?.kind === "upload") {
      // Uploaded portraits are attached through `attachPortrait`, never by id here.
      if (sheet.portrait?.kind !== "upload" || sheet.portrait.storageId !== clean.portrait.storageId) {
        invalid(new Error("Upload the portrait from the sheet."));
      }
    } else if ("portrait" in clean && sheet.portrait?.kind === "upload") {
      await deleteOwnFile(ctx, "portrait", character._id, sheet.portrait.storageId);
    }
    next.hp = Math.min(next.hp, next.hpMax);
    next.stress = Math.min(next.stress, next.stressMax);
    await saveSheet(ctx, character, next);
  },
});

/**
 * Marks or clears Hit Points, Stress, Hope, Armor Slots and scars by a delta,
 * within each track's slots. Extra Stress beyond full marks one Hit Point
 * (Core, "Marking Stress"). Owner or GM.
 */
export const adjustResource = mutation({
  args: {
    characterId: v.id("characters"),
    resource: v.union(v.literal("hp"), v.literal("stress"), v.literal("hope"), v.literal("armor"), v.literal("scars")),
    delta: v.number(),
  },
  handler: async (ctx, { characterId, resource, delta }) => {
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 12) invalid(new Error("Change by a whole number."));
    const { character } = await loadCharacter(ctx, characterId, { edit: true });
    const s = parseSheet(character.sheet);
    const next: CharacterSheet =
      resource === "armor"
        ? { ...s, armorMarked: Math.max(0, Math.min(derivedDefense(s).armorScore, s.armorMarked + delta)) }
        : applyResourceDelta(s, resource, delta);
    await saveSheet(ctx, character, next);
    return { hp: next.hp, stress: next.stress, hope: next.hope, armorMarked: next.armorMarked, scars: next.scars };
  },
});

/**
 * Takes damage in one step: compares it with the character's thresholds,
 * optionally marks an Armor Slot to reduce the severity by one, and marks the
 * resulting Hit Points (Core, "Hit Points and Damage Thresholds"). Owner or GM.
 */
export const applyDamage = mutation({
  args: { characterId: v.id("characters"), damage: v.number(), useArmorSlot: v.boolean() },
  handler: async (ctx, { characterId, damage, useArmorSlot }) => {
    if (!Number.isInteger(damage) || damage < 1 || damage > 999) invalid(new Error("Enter the damage as a whole number."));
    const { character } = await loadCharacter(ctx, characterId, { edit: true });
    const s = parseSheet(character.sheet);
    const defense = derivedDefense(s);
    const armor = s.armorId ? getArmor(s.armorId) : undefined;
    const thresholds = damageThresholds(s.level, armor?.baseThresholds ?? null);
    const slotFree = s.armorMarked < defense.armorScore;
    if (useArmorSlot && !slotFree) invalid(new Error("No Armor Slot is free."));
    const result = hitPointsToMark(damage, thresholds, useArmorSlot);
    const next: CharacterSheet = {
      ...s,
      armorMarked: useArmorSlot ? s.armorMarked + 1 : s.armorMarked,
      hp: Math.min(s.hpMax, s.hp + result.marks),
    };
    await saveSheet(ctx, character, next);
    return { severity: result.severity, marks: result.marks, hp: next.hp, armorMarked: next.armorMarked };
  },
});

/**
 * Moves a domain card between loadout (max 5) and vault. From the vault into
 * the loadout costs the card's Recall Cost in Stress unless it happens during
 * a rest (Core, "Domain Cards"). Owner or GM.
 */
export const moveCard = mutation({
  args: { characterId: v.id("characters"), cardId: v.string(), to: v.union(v.literal("loadout"), v.literal("vault")), duringRest: v.optional(v.boolean()) },
  handler: async (ctx, { characterId, cardId, to, duringRest }) => {
    const { character } = await loadCharacter(ctx, characterId, { edit: true });
    const s = parseSheet(character.sheet);
    if (!s.domainCards.owned.includes(cardId)) invalid(new Error("That card isn't in your deck."));
    const inLoadout = s.domainCards.loadout.includes(cardId);
    let next: CharacterSheet = { ...s };
    if (to === "vault") {
      if (!inLoadout) return;
      next.domainCards = { ...s.domainCards, loadout: s.domainCards.loadout.filter((c) => c !== cardId) };
    } else {
      if (inLoadout) return;
      if (s.domainCards.loadout.length >= 5) invalid(new Error("Your loadout holds at most 5 cards; vault one first."));
      if ((getDomainCard(cardId)?.level ?? 99) > s.level) invalid(new Error("That card is above your level."));
      next.domainCards = { ...s.domainCards, loadout: [...s.domainCards.loadout, cardId] };
      const recall = getDomainCard(cardId)?.recallCost ?? 0;
      if (!duringRest && recall > 0) next = { ...next, ...markStress(next, recall) };
      delete (next as Partial<{ vulnerable: boolean }>).vulnerable;
    }
    await saveSheet(ctx, character, next);
  },
});

/** Marks a character dead, retired or active again. Owner or GM. (Death moves come in D5.) */
export const setStatus = mutation({
  args: { characterId: v.id("characters"), status: v.union(v.literal("active"), v.literal("dead"), v.literal("retired")) },
  handler: async (ctx, { characterId, status }) => {
    const { character } = await loadCharacter(ctx, characterId, { edit: true });
    await ctx.db.patch(character._id, { status, updatedAt: Date.now() });
  },
});

/** GM only: delete a character. */
export const remove = mutation({
  args: { characterId: v.id("characters") },
  handler: async (ctx, { characterId }) => {
    const { permission, character } = await loadCharacter(ctx, characterId);
    if (permission !== "owner") throw new ConvexError("FORBIDDEN");
    await deleteFilesOf(ctx, "portrait", characterId);
    const prefix = `character:${characterId}:`;
    const trackers = await ctx.db
      .query("frameTrackers")
      .withIndex("by_campaign_key", (q) => q.eq("campaignId", character.campaignId).gte("key", prefix).lt("key", `${prefix}\uffff`))
      .collect();
    for (const row of trackers) await ctx.db.delete(row._id);
    await ctx.db.delete(characterId);
  },
});

export const MAX_PORTRAIT_BYTES = 3 * 1024 * 1024;

/** An upload URL for a portrait image of a character the caller edits. */
export const portraitUploadUrl = mutation({
  args: { characterId: v.id("characters") },
  handler: async (ctx, { characterId }) => {
    await loadCharacter(ctx, characterId, { edit: true });
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Attaches a just-uploaded file as the character's portrait. The file must be
 * an image of at most 3 MB that no other character uses; the previous upload
 * is deleted. Owner or GM.
 */
export const attachPortrait = mutation({
  args: { characterId: v.id("characters"), storageId: v.id("_storage") },
  handler: async (ctx, { characterId, storageId }) => {
    const { user, character } = await loadCharacter(ctx, characterId, { edit: true });
    const meta = await ctx.db.system.get(storageId);
    // Only an unclaimed file may be attached, so the rejections below only ever delete unclaimed files.
    if (meta === null || (await isClaimed(ctx, storageId))) throw new ConvexError("NOT_FOUND");
    if (!meta.contentType?.startsWith("image/") || meta.size > MAX_PORTRAIT_BYTES) {
      // Returned, not thrown: a throw would roll back the deletion.
      await ctx.storage.delete(storageId);
      return { error: "Portraits must be images of at most 3 MB." };
    }
    const sheet = parseSheet(character.sheet);
    // Validated before the file is claimed, so a rejected sheet leaves no orphan file.
    const next = characterSheetSchema.safeParse({ ...sheet, portrait: { kind: "upload", storageId } });
    if (!next.success) {
      await ctx.storage.delete(storageId);
      return { error: next.error.issues[0]?.message ?? "Invalid character." };
    }
    await claimFile(ctx, { storageId, campaignId: character.campaignId, uploadedBy: user._id, kind: "portrait", refId: characterId });
    if (sheet.portrait?.kind === "upload") await deleteOwnFile(ctx, "portrait", characterId, sheet.portrait.storageId);
    await saveSheet(ctx, character, next.data);
    return { error: null };
  },
});

/** Resolves an uploaded portrait's URL. */
export const portraitUrl = query({
  args: { characterId: v.id("characters") },
  handler: async (ctx, { characterId }) => {
    const { character } = await loadCharacter(ctx, characterId);
    const sheet = parseSheet(character.sheet);
    if (sheet.portrait?.kind !== "upload") return null;
    return portraitFileUrl(ctx, character._id, sheet.portrait.storageId);
  },
});
