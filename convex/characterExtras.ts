import { v } from "convex/values";
import { z } from "zod";

import { hopeMax, tierForLevel } from "../src/lib/domain/characters/index";
import { gatherScrap as rollScrap } from "../src/lib/domain/frames/motherboard";
import { SWAP_NEEDS_DOWNTIME } from "../src/lib/domain/motherboard/index";
import {
  companionLost,
  CORRUPTION_REPAIR_DIE,
  CORRUPTION_TRACK_SIZE,
  CORRUPTION_TRACKER_KEY,
  corruptionOf,
  corruptionStateSchema,
  INITIAL_CORRUPTION,
  isRemnant,
  repairCorruption,
  replaceLostCompanion,
  setRemnant,
  type CorruptionState,
} from "../src/lib/domain/rest/frame-hooks/index";
import { appError, RuleError } from "../src/lib/errors/app-error";
import {
  addIngredient as addIngredientTo,
  beastFeastStateSchema,
  cookbookEntryInputSchema,
  cookbookStateSchema,
  ingredientCapacity,
  ingredientInputSchema,
  INITIAL_BEAST_FEAST,
  INITIAL_COOKBOOK,
  removeIngredient as removeIngredientFrom,
  type BeastFeastState,
} from "../src/lib/frames/extras/beast-feast";
import { beastformStateSchema, INITIAL_BEASTFORM, validateBeastform, type BeastformState } from "../src/lib/frames/extras/beastform";
import { castleHighStateSchema, INITIAL_CASTLE_HIGH, type CastleHighState } from "../src/lib/frames/extras/castle-high";
import { BEASTBOUND_SUBCLASS_ID, COOKBOOK_KEY, extraKey, extrasFor, FRAME_OF, type Extra } from "../src/lib/frames/extras/common";
import { companionStateSchema, INITIAL_COMPANION, validateCompanion, type CompanionState } from "../src/lib/frames/extras/companion";
import {
  addRelic as addRelicTo,
  applyGather,
  correctWallet as applyCorrection,
  craft,
  ikonisSchema,
  INITIAL_MOTHERBOARD,
  install,
  motherboardStateSchema,
  salvage,
  sellRelic as sellRelicFrom,
  trade,
  walletCorrectionSchema,
  type MotherboardState,
} from "../src/lib/frames/extras/motherboard";
import { resolveOptions } from "../src/lib/frames/options";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { parseOrCorrupt, readVersioned } from "./lib/blobs";
import { rollDie } from "./lib/dice";
import { keyedCampaignMutation, userMutation, userQuery } from "./lib/functions";
import { campaignScope, runOnce } from "./lib/operations";
import { atLeast, permissionFor, type Permission } from "./lib/permissions";
import { applyTrackerRule, frameTrackerMutation, loadTracker, readTracker, TRACKER_SCHEMA_VERSION, writeTracker, type FrameTracker } from "./lib/trackers";
import {
  beastformStateValidator,
  companionStateValidator,
  cookbookEntryInputValidator,
  extrasViewValidator,
  gatheredScrapValidator,
  ikonisValidator,
  ingredientInputValidator,
  skyshardValidator,
  walletCorrectionValidator,
  type CharacterExtraRow,
  type ExtrasView,
} from "./lib/validators/characterExtras";

/** The version every `characterExtras` row is written with (CD3); bumping it needs an upgrade step in `readRow`. */
const EXTRA_SCHEMA_VERSION = 1;

/** The sheet fields the extras depend on (the full sheet is read by convex/characters.ts). */
const sheetBasics = z.object({
  level: z.number().int().min(1).max(10),
  classId: z.string(),
  subclassId: z.string(),
  traits: z.record(z.string(), z.number()),
});
type SheetBasics = z.infer<typeof sheetBasics>;
const slotBonus = z.object({ hopeSlotBonus: z.number().int().min(0).max(1).default(0) });

type Loaded = {
  user: Doc<"users">;
  campaign: Doc<"campaigns">;
  character: Doc<"characters">;
  permission: Permission;
  sheet: SheetBasics;
};

