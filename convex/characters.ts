import { v, type Infer } from "convex/values";

import {
  applyResourceDelta,
  addGold,
  BASE_HOPE_MAX,
  hitPointsToMark,
  hopeMax,
  MAX_BAGS,
  MAX_HANDFULS,
  STARTING_EXPERIENCE_VALUE,
  STARTING_HOPE,
  STARTING_PROFICIENCY,
  STARTING_STRESS,
} from "../src/lib/domain/characters/index";
import { derivedDefense, derivedThresholds } from "../src/lib/domain/characters/derived";
import { applySlotBonuses } from "../src/lib/domain/characters/slots";
import { negateMinor } from "../src/lib/domain/session-features/index";
import { spellcastTraitOf } from "../src/lib/domain/characters/spellcast";
import { addCard, cardTakeProblem, sourcesFor } from "../src/lib/domain/level-up/index";
import { assertEquipment, assertSource, IKONIS_ONLY } from "../src/lib/equipment-rules";
import { appError, RuleError } from "../src/lib/errors/app-error";
import { FRAME_OF } from "../src/lib/frames/extras/common";
import { MOTHERBOARD_STARTING_GOLD, NETWORK_TETHER } from "../src/lib/domain/motherboard/index";
import { ikonisMissing, ikonisSchema, startingMotherboard } from "../src/lib/frames/extras/motherboard";
import { resolveOptions } from "../src/lib/frames/options";
import {
  getAncestry,
  getArmor,
  getClass,
  getCommunity,
  getDomainCard,
  getSubclass,
  getWeapon,
} from "../src/lib/srd/index";
import { TRAIT_IDS } from "../src/lib/srd/types";
import {
  characterDraftSchema,
  characterSheetSchema,
  sheetPatchSchema,
  type CharacterDraft,
  type CharacterSheet,
  type CharacterSheetInput,
} from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { installedAugments, seedMotherboard } from "./characterExtras";
import { logAction } from "./lib/actionLog";
import { moveCardFor, writeHandHidden } from "./lib/cardHand";
import { featureScope } from "./sessionFeatures";
import { editable, findCharacter, loadCharacter, readSheet, saveSheet, storedSheet } from "./lib/characterSheet";
import { claimFile, deleteFilesOf, deleteOwnFile, isAllowedImage, isClaimed, ownFileUrl } from "./lib/files";
import { campaignQuery, keyedCampaignMutation, keyedUserMutation, userMutation, userQuery } from "./lib/functions";
import { assertMechanicEnabled } from "./lib/mechanics";
import { atLeast, type Permission } from "./lib/permissions";
import {
  characterDraftValidator,
  characterStatusValidator,
  characterViewValidator,
  conditionValidator,
  goldValidator,
  sheetPatchValidator,
  traitIdValidator,
  type CharacterView,
} from "./lib/validators/characters";
import { ikonisValidator } from "./lib/validators/characterExtras";
import { gainWitherToken } from "./wither";
import { witherGainValidator } from "./lib/validators/wither";
import { assertOneActive, MAX_CHARACTERS_PER_CAMPAIGN, partyOf } from "./lib/characterSheet";
export { assertOneActive, MAX_CHARACTERS_PER_CAMPAIGN };

export type { CharacterView };
// Moved to convex/lib/characterSheet.ts (D5 T0); re-exported for existing importers.
export { loadCharacter, readSheet, storedSheet };

/** A new stable id for an inventory item or Experience. */
function newId(): string {
  return crypto.randomUUID();
}

/** An expected validation failure, sent as `{ code: "INVALID", message }`. */
function invalid(message: string): never {
  throw appError("INVALID", message);
}

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
  // One party: a handful of characters.
  const rows = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .collect();
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

// ---------------------------------------------------------------- creation

