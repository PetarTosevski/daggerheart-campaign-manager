import { v } from "convex/values";

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
  cardHolders,
  sharedCardRefusal,
  type CardHolder,
  type Gold,
} from "../src/lib/domain/characters/index";
import { derivedDefense, derivedThresholds } from "../src/lib/domain/characters/derived";
import { applySlotBonuses } from "../src/lib/domain/characters/slots";
import { negateMinor } from "../src/lib/domain/session-features/index";
import { spellcastTraitOf } from "../src/lib/domain/characters/spellcast";
import { addCard, cardTakeProblem, sourcesFor } from "../src/lib/domain/level-up/index";
import { holdsPurposefulDesign } from "../src/lib/domain/dice/index";
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
import { characterDraftSchema, sheetPatchSchema, type CharacterDraft } from "../src/lib/validation/character-input";
import { characterSheetSchema, type CharacterSheet, type CharacterSheetInput } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { installedAugments, seedMotherboard } from "./characterExtras";
import { logAction } from "./lib/actionLog";
import { moveCardFor, writeHandHidden } from "./lib/cardHand";
import { withoutCondition } from "./lib/conditionMarkers";
import { featureScope } from "./sessionFeatures";
import { editable, loadCharacter, readSheet, saveSheet, storedSheet } from "./lib/characterSheet";
import { claimFile, deleteFilesOf, deleteOwnFile, isAllowedImage, isClaimed } from "./lib/files";
import { keyedCampaignMutation, keyedUserMutation, userMutation } from "./lib/functions";
import { assertMechanicEnabled } from "./lib/mechanics";
import { type Permission } from "./lib/permissions";
import { characterDraftValidator, characterStatusValidator, conditionValidator, goldValidator, sheetPatchValidator, traitIdValidator, type CharacterView } from "./lib/validators/characters";
import { ikonisValidator } from "./lib/validators/characterExtras";
import { gainWitherToken } from "./wither";
import { postRuleNote, ruleMode, ruleModesOf } from "./lib/ruleModes";
import { canMakeDeathMove, lastHpNote } from "../src/lib/domain/death/index";
import { witherOnDamage } from "../src/lib/domain/wither/index";
import { witherGainValidator } from "./lib/validators/wither";
import { assertCharacterCap, assertOneActive, MAX_CHARACTERS_CREATED_PER_CAMPAIGN, MAX_CHARACTERS_PER_CAMPAIGN, partyOf } from "./lib/characterSheet";
export { assertOneActive, MAX_CHARACTERS_PER_CAMPAIGN };

export type { CharacterView };
// The reads moved to convex/charactersReads.ts (dcm-uh6r); re-exported for existing importers.
export { partyMemberValidator, type PartyMember } from "./charactersReads";
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

/**
 * Shared domain cards (CB p.21, plan rule-switches OSC): under `refuse`, throws `code` when another character of the
 * campaign (every character but `exceptId`, whatever its status) holds one of `cardIds` in its loadout or vault. `allow`
 * and `warn` (the default) never refuse; the pickers show the `warn` note. Reads the party only under `refuse`.
 */
export async function assertCardsUnshared(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  cardIds: readonly string[],
  code: "INVALID" | "LEVEL_UP_RULE",
  exceptId?: Id<"characters">,
): Promise<void> {
  const mode = ruleMode(campaign, "sharedDomainCards");
  const wanted = cardIds.filter((id) => id !== "");
  if (mode !== "refuse" || wanted.length === 0) return;
  const party: CardHolder[] = [];
  for (const c of await partyOf(ctx, campaign._id)) {
    let sheet: CharacterSheet;
    try {
      sheet = readSheet(c.sheet);
    } catch {
      continue;
    }
    party.push({ id: c._id, name: sheet.name, cards: [...sheet.domainCards.owned, ...sheet.domainCards.loadout] });
  }
  const problem = sharedCardRefusal(mode, cardHolders(party, exceptId), wanted, (id) => getDomainCard(id)?.name ?? id);
  if (problem !== null) throw appError(code, problem);
}

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
  // Purposeful Design (CB p.53, DA11): only an ancestry that gives it may name the Experience.
  if (draft.purposefulExperience !== undefined && !holdsPurposefulDesign(draft.ancestry, { hopeAndFear: allowExpansion })) {
    throw new RuleError("INVALID", "Only a character with Purposeful Design picks an Experience for it.");
  }

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
    // The +1 is recorded on the chosen Experience, never added to its value (DA11).
    experiences: draft.experiences.map((name, i) => ({
      id: newId(),
      name,
      value: STARTING_EXPERIENCE_VALUE,
      ...(i === draft.purposefulExperience ? { purposefulDesign: true as const } : {}),
    })),
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