/**
 * A character's extras share the character's access (`permissionFor` on the
 * character): everyone in the campaign views them; the GM, the owner and
 * anyone with an edit grant on the character edit them.
 */
async function load(ctx: QueryCtx, user: Doc<"users">, characterId: Id<"characters">, need: Permission, enough: Permission = need): Promise<Loaded> {
  const { campaign, character, permission } = await loadCharacter(ctx, user, characterId, need, enough);
  return { user, campaign, character, permission, sheet: parseOrCorrupt(sheetBasics, character.sheet, "CHARACTER_CORRUPT") };
}

const SCHEMAS = {
  beastform: { schema: beastformStateSchema, initial: INITIAL_BEASTFORM },
  companion: { schema: companionStateSchema, initial: INITIAL_COMPANION },
  motherboard: { schema: motherboardStateSchema, initial: INITIAL_MOTHERBOARD },
  beastFeast: { schema: beastFeastStateSchema, initial: INITIAL_BEAST_FEAST },
  castleHigh: { schema: castleHighStateSchema, initial: INITIAL_CASTLE_HIGH },
} as const;
type StateOf = {
  beastform: BeastformState;
  companion: CompanionState;
  motherboard: MotherboardState;
  beastFeast: BeastFeastState;
  castleHigh: CastleHighState;
};

/** A stored row's state, read through its version's schema (CD3). */
function readRow<E extends Extra>(extra: E, row: Doc<"characterExtras">): StateOf[E] {
  const versioned = { ...row.data, schemaVersion: row.schemaVersion };
  return readVersioned({ [EXTRA_SCHEMA_VERSION]: { schema: SCHEMAS[extra].schema } }, versioned, "TRACKER_CORRUPT") as StateOf[E];
}

/**
 * The extra's state: its row, else (until `migrations/characterExtras:moveFromTrackers`
 * has run on every deployment) its old `frameTrackers` row, else the initial state.
 */
async function readState<E extends Extra>(ctx: QueryCtx, loaded: Loaded, extra: E, row: Doc<"characterExtras"> | null): Promise<StateOf[E]> {
  if (row !== null) return readRow(extra, row);
  const legacy = await readTracker(ctx, loaded.campaign._id, extraKey(loaded.character._id, extra), SCHEMAS[extra].schema);
  return (legacy ?? SCHEMAS[extra].initial) as StateOf[E];
}

/**
 * A character's Motherboard module (Ikonis, augments, scrap): its row, else
 * its old `frameTrackers` row (until the migration has run), else null; null
 * outside Motherboard.
 */
export async function motherboardState(ctx: QueryCtx, campaign: Doc<"campaigns">, characterId: Id<"characters">): Promise<MotherboardState | null> {
  if (campaign.frameId !== FRAME_OF.motherboard) return null;
  const row = await extraRow(ctx, characterId, "motherboard");
  if (row !== null) return readRow("motherboard", row);
  return readTracker(ctx, campaign._id, extraKey(characterId, "motherboard"), motherboardStateSchema);
}

/**
 * The Ikonis augments a character has installed (Motherboard only, CB 301);
 * `[]` in other frames. `derivedDefense` adds Guard, Deny and Block.
 */
export async function installedAugments(ctx: QueryCtx, campaign: Doc<"campaigns">, characterId: Id<"characters">): Promise<string[]> {
  return (await motherboardState(ctx, campaign, characterId))?.installed ?? [];
}

/** Writes a new character's Motherboard module (`characters.create`). */
export async function seedMotherboard(ctx: MutationCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">, state: MotherboardState): Promise<void> {
  const stored = {
    campaignId,
    characterId,
    extra: "motherboard",
    schemaVersion: EXTRA_SCHEMA_VERSION,
    data: motherboardStateSchema.parse(state),
    updatedAt: Date.now(),
  } as CharacterExtraRow;
  await ctx.db.insert("characterExtras", stored);
}

/** The campaign's open rest (downtime), if any. */
function openRest(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("rests")
    .withIndex("by_campaign_status_started", (q) => q.eq("campaignId", campaignId).eq("status", "open"))
    .first();
}