/** Builds the stored sheet from a validated wizard draft (Core ch. 1). `ikonis`: a Motherboard campaign (CB 301). */
export function sheetFromDraft(draft: CharacterDraft, allowExpansion: boolean, ikonis = false): CharacterSheetInput {
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

  if (ikonis) {
    // CB 301: no normal weapons; the Ikonis is two-handed and lives in the Motherboard module.
    if (draft.primaryWeaponId || draft.secondaryWeaponId) throw new RuleError("INVALID", IKONIS_ONLY);
  } else {
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
    if (primary.category === "magic" && !spellcastTraitOf({ subclassId: sub.id })) {
      throw new RuleError("INVALID", "Magic weapons need a Spellcast trait from your subclass.");
    }
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

  const sheet: CharacterSheetInput = {
    name: draft.name,
    pronouns: draft.pronouns,
    ...(draft.pronounsLabel ? { pronounsLabel: draft.pronounsLabel } : {}),
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
    primaryWeaponId: draft.primaryWeaponId,
    ...(draft.secondaryWeaponId ? { secondaryWeaponId: draft.secondaryWeaponId } : {}),
    armorId: armor.id,
    // CB 301-302 (Motherboard): a Network tether joins the inventory and gold is not used (5 quantum instead).
    inventory: ["Torch", "50 feet of rope", "Basic supplies", draft.potion, ...(draft.classItem ? [draft.classItem] : []), ...(ikonis ? [NETWORK_TETHER] : [])].map(
      (name) => ({ id: newId(), name }),
    ),
    gold: ikonis ? { ...MOTHERBOARD_STARTING_GOLD } : { handfuls: 1, bags: 0, chest: false },
    experiences: draft.experiences.map((name) => ({ id: newId(), name, value: STARTING_EXPERIENCE_VALUE })),
    domainCards: { owned: [...draft.domainCards], loadout: [...draft.domainCards] },
    background: draft.background,
    connections: draft.connections,
    notes: "",
    ...(draft.portrait ? { portrait: draft.portrait } : {}),
  };
  assertEquipment(sheet, allowExpansion, { ikonis });
  // At Ease, Battlemage, Endurance, High Stamina: their slots raise the starting maximums.
  return applySlotBonuses(sheet);
}

/** "Your choice of a Minor Health Potion … or a Minor Stamina Potion" (Core ch. 1, step 5). */
const STARTING_POTIONS = ["Minor Health Potion", "Minor Stamina Potion"];

/** Refuses a new character past the campaign's cap, or a second active one for `owner`. */
async function assertRoom(ctx: QueryCtx, campaign: Doc<"campaigns">, owner: Id<"users">) {
  if ((await partyOf(ctx, campaign._id)).length >= MAX_CHARACTERS_PER_CAMPAIGN) invalid(`A campaign holds at most ${MAX_CHARACTERS_PER_CAMPAIGN} characters.`);
  await assertOneActive(ctx, campaign, owner);
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

/**
 * Creates a character from the wizard. Players create their own; the GM may
 * assign it to a player. In a Motherboard campaign the draft has no weapons and
 * `ikonis` is required (CB 301); a Warrior starts with Force installed (CB 295).
 */
export const create = keyedCampaignMutation({
  need: "view",
  rateLimit: "createCharacter",
  // Telling the GM from a player decides who may assign another owner.
  enough: "owner",
  args: { draft: characterDraftValidator, ownerId: v.optional(v.id("users")), ikonis: v.optional(ikonisValidator) },
  returns: v.object({ characterId: v.id("characters") }),
  handler: async (ctx, { draft, ownerId, ikonis }) => {
    const parsed = characterDraftSchema.parse(draft);
    if (parsed.portrait?.kind === "upload") invalid("Upload a portrait from the sheet after creating the character.");
    const motherboard = ctx.campaign.frameId === FRAME_OF.motherboard;
    const designed = ikonis === undefined ? undefined : ikonisSchema.parse(ikonis);
    if (!motherboard && designed) invalid("Only Motherboard characters have an Ikonis.");
    if (motherboard) {
      const missing = designed ? ikonisMissing(designed) : ["your Ikonis"];
      if (missing.length > 0) invalid(`Choose ${missing.join(", ")}.`);
    }
    const sheet = sheetFromDraft(parsed, resolveOptions(ctx.campaign.frameId, ctx.campaign.options).hopeAndFear, motherboard);
    const owner = await ownerFor(ctx, ctx.campaign, ctx.permission, ctx.user, ownerId);
    return ctx.once("character_create", { draft: parsed, owner, ikonis: designed ?? null }, async () => {
      await assertRoom(ctx, ctx.campaign, owner);
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
      if (designed) await seedMotherboard(ctx, ctx.campaign._id, characterId, startingMotherboard(designed, parsed.classId));
      return { characterId };
    });
  },
});

/** GM only: hand a character to a player in the campaign (or back to the GM). */
export const assignOwner = userMutation({
  args: { characterId: v.id("characters"), ownerId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { characterId, ownerId }) => {
    const { campaign, permission, character } = await loadCharacter(ctx, ctx.user, characterId, "owner");
    const owner = await ownerFor(ctx, campaign, permission, ctx.user, ownerId);
    if (owner !== character.ownerId && character.status === "active") await assertOneActive(ctx, campaign, owner, character._id);
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
    const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
    const sheet = readSheet(character.sheet);
    const clean = sheetPatchSchema.parse(patch);
    // Players change traits only through level-up (user 2026-10-18); the GM can still correct them.
    if (clean.traits !== undefined && permission !== "owner") throw appError("FORBIDDEN");
    const { secondaryWeaponId, armorId, inventory, experiences, ...rest } = clean;
    const next: CharacterSheet = { ...sheet, ...rest };
    // CB 104: a category holds at most 9 marks (a 10th rolls over through adjustGold).
    if (rest.gold) next.gold = { ...rest.gold, handfuls: Math.min(rest.gold.handfuls, MAX_HANDFULS), bags: Math.min(rest.gold.bags, MAX_BAGS) };
    if (inventory !== undefined) next.inventory = inventory.map((item) => (typeof item === "string" ? { id: newId(), name: item } : item));
    if (experiences !== undefined) next.experiences = experiences.map((e) => ({ ...e, id: e.id ?? newId() }));
    if (secondaryWeaponId === null) delete next.secondaryWeaponId;
    else if (secondaryWeaponId !== undefined) next.secondaryWeaponId = secondaryWeaponId;
    if (armorId === null) delete next.armorId;
    else if (armorId !== undefined) next.armorId = armorId;
    next.armorMarked = Math.min(next.armorMarked, derivedDefense(next, await installedAugments(ctx, campaign, character._id)).armorScore);
    if ("primaryWeaponId" in clean || secondaryWeaponId !== undefined || armorId !== undefined) {
      const ikonis = campaign.frameId === FRAME_OF.motherboard;
      // CB 301: no new weapons in a Motherboard campaign (an empty primary is the Ikonis).
      if (ikonis && ((clean.primaryWeaponId ?? "") !== "" || (secondaryWeaponId ?? null) !== null)) invalid(IKONIS_ONLY);
      assertEquipment(next, resolveOptions(campaign.frameId, campaign.options).hopeAndFear, { ikonis });
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
    // CB 104: at most 9 handfuls and 9 bags; a 10th rolls over into the next category, and only one chest.
    const gold = addGold(sheet.gold, coin, delta);
    if (gold === null) invalid("You already have a chest of gold; store some before you take more.");
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

/** Sets one trait's modifier. GM only: players change traits through level-up (user 2026-10-18). */
export const setTrait = userMutation({
  args: { characterId: v.id("characters"), trait: traitIdValidator, value: v.number() },
  returns: v.null(),
  handler: async (ctx, { characterId, trait, value }) => {
    const { character } = await loadCharacter(ctx, ctx.user, characterId, "owner", "owner");
    const sheet = readSheet(character.sheet);
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
    const { campaign, character, sheet: s } = await editable(ctx, ctx.user, characterId);
    const next: CharacterSheet =
      resource === "armor"
        ? { ...s, armorMarked: Math.max(0, Math.min(derivedDefense(s, await installedAugments(ctx, campaign, character._id)).armorScore, s.armorMarked + delta)) }
        : applyResourceDelta(s, resource, delta);
    if (resource === "scars") {
      // One scar per Hope slot, a seventh with Light in the Dark (CB 40, 106); `applyResourceDelta` stops at 6.
      next.scars = Math.max(0, Math.min(BASE_HOPE_MAX + s.hopeSlotBonus, s.scars + delta));
      next.hope = Math.min(next.hope, hopeMax(next.scars, s.hopeSlotBonus));
    }
    await saveSheet(ctx, character._id, next);
    return { hp: next.hp, stress: next.stress, hope: next.hope, armorMarked: next.armorMarked, scars: next.scars };
  },
});

/**
 * Switches one condition on the sheet (CB p.102: Vulnerable, Restrained, Hidden...): on when it was off, off when it was
 * on. Owner or GM; used by the Combat Map's token card (user 2026-10-20).
 */
export const toggleCondition = userMutation({
  args: { characterId: v.id("characters"), condition: conditionValidator },
  returns: v.object({ conditions: v.array(conditionValidator) }),
  handler: async (ctx, { characterId, condition }) => {
    const { character, sheet: s } = await editable(ctx, ctx.user, characterId);
    const conditions = s.conditions.includes(condition) ? s.conditions.filter((c) => c !== condition) : [...s.conditions, condition];
    await saveSheet(ctx, character._id, { ...s, conditions });
    return { conditions };
  },
});

/**
 * Takes damage in one step: compares it with the character's thresholds,
 * optionally marks an Armor Slot to reduce the severity by one, and marks the
 * resulting Hit Points (Core, "Hit Points and Damage Thresholds"). Owner or GM.
 * `withered` (Witherwild, CB 261): Severe damage (after the Armor Slot) from a
 * Withered source also gains a Wither token and rolls the Fear Die
 * (convex/wither.ts); outside Witherwild it is MECHANIC_DISABLED. Keyed
 * (review L2): a retry with the same idempotency key returns the first result.
 * `negateMinor` (Lunar Phases, New moon, HF p.17 "Spend a Hope to negate Minor
 * damage"; plan session-features U6): allowed only when F0's `canNegateMinor`
 * holds for the severity after the Armor Slot (else CLASS_FEATURE_RULE); spends
 * the Hope, marks no Hit Point (a chosen Armor Slot is still marked), returns
 * marks 0 and writes one undoable public row. Plain damage stays unlogged (E4).
 */
export const applyDamage = keyedUserMutation({
  args: { characterId: v.id("characters"), damage: v.number(), useArmorSlot: v.boolean(), withered: v.optional(v.boolean()), negateMinor: v.optional(v.literal(true)) },
  returns: v.object({
    severity: v.union(v.literal("none"), v.literal("minor"), v.literal("major"), v.literal("severe")),
    marks: v.number(),
    hp: v.number(),
    armorMarked: v.number(),
    wither: v.optional(witherGainValidator),
  }),
  handler: async (ctx, { characterId, damage, useArmorSlot, withered, negateMinor: negate }) =>
    // `negateMinor` joins the request only when set, so plain damage keeps its request hash.
    ctx.once("character_damage", { characterId, damage, useArmorSlot, withered: withered ?? false, ...(negate ? { negateMinor: true } : {}) }, async () => {
      if (!Number.isInteger(damage) || damage < 1 || damage > 999) invalid("Enter the damage as a whole number.");
      const { campaign, character, sheet: s } = await editable(ctx, ctx.user, characterId);
      if (withered) assertMechanicEnabled(campaign, "witherTokens");
      const scope = featureScope(campaign);
      const defense = derivedDefense(s, await installedAugments(ctx, campaign, character._id), scope);
      // Armor base + level + always-on subclass bonuses (CB 36, 45; HF 10) + a Full moon's +3 (HF 17).
      const thresholds = derivedThresholds(s, scope);
      if (useArmorSlot && s.armorMarked >= defense.armorScore) invalid("No Armor Slot is free.");
      const result = hitPointsToMark(damage, thresholds, useArmorSlot);
      const armored: CharacterSheet = { ...s, armorMarked: useArmorSlot ? s.armorMarked + 1 : s.armorMarked };
      if (negate) {
        // Refuses (CLASS_FEATURE_RULE) unless the New moon covers this severity and a Hope is there to spend.
        const next = negateMinor(armored, result.severity, scope);
        await saveSheet(ctx, character._id, next);
        await logAction(ctx, {
          campaignId: campaign._id,
          characterId: character._id,
          actorId: ctx.user._id,
          kind: "feature",
          visibility: "public",
          summary: `${s.name} spent a Hope: the New Moon negates Minor damage`,
          before: s,
          undoable: true,
        });
        return { severity: "minor" as const, marks: 0, hp: next.hp, armorMarked: next.armorMarked };
      }
      const next: CharacterSheet = { ...armored, hp: Math.min(s.hpMax, s.hp + result.marks) };
      await saveSheet(ctx, character._id, next);
      // The Wither row's `before` is the damaged sheet: undoing it takes back the token, not the damage.
      const wither =
        withered && result.severity === "severe"
          ? await gainWitherToken(ctx, { campaignId: campaign._id, characterId: character._id, sheet: next, actorId: ctx.user._id, source: "Severe Withered damage" })
          : undefined;
      return { severity: result.severity, marks: result.marks, hp: next.hp, armorMarked: next.armorMarked, ...(wither ? { wither } : {}) };
    }),
});

/**
 * Moves a domain card between loadout (max 5) and vault; from the vault it costs the card's Recall Cost in Stress unless
 * during an open party rest (CB 101, 105). The character's player, or the GM for any character of the campaign, logged as
 * the GM acting for it (CA4b). See `moveCardFor` in convex/lib/cardHand.ts.
 */
export const moveCard = userMutation({
  args: { characterId: v.id("characters"), cardId: v.string(), to: v.union(v.literal("loadout"), v.literal("vault")), duringRest: v.optional(v.boolean()) },
  returns: v.null(),
  handler: (ctx, { characterId, cardId, to, duringRest }) => moveCardFor(ctx, ctx.user, characterId, cardId, to, duringRest),
});

/**
 * Takes a card from the Domain Deck (owner or GM): a card of the campaign's sources from the character's class or
 * multiclass domains within reach of their level, while they have picks left (level + 1 + "additional domain card"
 * advancements). It goes into the loadout while it has room, else into the vault; no Stress. INVALID otherwise.
 */
export const takeCard = userMutation({
  args: { characterId: v.id("characters"), cardId: v.string() },
  returns: v.null(),
  handler: async (ctx, { characterId, cardId }) => {
    const { campaign, character, sheet: s } = await editable(ctx, ctx.user, characterId);
    const sources = sourcesFor({ allowExpansion: resolveOptions(campaign.frameId, campaign.options).hopeAndFear });
    const problem = cardTakeProblem(s, cardId, sources);
    if (problem) invalid(problem.message);
    await saveSheet(ctx, character._id, { ...s, domainCards: addCard(s.domainCards, cardId) });
    return null;
  },
});

/**
 * Marks a character dead, retired, active again, or `away` (benched, X6).
 * Owner or GM. Only an active character is benched. Only the GM moves a
 * character out of dead or a Castle High away (review M3: an owner can't
 * revive their own character); the owner brings back their own benched one.
 * A move into `active` keeps one active character per player
 * (`assertOneActive`, INVALID). Any change clears or replaces `away`.
 */
export const setStatus = userMutation({
  args: { characterId: v.id("characters"), status: characterStatusValidator },
  returns: v.null(),
  handler: async (ctx, { characterId, status }) => {
    const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
    if (status === character.status) return null;
    const benched = character.status === "away" && character.away?.reason === "benched";
    const ownerMayLeave = character.status === "active" || character.status === "retired" || (benched && status === "active");
    if (!ownerMayLeave && permission !== "owner") throw appError("FORBIDDEN");
    if (status === "away" && character.status !== "active") invalid("Only an active character can be sent away.");
    if (status === "active") await assertOneActive(ctx, campaign, character.ownerId, character._id);
    await ctx.db.patch("characters", characterId, { status, away: status === "away" ? { reason: "benched" } : undefined, updatedAt: Date.now() });
    return null;
  },
});

/** GM only: delete a character, its portrait files and its extras. */
export const remove = userMutation({
  args: { characterId: v.id("characters") },
  returns: v.null(),
  handler: async (ctx, { characterId }) => {
    const { campaign } = await loadCharacter(ctx, ctx.user, characterId, "owner");
    await deleteFilesOf(ctx, "portrait", characterId);
    // At most one row per extra. Rows still in `frameTrackers` are deleted by
    // `migrations/characterExtras:moveFromTrackers` once their character is gone.
    const extras = await ctx.db
      .query("characterExtras")
      .withIndex("by_character_extra", (q) => q.eq("characterId", characterId))
      .collect();
    for (const row of extras) await ctx.db.delete("characterExtras", row._id);
    // F7-H4: a removed character leaves the campaign's hidden-hands list.
    await writeHandHidden(ctx, campaign._id, characterId, false);
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