/**
 * Refuses a new character past the campaign's cap, past `owner`'s per-player cap (AD5b, CAP_CHARACTERS_PER_PLAYER),
 * or a second active one for `owner`.
 */
async function assertRoom(ctx: QueryCtx, campaign: Doc<"campaigns">, owner: Id<"users">) {
  // The creation cap, not the read bound (dcm-bxp.38): a campaign above a lowered cap still reads every character.
  if ((await partyOf(ctx, campaign._id)).length >= MAX_CHARACTERS_CREATED_PER_CAMPAIGN) invalid(`A campaign holds at most ${MAX_CHARACTERS_CREATED_PER_CAMPAIGN} characters.`);
  await assertCharacterCap(ctx, campaign, owner);
  await assertOneActive(ctx, campaign, owner);
}

/** The owner of a new or reassigned character: the caller, or (GM only) the GM or a member of the campaign. */
async function ownerFor(ctx: MutationCtx, campaign: Doc<"campaigns">, permission: Permission, user: Doc<"users">, ownerId?: Id<"users">) {
  if (!ownerId || ownerId === user._id) return user._id;
  if (permission !== "owner") throw appError("FORBIDDEN");
  // Identity: the creator has no member row; co-GMs and players are found below.
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
    await assertCardsUnshared(ctx, ctx.campaign, parsed.domainCards, "INVALID");
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
    // Gold coins (OSC) change only through adjustGold: a whole-gold write keeps the stored coins.
    if (rest.gold) {
      const { coins } = sheet.gold as Gold;
      next.gold = { handfuls: Math.min(rest.gold.handfuls, MAX_HANDFULS), bags: Math.min(rest.gold.bags, MAX_BAGS), chest: rest.gold.chest, ...(coins === undefined ? {} : { coins }) };
    }
    if (inventory !== undefined) next.inventory = inventory.map((item) => (typeof item === "string" ? { id: newId(), name: item } : item));
    if (experiences !== undefined) {
      // Purposeful Design stays on the Experience the sheet recorded (DA11); a whole-list write can't move or add it.
      const chosen = sheet.experiences.find((e) => e.purposefulDesign)?.id;
      next.experiences = experiences.map((e) => {
        const id = e.id ?? newId();
        return { id, name: e.name, value: e.value, ...(id === chosen ? { purposefulDesign: true as const } : {}) };
      });
    }
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
    // A lowered maximum can leave every Hit Point marked.
    await lastHpNoteIfManual(ctx, campaign, character, sheet, next);
    return null;
  },
});

/**
 * X1 Manual (rule switches RX / DEF, bead dcm-jh6d.69; CB p.106): a sheet write that marks the character's last Hit Point
 * tells the GM "<name> marked their last HP: their death move is made at the table." (the hit path's note,
 * convex/lib/incomingHits.ts). These writes are not logged (no action group), so the note carries no characterId or
 * groupId and is never undoable. Book: nothing (the sheet's death-move prompt asks the player).
 */
async function lastHpNoteIfManual(ctx: MutationCtx & { user: Doc<"users"> }, campaign: Doc<"campaigns">, character: Doc<"characters">, before: CharacterSheet, after: CharacterSheet): Promise<void> {
  if (ruleMode(campaign, "deathMovePrompt") !== "manual") return;
  const due = (sheet: CharacterSheet) => canMakeDeathMove({ status: character.status, hp: sheet.hp, hpMax: sheet.hpMax, conditions: sheet.conditions });
  if (due(before) || !due(after)) return;
  await postRuleNote(ctx, campaign, { ruleId: "deathMovePrompt", summary: lastHpNote(after.name), actorId: ctx.user._id });
}