/** The stored row of one extra (at most one per character and extra). */
function extraRow(ctx: QueryCtx, characterId: Id<"characters">, extra: Extra) {
  return ctx.db
    .query("characterExtras")
    .withIndex("by_character_extra", (q) => q.eq("characterId", characterId).eq("extra", extra))
    .unique();
}

/**
 * Edit access and applicability (a frame extra outside its frame, or a class
 * extra on another class, is `MECHANIC_DISABLED`), then one idempotent change
 * of the extra's state. The domain's plain `Error`s become `EXTRA_RULE`.
 */
async function change<E extends Extra, R>(
  ctx: MutationCtx & { user: Doc<"users"> },
  characterId: Id<"characters">,
  extra: E,
  op: { idempotencyKey: string; kind: string; request: object },
  apply: (state: StateOf[E], loaded: Loaded) => { state: StateOf[E]; result: R } | Promise<{ state: StateOf[E]; result: R }>,
): Promise<R> {
  const loaded = await load(ctx, ctx.user, characterId, "edit");
  if (!extrasFor(loaded.campaign.frameId, loaded.sheet)[extra]) throw appError("MECHANIC_DISABLED");
  const campaignId = loaded.campaign._id;
  return runOnce(
    ctx,
    {
      scopeKey: campaignScope(campaignId),
      key: op.idempotencyKey,
      kind: op.kind,
      request: { characterId, ...op.request },
      createdBy: ctx.user._id,
      campaignId,
    },
    async () => {
      const row = await extraRow(ctx, characterId, extra);
      const next = await applyTrackerRule("EXTRA_RULE", async () => apply(await readState(ctx, loaded, extra, row), loaded));
      await storeExtra(ctx, loaded, extra, row, next.state);
      return next.result;
    },
  );
}

/** Writes one extra's state to its row (inserting it the first time). */
async function storeExtra<E extends Extra>(ctx: MutationCtx, loaded: Loaded, extra: E, row: Doc<"characterExtras"> | null, state: StateOf[E]): Promise<void> {
  // The schema matches the row's `data` validator for this `extra`.
  const stored = {
    campaignId: loaded.campaign._id,
    characterId: loaded.character._id,
    extra,
    schemaVersion: EXTRA_SCHEMA_VERSION,
    data: SCHEMAS[extra].schema.parse(state),
    updatedAt: Date.now(),
  } as CharacterExtraRow;
  if (row === null) await ctx.db.insert("characterExtras", stored);
  else await ctx.db.replace("characterExtras", row._id, stored);
}

/** The party's shared Beast Feast cookbook: a campaign-level frame tracker. */
const COOKBOOK: FrameTracker<typeof cookbookStateSchema> = {
  frameId: FRAME_OF.beastFeast,
  key: COOKBOOK_KEY,
  schema: cookbookStateSchema,
  initial: () => INITIAL_COOKBOOK,
  ruleCode: "EXTRA_RULE",
};

/** A character's extras: only those that apply to their class and the campaign's frame. */
export const get = userQuery({
  args: { characterId: v.id("characters") },
  returns: extrasViewValidator,
  handler: async (ctx, { characterId }): Promise<ExtrasView> => {
    const loaded = await load(ctx, ctx.user, characterId, "view", "edit");
    const { campaign, sheet } = loaded;
    const applies = extrasFor(campaign.frameId, sheet);
    // At most one row per extra.
    const rows = await ctx.db
      .query("characterExtras")
      .withIndex("by_character_extra", (q) => q.eq("characterId", characterId))
      .collect();
    const read = async <E extends Extra>(extra: E): Promise<StateOf[E] | null> =>
      applies[extra] ? readState(ctx, loaded, extra, rows.find((r) => r.extra === extra) ?? null) : null;
    const cookbook = async () => {
      const book = await loadTracker(ctx, campaign._id, COOKBOOK);
      const gm = atLeast(await permissionFor(ctx, ctx.user, { type: "campaign", campaign }, "owner"), "owner");
      return book.entries.map((e) => ({ ...e, canRemove: gm || e.addedBy === ctx.user._id }));
    };
    return {
      canEdit: atLeast(loaded.permission, "edit"),
      level: sheet.level,
      tier: tierForLevel(sheet.level),
      ingredientCapacity: ingredientCapacity(sheet.traits),
      beastform: await read("beastform"),
      companion: await read("companion"),
      motherboard: await read("motherboard"),
      beastFeast: await read("beastFeast"),
      castleHigh: await read("castleHigh"),
      cookbook: applies.beastFeast ? await cookbook() : null,
    };
  },
});

const keyed = { characterId: v.id("characters"), idempotencyKey: v.string() };

// ---- Druid Beastform

/** Take a Beastform of your tier or lower, or drop out (`state.formId` null). */
export const setBeastform = userMutation({
  args: { ...keyed, state: beastformStateValidator },
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey, state }) => {
    const next = beastformStateSchema.parse(state);
    return change(ctx, characterId, "beastform", { idempotencyKey, kind: "extra_beastform", request: next }, (_, { sheet }) => {
      validateBeastform(next, tierForLevel(sheet.level));
      return { state: next, result: null };
    });
  },
});

// ---- Beastbound companion

/**
 * Saves the companion sheet. Light in the Dark ("Use this as an additional Hope
 * slot your character can mark", CB 40) sets the character's `hopeSlotBonus`,
 * so Hope max becomes 7 (dcm-bxp.14); untaking it cuts Hope to the slots left.
 */
export const saveCompanion = userMutation({
  args: { ...keyed, state: companionStateValidator },
  returns: v.null(),
  handler: async (ctx, { characterId, idempotencyKey, state }) => {
    const next = companionStateSchema.parse(state);
    await change(ctx, characterId, "companion", { idempotencyKey, kind: "extra_companion", request: next }, (_, { sheet }) => {
      validateCompanion(next, sheet.level);
      return { state: next, result: null };
    });
    // Derived from the saved state, so a replayed request writes the same values.
    const { character } = await loadCharacter(ctx, ctx.user, characterId, "edit");
    const hopeSlotBonus = (next.training.lightInTheDark ?? 0) > 0 ? 1 : 0;
    if (parseOrCorrupt(slotBonus, character.sheet, "CHARACTER_CORRUPT").hopeSlotBonus !== hopeSlotBonus) {
      const sheet = readSheet(character.sheet);
      await saveSheet(ctx, characterId, { ...sheet, hopeSlotBonus, hope: Math.min(sheet.hope, hopeMax(sheet.scars, hopeSlotBonus)) });
    }
    return null;
  },
});

// ---- Motherboard remnant companion: optional Corruption Track (CB 295)

/**
 * The Corruption Track applies to a Beastbound ranger in a Motherboard
 * campaign with the optional `remnantCorruption` rule on.
 */
function corruptionApplies({ campaign, sheet }: Loaded): boolean {
  return campaign.frameId === FRAME_OF.motherboard && sheet.subclassId === BEASTBOUND_SUBCLASS_ID && resolveOptions(campaign.frameId, campaign.options).remnantCorruption;
}

/**
 * One idempotent change of the campaign's `motherboard.corruption` tracker
 * for a ranger the caller has `need` on (`edit`: owner or GM; `owner`: GM).
 */
async function corruptionChange<R>(
  ctx: MutationCtx & { user: Doc<"users"> },
  characterId: Id<"characters">,
  need: Permission,
  op: { idempotencyKey: string; kind: string; request: object },
  apply: (state: CorruptionState, loaded: Loaded) => { state: CorruptionState; result: R } | Promise<{ state: CorruptionState; result: R }>,
): Promise<R> {
  const loaded = await load(ctx, ctx.user, characterId, need);
  if (!corruptionApplies(loaded)) throw appError("MECHANIC_DISABLED");
  const campaignId = loaded.campaign._id;
  return runOnce(
    ctx,
    { scopeKey: campaignScope(campaignId), key: op.idempotencyKey, kind: op.kind, request: { characterId, ...op.request }, createdBy: ctx.user._id, campaignId },
    async () => {
      const current = (await readTracker(ctx, campaignId, CORRUPTION_TRACKER_KEY, corruptionStateSchema)) ?? INITIAL_CORRUPTION;
      const next = await applyTrackerRule("EXTRA_RULE", () => apply(current, loaded));
      await writeTracker(ctx, campaignId, CORRUPTION_TRACKER_KEY, next.state, TRACKER_SCHEMA_VERSION);
      return next.result;
    },
  );
}