/** A whole-number change of at most `max` either way. */
function assertDelta(delta: number, max: number) {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > max) invalid("Change by a whole number.");
}

/**
 * Adds `delta` coins, handfuls or bags of gold. Owner or GM. `coins` only while the campaign's Gold coins rule is on
 * (CB p.104, plan rule-switches OSC; MECHANIC_DISABLED otherwise): 10 coins roll over into 1 handful.
 */
export const adjustGold = userMutation({
  args: { characterId: v.id("characters"), coin: v.union(v.literal("coins"), v.literal("handfuls"), v.literal("bags")), delta: v.number() },
  returns: goldValidator,
  handler: async (ctx, { characterId, coin, delta }) => {
    assertDelta(delta, 99);
    const { campaign, character, sheet } = await editable(ctx, ctx.user, characterId);
    if (coin === "coins" && !ruleMode(campaign, "goldCoins")) throw appError("MECHANIC_DISABLED", "Gold coins are off in this campaign.");
    // CB 104: at most 9 handfuls and 9 bags (and 9 coins); a 10th rolls over into the next category, and only one chest.
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

/** The range of a trait or Experience modifier (`characterSheetSchema`). */
const MODIFIER_MIN = -5;
const MODIFIER_MAX = 10;

/** A modifier moved by `delta` (an intent, dcm-bxp.28), kept within the modifier range. */
function shifted(current: number, delta: number): number {
  assertDelta(delta, MODIFIER_MAX - MODIFIER_MIN);
  return Math.min(MODIFIER_MAX, Math.max(MODIFIER_MIN, current + delta));
}

/** Exactly one of `value` and `delta`. */
function oneOf(value: number | undefined, delta: number | undefined): void {
  if ((value === undefined) === (delta === undefined)) invalid("Send a value or a change, not both.");
}

/**
 * Sets one trait's modifier (`value`), or moves it by `delta` (the sheet's steppers send a delta, so two quick clicks
 * add up instead of the second overwriting the first; dcm-bxp.28), kept within -5..+10. GM only: players change traits
 * through level-up (user 2026-10-18).
 */
export const setTrait = userMutation({
  args: { characterId: v.id("characters"), trait: traitIdValidator, value: v.optional(v.number()), delta: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { characterId, trait, value, delta }) => {
    oneOf(value, delta);
    const { character } = await loadCharacter(ctx, ctx.user, characterId, "owner", "owner");
    const sheet = readSheet(character.sheet);
    const next = delta === undefined ? value! : shifted(sheet.traits[trait], delta);
    await saveSheet(ctx, character._id, { ...sheet, traits: { ...sheet.traits, [trait]: next } });
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

/**
 * Renames an Experience, sets its stored bonus (`value`) or moves it by `delta` (an intent, dcm-bxp.28; kept within
 * -5..+10), by id. `value` and `delta` don't go together. Owner or GM.
 */
export const setExperience = userMutation({
  args: {
    characterId: v.id("characters"),
    experienceId: v.string(),
    name: v.optional(v.string()),
    value: v.optional(v.number()),
    delta: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { characterId, experienceId, name, value, delta }) => {
    if (value !== undefined && delta !== undefined) oneOf(value, delta);
    const { character, sheet } = await editable(ctx, ctx.user, characterId);
    if (!sheet.experiences.some((e) => e.id === experienceId)) throw appError("NOT_FOUND");
    const experiences = sheet.experiences.map((e) =>
      e.id === experienceId
        ? {
            ...e,
            ...(name !== undefined ? { name } : {}),
            ...(value !== undefined ? { value } : {}),
            ...(delta !== undefined ? { value: shifted(e.value, delta) } : {}),
          }
        : e,
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
 * Purposeful Design (Clank, CB p.53: "At character creation, choose one of your Experiences that best aligns with this
 * purpose and gain a permanent +1 bonus to it."): records the chosen Experience (DA11, user 2026-10-29). The stored value
 * stays; rolls and displays add the +1 (`experienceValue`), so the shown value may reach +11 (the level-up cap counts the
 * stored value, user 2026-10-30).
 * - The owner picks once, for a character created without the choice.
 * - The GM (permission `owner` on the character) may move the +1 to another Experience later, as a correction (DA16,
 *   user 2026-10-30). Moving it to the Experience that already holds it is a no-op.
 * Removing the chosen Experience removes the +1 with it, and the sheet offers the pick again.
 * Each pick or move writes one undoable feed row. Refusals: FEATURE_NOT_OWNED (the sheet doesn't hold the feature),
 * NOT_FOUND (no such Experience), INVALID (the owner's second pick).
 */
export const choosePurposefulDesign = keyedUserMutation({
  args: { characterId: v.id("characters"), experienceId: v.string() },
  returns: v.null(),
  handler: async (ctx, { characterId, experienceId }) =>
    ctx.once("character_purposeful_design", { characterId, experienceId }, async () => {
      const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
      const sheet = readSheet(character.sheet);
      if (!holdsPurposefulDesign(sheet.ancestry, { hopeAndFear: resolveOptions(campaign.frameId, campaign.options).hopeAndFear })) {
        throw appError("FEATURE_NOT_OWNED");
      }
      const target = sheet.experiences.find((e) => e.id === experienceId);
      if (target === undefined) throw appError("NOT_FOUND");
      const current = sheet.experiences.find((e) => e.purposefulDesign);
      if (current !== undefined && permission !== "owner") invalid("Purposeful Design already has its Experience.");
      if (current?.id === experienceId) return null;
      const experiences = sheet.experiences.map((e) => (e.id === experienceId ? { ...e, purposefulDesign: true as const } : { id: e.id, name: e.name, value: e.value }));
      await saveSheet(ctx, character._id, { ...sheet, experiences });
      await logAction(ctx, {
        campaignId: campaign._id,
        characterId: character._id,
        actorId: ctx.user._id,
        kind: "feature",
        visibility: "public",
        summary:
          current === undefined
            ? `${sheet.name}: Purposeful Design gives +1 to ${target.name}`
            : `${sheet.name}: Purposeful Design's +1 moved from ${current.name} to ${target.name}`,
        before: sheet,
        undoable: true,
      });
      return null;
    }),
});

/**
 * Marks or clears Hit Points, Stress, Hope, Armor Slots and scars by a delta,
 * within each track's slots. Extra Stress beyond full marks one Hit Point
 * (Core, "Marking Stress"). Owner or GM.
 *
 * Rule switches (bead dcm-jh6d.71): the campaign's modes go into `applyResourceDelta`. D4 Manual (CB p.92): Stress past a
 * full track is dropped, no Hit Point, and the GM gets "<name>: Stress full, mark 1 HP?"; D5 Manual: a full track doesn't
 * make the character Vulnerable by itself. X1 Manual: marking the last Hit Point notes it for the GM
 * (`lastHpNoteIfManual`). The writes are unlogged, so the notes carry no group and are never undoable.
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
    const modes = ruleModesOf(campaign);
    const next: CharacterSheet =
      resource === "armor"
        ? { ...s, armorMarked: Math.max(0, Math.min(derivedDefense(s, await installedAugments(ctx, campaign, character._id)).armorScore, s.armorMarked + delta)) }
        : applyResourceDelta(s, resource, delta, modes);
    if (resource === "scars") {
      // One scar per Hope slot, a seventh with Light in the Dark (CB 40, 106); `applyResourceDelta` stops at 6.
      next.scars = Math.max(0, Math.min(BASE_HOPE_MAX + s.hopeSlotBonus, s.scars + delta));
      next.hope = Math.min(next.hope, hopeMax(next.scars, s.hopeSlotBonus));
    }
    await saveSheet(ctx, character._id, next);
    if (resource === "stress" && delta > 0 && s.stress + delta > s.stressMax && modes.stressOverflow === "manual") {
      await postRuleNote(ctx, campaign, { ruleId: "stressOverflow", summary: `${s.name}: Stress full, mark 1 HP?`, actorId: ctx.user._id });
    }
    await lastHpNoteIfManual(ctx, campaign, character, s, next);
    return { hp: next.hp, stress: next.stress, hope: next.hope, armorMarked: next.armorMarked, scars: next.scars };
  },
});

/**
 * Switches one condition on the sheet (CB p.102: Vulnerable, Restrained, Hidden...): on when it was off, off when it was
 * on. Owner or GM; used by the Combat Map's token card (user 2026-10-20).
 *
 * Plan lanes-2 E1.3a: turning a condition off drops its source marker too (`withoutCondition`; dcm-bxp.99.19.68: else a
 * later ordinary Cloaked would read as Vanishing Act's until the next rest). Turning Unconscious on drops Cloaked, any
 * Cloaked (dcm-bxp.99.19.63; user 2026-10-30: a rogue who is unconscious or dead drops Cloaked).
 */
export const toggleCondition = userMutation({
  args: { characterId: v.id("characters"), condition: conditionValidator },
  returns: v.object({ conditions: v.array(conditionValidator) }),
  handler: async (ctx, { characterId, condition }) => {
    const { character, sheet: s } = await editable(ctx, ctx.user, characterId);
    const on = !s.conditions.includes(condition);
    let next: CharacterSheet = on ? { ...s, conditions: [...s.conditions, condition] } : withoutCondition(s, condition);
    if (on && condition === "unconscious") next = withoutCondition(next, "cloaked");
    await saveSheet(ctx, character._id, next);
    return { conditions: next.conditions };
  },
});

/**
 * Takes damage in one step: compares it with the character's thresholds,
 * optionally marks an Armor Slot to reduce the severity by one, and marks the
 * resulting Hit Points (Core, "Hit Points and Damage Thresholds"). Owner or GM.
 * `withered` (Witherwild, CB 261): Severe damage (after the Armor Slot) from a
 * Withered source also gains a Wither token and rolls the Fear Die
 * (convex/wither.ts); with rule W1 `witherTokens` on Manual it adds nothing
 * and posts a GM-only note instead; outside Witherwild it is MECHANIC_DISABLED. Keyed
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
      await lastHpNoteIfManual(ctx, campaign, character, s, next);
      // W1 (rule switch `witherTokens`, CB 261). Book: the Wither row's `before` is the damaged sheet, so undoing it
      // takes back the token, not the damage. Manual: no token and no roll; the GM gets a note. Plain damage is
      // unlogged (no action group), so the note carries no characterId or groupId and is never undoable.
      const witherStep = witherOnDamage(result.severity, withered ?? false, withered ? ruleMode(campaign, "witherTokens") : "book");
      if (witherStep === "note") {
        await postRuleNote(ctx, campaign, {
          ruleId: "witherTokens",
          summary: `${s.name} took Severe damage from a Withered source: add a Wither token and roll?`,
          actorId: ctx.user._id,
        });
      }
      const wither =
        witherStep === "gain"
          ? await gainWitherToken(ctx, { campaignId: campaign._id, characterId: character._id, sheet: next, actorId: ctx.user._id, source: "Severe Withered damage" })
          : undefined;
      return { severity: result.severity, marks: result.marks, hp: next.hp, armorMarked: next.armorMarked, ...(wither ? { wither } : {}) };
    }),
});

/**
 * Moves a domain card between loadout (max 5) and vault; from the vault it costs the card's Recall Cost in Stress unless
 * during an open party rest (CB 101, 105). The character's player, or the GM for any character of the campaign, logged as
 * the GM acting for it (CA4b). See `moveCardFor` in convex/lib/cardHand.ts.
 *
 * Plan lanes-2, E1 (dcm-cfpv, dcm-bxp.99.19.1): `recallRiders` names the `whenYouRecall` rider uses the player takes with
 * a recall (`<featureId or cardId>` or `<id>:<useId>`; Perfect Recall, CB p.50: "Once per rest, when you recall a domain
 * card in your vault, you can reduce its Recall Cost by 1"). At most 5; a rider that can't run is INVALID.
 */
export const moveCard = userMutation({
  args: {
    characterId: v.id("characters"),
    cardId: v.string(),
    to: v.union(v.literal("loadout"), v.literal("vault")),
    duringRest: v.optional(v.boolean()),
    recallRiders: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: (ctx, { characterId, cardId, to, duringRest, recallRiders }) => moveCardFor(ctx, ctx.user, characterId, cardId, to, duringRest, recallRiders ?? []),
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
    await assertCardsUnshared(ctx, campaign, [cardId], "INVALID", character._id);
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