/** A ranger's Corruption Track, or null where it doesn't apply (another frame or subclass, or the optional rule off). */
export const corruption = userQuery({
  args: { characterId: v.id("characters") },
  returns: v.union(
    v.null(),
    v.object({
      trackSize: v.number(),
      marks: v.number(),
      remnant: v.boolean(),
      lost: v.boolean(),
      canEdit: v.boolean(),
      canRepair: v.boolean(),
      lastRoll: v.union(v.null(), v.object({ fearDie: v.number(), marked: v.boolean(), at: v.number() })),
    }),
  ),
  handler: async (ctx, { characterId }) => {
    const loaded = await load(ctx, ctx.user, characterId, "view", "owner");
    if (!corruptionApplies(loaded)) return null;
    const state = (await readTracker(ctx, loaded.campaign._id, CORRUPTION_TRACKER_KEY, corruptionStateSchema)) ?? INITIAL_CORRUPTION;
    const last = state.log.find((entry) => entry.characterId === characterId);
    return {
      trackSize: CORRUPTION_TRACK_SIZE,
      marks: corruptionOf(state, characterId),
      remnant: isRemnant(state, characterId),
      lost: companionLost(state, characterId),
      canEdit: atLeast(loaded.permission, "edit"),
      canRepair: atLeast(loaded.permission, "owner"),
      lastRoll: last ? { fearDie: last.fearDie, marked: last.marked, at: last.at } : null,
    };
  },
});

/** The owner or the GM marks the companion as a remnant (only remnants roll for Corruption), or unmarks it. */
export const setCompanionRemnant = userMutation({
  args: { ...keyed, remnant: v.boolean() },
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey, remnant }) =>
    corruptionChange(ctx, characterId, "edit", { idempotencyKey, kind: "extra_companion_remnant", request: { remnant } }, (state) => ({
      state: setRemnant(state, characterId, remnant),
      result: null,
    })),
});

/** GM only: a technomancer temporarily repairs the remnant, clearing 1d4 Corruption (CB 295). */
export const repairCompanion = userMutation({
  args: keyed,
  returns: v.object({ die: v.number(), cleared: v.number(), marks: v.number() }),
  handler: (ctx, { characterId, idempotencyKey }) =>
    corruptionChange(ctx, characterId, "owner", { idempotencyKey, kind: "extra_companion_repair", request: {} }, (state) => {
      const die = rollDie(CORRUPTION_REPAIR_DIE);
      const repaired = repairCorruption(state, characterId, die);
      return { state: repaired.state, result: { die, cleared: repaired.cleared, marks: repaired.total } };
    }),
});

/**
 * After the last Corruption is marked, the ranger takes a new companion "with
 * two new Experiences" and carries over the level-up options already chosen
 * (CB 295): clears the track, and resets the companion sheet except its
 * training. Owner or GM.
 */
export const replaceCompanion = userMutation({
  args: keyed,
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey }) =>
    corruptionChange(ctx, characterId, "edit", { idempotencyKey, kind: "extra_companion_replace", request: {} }, async (state, loaded) => {
      const next = replaceLostCompanion(state, characterId);
      const row = await extraRow(ctx, characterId, "companion");
      const old = await readState(ctx, loaded, "companion", row);
      await storeExtra(ctx, loaded, "companion", row, {
        ...INITIAL_COMPANION,
        training: old.training,
        vicious: old.vicious,
        bonusTraining: old.bonusTraining,
      });
      return { state: next, result: null };
    }),
});

// ---- Motherboard

const mb =<R>(
  ctx: MutationCtx & { user: Doc<"users"> },
  characterId: Id<"characters">,
  idempotencyKey: string,
  kind: string,
  request: object,
  apply: (s: MotherboardState, loaded: Loaded) => { state: MotherboardState; result: R } | Promise<{ state: MotherboardState; result: R }>,
) => change(ctx, characterId, "motherboard", { idempotencyKey, kind, request }, apply);

export const saveIkonis = userMutation({
  args: { ...keyed, ikonis: ikonisValidator },
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey, ikonis }) => {
    const next = ikonisSchema.parse(ikonis);
    return mb(ctx, characterId, idempotencyKey, "extra_ikonis", next, (s) => ({ state: { ...s, ikonis: next }, result: null }));
  },
});

const diceCount = z.number().int().min(0).max(10);
const scrapDiceSchema = z.object({ shards: diceCount, metals: diceCount, components: diceCount });

/** Gather scrap (p.302): the server rolls the dice the GM set for each category. */
export const gatherScrap = userMutation({
  args: { ...keyed, shards: v.number(), metals: v.number(), components: v.number() },
  returns: v.array(gatheredScrapValidator),
  handler: (ctx, { characterId, idempotencyKey, ...counts }) => {
    const parsed = scrapDiceSchema.parse(counts);
    if (parsed.shards + parsed.metals + parsed.components === 0) throw appError("INVALID", "Roll at least one die.");
    return mb(ctx, characterId, idempotencyKey, "extra_gather_scrap", parsed, (s) => {
      const gathered = rollScrap(parsed, rollDie);
      return { state: applyGather(s, gathered), result: gathered };
    });
  },
});

const quantumResult = v.object({ quantum: v.number() });

/** Buy or sell scrap at a scrap shack, at its value (p.303). */
export const tradeScrap = userMutation({
  args: { ...keyed, name: v.string(), quantity: v.number(), direction: v.union(v.literal("buy"), v.literal("sell")) },
  returns: quantumResult,
  handler: (ctx, { characterId, idempotencyKey, name, quantity, direction }) =>
    mb(ctx, characterId, idempotencyKey, "extra_trade_scrap", { name, quantity, direction }, (s) => {
      const state = trade(s, name, quantity, direction);
      return { state, result: { quantum: state.quantum } };
    }),
});

export const addRelic = userMutation({
  args: { ...keyed, name: v.string() },
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey, name }) => {
    const relicName = z.string().trim().min(1, "Name the relic.").max(80).parse(name);
    return mb(ctx, characterId, idempotencyKey, "extra_add_relic", { name: relicName }, (s) => ({
      state: addRelicTo(s, { id: idempotencyKey.slice(0, 100), name: relicName }),
      result: null,
    }));
  },
});

export const sellRelic = userMutation({
  args: { ...keyed, relicId: v.string() },
  returns: quantumResult,
  handler: (ctx, { characterId, idempotencyKey, relicId }) =>
    mb(ctx, characterId, idempotencyKey, "extra_sell_relic", { relicId }, (s) => {
      const state = sellRelicFrom(s, relicId);
      return { state, result: { quantum: state.quantum } };
    }),
});

export const craftAugment = userMutation({
  args: { ...keyed, augmentId: v.string() },
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey, augmentId }) =>
    mb(ctx, characterId, idempotencyKey, "extra_craft_augment", { augmentId }, (s, { sheet }) => ({
      state: craft(s, augmentId, tierForLevel(sheet.level)),
      result: null,
    })),
});

export const salvageAugment = userMutation({
  args: { ...keyed, augmentId: v.string() },
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey, augmentId }) =>
    mb(ctx, characterId, idempotencyKey, "extra_salvage_augment", { augmentId }, (s) => ({ state: salvage(s, augmentId), result: null })),
});

/** Install or swap augments: only while the campaign has an open rest (CB 301, "during downtime"). */
export const installAugments = userMutation({
  args: { ...keyed, augmentIds: v.array(v.string()) },
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey, augmentIds }) =>
    mb(ctx, characterId, idempotencyKey, "extra_install_augments", { augmentIds }, async (s, { campaign, sheet }) => {
      if ((await openRest(ctx, campaign._id)) === null) throw new RuleError("EXTRA_RULE", SWAP_NEEDS_DOWNTIME);
      return { state: install(s, augmentIds, tierForLevel(sheet.level)), result: null };
    }),
});

/** Whether the campaign is in downtime (an open rest), when augments may be swapped (CB 301). */
export const augmentSwapOpen = userQuery({
  args: { characterId: v.id("characters") },
  returns: v.boolean(),
  handler: async (ctx, { characterId }) => {
    const { campaign } = await load(ctx, ctx.user, characterId, "view");
    return (await openRest(ctx, campaign._id)) !== null;
  },
});

/** Manual corrections of quantum and scrap counts. */
export const correctWallet = userMutation({
  args: { ...keyed, correction: walletCorrectionValidator },
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey, correction }) => {
    const parsed = walletCorrectionSchema.parse(correction);
    return mb(ctx, characterId, idempotencyKey, "extra_correct_wallet", parsed, (s) => ({ state: applyCorrection(s, parsed), result: null }));
  },
});

// ---- Beast Feast

export const addIngredient = userMutation({
  args: { ...keyed, ingredient: ingredientInputValidator },
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey, ingredient }) => {
    const parsed = ingredientInputSchema.parse(ingredient);
    return change(ctx, characterId, "beastFeast", { idempotencyKey, kind: "extra_add_ingredient", request: parsed }, (s, { sheet }) => ({
      state: addIngredientTo(s, { ...parsed, id: idempotencyKey.slice(0, 100) }, ingredientCapacity(sheet.traits)),
      result: null,
    }));
  },
});

export const removeIngredient = userMutation({
  args: { ...keyed, ingredientId: v.string() },
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey, ingredientId }) =>
    change(ctx, characterId, "beastFeast", { idempotencyKey, kind: "extra_remove_ingredient", request: { ingredientId } }, (s) => ({
      state: removeIngredientFrom(s, ingredientId),
      result: null,
    })),
});

/** Any member of a Beast Feast campaign adds recipes to the party cookbook. */
export const addCookbookEntry = keyedCampaignMutation({
  need: "view",
  args: { entry: cookbookEntryInputValidator },
  returns: v.null(),
  handler: (ctx, { entry }) => {
    const parsed = cookbookEntryInputSchema.parse(entry);
    return frameTrackerMutation(ctx, COOKBOOK, { kind: "extra_cookbook_add", request: parsed }, (book) => ({
      state: cookbookStateSchema.parse({ entries: [...book.entries, { ...parsed, id: crypto.randomUUID(), addedBy: ctx.user._id, at: Date.now() }] }),
      result: null,
    }));
  },
});

/** The recipe's author or the GM removes it. */
export const removeCookbookEntry = keyedCampaignMutation({
  need: "view",
  enough: "owner",
  args: { entryId: v.string() },
  returns: v.null(),
  handler: (ctx, { entryId }) =>
    frameTrackerMutation(ctx, COOKBOOK, { kind: "extra_cookbook_remove", request: { entryId } }, (book) => {
      const entry = book.entries.find((e) => e.id === entryId);
      if (!entry) throw new RuleError("EXTRA_RULE", "That recipe is gone.");
      if (ctx.permission !== "owner" && entry.addedBy !== ctx.user._id) throw appError("FORBIDDEN");
      return { state: { entries: book.entries.filter((e) => e.id !== entryId) }, result: null };
    }),
});

// ---- Castle High

export const saveSkyshard = userMutation({
  args: { ...keyed, skyshard: skyshardValidator },
  returns: v.null(),
  handler: (ctx, { characterId, idempotencyKey, skyshard }) => {
    const next = castleHighStateSchema.parse({ skyshard });
    return change(ctx, characterId, "castleHigh", { idempotencyKey, kind: "extra_skyshard", request: next }, () => ({ state: next, result: null }));
  },
});
