import { ConvexError, v } from "convex/values";
import { z } from "zod";

import { tierForLevel } from "../src/lib/domain/characters/index";
import { gatherScrap as rollScrap, type GatheredScrap } from "../src/lib/domain/frames/motherboard";
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
  type CookbookState,
} from "../src/lib/frames/extras/beast-feast";
import { beastformStateSchema, INITIAL_BEASTFORM, validateBeastform, type BeastformState } from "../src/lib/frames/extras/beastform";
import { castleHighStateSchema, INITIAL_CASTLE_HIGH, type CastleHighState } from "../src/lib/frames/extras/castle-high";
import { COOKBOOK_KEY, extraKey, extrasFor, FRAME_OF, type Extra } from "../src/lib/frames/extras/common";
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
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { loadCampaign, type Role } from "./lib/access";
import { requireUser } from "./lib/auth";
import { rollDie } from "./lib/dice";
import { ruleError } from "./lib/mechanics";
import { campaignScope, withIdempotency } from "./lib/operations";
import { readTracker, writeTracker } from "./lib/trackers";

/** The sheet fields the extras depend on (the full sheet is validated by convex/characters.ts). */
const sheetBasics = z.object({
  level: z.number().int().min(1).max(10),
  classId: z.string(),
  subclassId: z.string(),
  traits: z.record(z.string(), z.number()),
});
type SheetBasics = z.infer<typeof sheetBasics>;

type Loaded = {
  user: Doc<"users">;
  campaign: Doc<"campaigns">;
  role: Role;
  character: Doc<"characters">;
  sheet: SheetBasics;
  canEdit: boolean;
};

/** Everyone in the campaign reads a character's extras; the owner or the GM edits them. */
async function load(ctx: QueryCtx, characterId: Id<"characters">, edit = false): Promise<Loaded> {
  const user = await requireUser(ctx);
  const character = await ctx.db.get(characterId);
  if (character === null) throw new ConvexError("NOT_FOUND");
  const { campaign, role } = await loadCampaign(ctx, user, character.campaignId);
  const parsed = sheetBasics.safeParse(character.sheet);
  if (!parsed.success) throw new ConvexError("CHARACTER_CORRUPT");
  const canEdit = role === "gm" || character.ownerId === user._id;
  if (edit && !canEdit) throw new ConvexError("FORBIDDEN");
  return { user, campaign, role, character, sheet: parsed.data, canEdit };
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

function parseState<E extends Extra>(extra: E, raw: unknown): StateOf[E] {
  if (raw === null) return SCHEMAS[extra].initial as StateOf[E];
  const parsed = SCHEMAS[extra].schema.safeParse(raw);
  if (!parsed.success) throw new ConvexError("TRACKER_CORRUPT");
  return parsed.data as StateOf[E];
}

async function readCookbook(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<CookbookState> {
  return parseCookbook(await readTracker(ctx, campaignId, COOKBOOK_KEY));
}

function parseCookbook(raw: unknown): CookbookState {
  if (raw === null) return INITIAL_COOKBOOK;
  const parsed = cookbookStateSchema.safeParse(raw);
  if (!parsed.success) throw new ConvexError("TRACKER_CORRUPT");
  return parsed.data;
}

function input<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ConvexError({ code: "INVALID", message: parsed.error.issues[0]?.message ?? "Invalid input." });
  return parsed.data;
}

/** A frame extra outside its frame, or a class extra on another class, is refused. */
function assertApplies(loaded: Loaded, extra: Extra) {
  if (!extrasFor(loaded.campaign.frameId, loaded.sheet)[extra]) throw new ConvexError("MECHANIC_DISABLED");
}

/** Edit access + applicability, then one idempotent change of the extra's state. */
async function change<E extends Extra, R>(
  ctx: MutationCtx,
  characterId: Id<"characters">,
  extra: E,
  op: { idempotencyKey: string; kind: string; request: unknown },
  apply: (state: StateOf[E], loaded: Loaded) => { state: StateOf[E]; result: R },
): Promise<R> {
  const loaded = await load(ctx, characterId, true);
  assertApplies(loaded, extra);
  const campaignId = loaded.campaign._id;
  return withIdempotency(
    ctx,
    {
      scopeKey: campaignScope(campaignId),
      key: op.idempotencyKey,
      kind: op.kind,
      request: { characterId, ...(op.request as object) },
      createdBy: loaded.user._id,
      campaignId,
    },
    async () => {
      const key = extraKey(characterId, extra);
      const current = parseState(extra, await readTracker(ctx, campaignId, key));
      let next: { state: StateOf[E]; result: R };
      try {
        next = apply(current, loaded);
      } catch (error) {
        ruleError("EXTRA_RULE", error);
      }
      await writeTracker(ctx, campaignId, key, SCHEMAS[extra].schema.parse(next.state));
      return next.result;
    },
  );
}

/** A character's extras: only those that apply to their class and the campaign's frame. */
export const get = query({
  args: { characterId: v.id("characters") },
  handler: async (ctx, { characterId }) => {
    const loaded = await load(ctx, characterId);
    const { campaign, sheet } = loaded;
    const applies = extrasFor(campaign.frameId, sheet);
    const read = async <E extends Extra>(extra: E): Promise<StateOf[E] | null> =>
      applies[extra] ? parseState(extra, await readTracker(ctx, campaign._id, extraKey(characterId, extra))) : null;
    return {
      canEdit: loaded.canEdit,
      level: sheet.level,
      tier: tierForLevel(sheet.level),
      ingredientCapacity: ingredientCapacity(sheet.traits),
      beastform: await read("beastform"),
      companion: await read("companion"),
      motherboard: await read("motherboard"),
      beastFeast: await read("beastFeast"),
      castleHigh: await read("castleHigh"),
      cookbook: applies.beastFeast
        ? (await readCookbook(ctx, campaign._id)).entries.map((e) => ({ ...e, canRemove: loaded.role === "gm" || e.addedBy === loaded.user._id }))
        : null,
    };
  },
});

const keyed = { characterId: v.id("characters"), idempotencyKey: v.string() };

// ---- Druid Beastform

/** Take a Beastform of your tier or lower, or drop out (`state.formId` null). */
export const setBeastform = mutation({
  args: { ...keyed, state: v.any() },
  handler: (ctx, { characterId, idempotencyKey, state }) => {
    const next = input(beastformStateSchema, state);
    return change(ctx, characterId, "beastform", { idempotencyKey, kind: "extra_beastform", request: next }, (_, { sheet }) => {
      validateBeastform(next, tierForLevel(sheet.level));
      return { state: next, result: null };
    });
  },
});

// ---- Beastbound companion

export const saveCompanion = mutation({
  args: { ...keyed, state: v.any() },
  handler: (ctx, { characterId, idempotencyKey, state }) => {
    const next = input(companionStateSchema, state);
    return change(ctx, characterId, "companion", { idempotencyKey, kind: "extra_companion", request: next }, (_, { sheet }) => {
      validateCompanion(next, sheet.level);
      return { state: next, result: null };
    });
  },
});

// ---- Motherboard

const mb = <R>(
  ctx: MutationCtx,
  characterId: Id<"characters">,
  idempotencyKey: string,
  kind: string,
  request: unknown,
  apply: (s: MotherboardState, loaded: Loaded) => { state: MotherboardState; result: R },
) => change(ctx, characterId, "motherboard", { idempotencyKey, kind, request }, apply);

export const saveIkonis = mutation({
  args: { ...keyed, ikonis: v.any() },
  handler: (ctx, { characterId, idempotencyKey, ikonis }) => {
    const next = input(ikonisSchema, ikonis);
    return mb(ctx, characterId, idempotencyKey, "extra_ikonis", next, (s) => ({ state: { ...s, ikonis: next }, result: null }));
  },
});

const diceCount = v.number();

/** Gather scrap (p.302): the server rolls the dice the GM set for each category. */
export const gatherScrap = mutation({
  args: { ...keyed, shards: diceCount, metals: diceCount, components: diceCount },
  handler: (ctx, { characterId, idempotencyKey, ...counts }): Promise<GatheredScrap[]> => {
    const parsed = input(
      z.object({ shards: z.number().int().min(0).max(10), metals: z.number().int().min(0).max(10), components: z.number().int().min(0).max(10) }),
      counts,
    );
    if (parsed.shards + parsed.metals + parsed.components === 0) throw new ConvexError({ code: "INVALID", message: "Roll at least one die." });
    return mb(ctx, characterId, idempotencyKey, "extra_gather_scrap", parsed, (s) => {
      const gathered = rollScrap(parsed, rollDie);
      return { state: applyGather(s, gathered), result: gathered };
    });
  },
});

/** Buy or sell scrap at a scrap shack, at its value (p.303). */
export const tradeScrap = mutation({
  args: { ...keyed, name: v.string(), quantity: v.number(), direction: v.union(v.literal("buy"), v.literal("sell")) },
  handler: (ctx, { characterId, idempotencyKey, name, quantity, direction }) =>
    mb(ctx, characterId, idempotencyKey, "extra_trade_scrap", { name, quantity, direction }, (s) => {
      const state = trade(s, name, quantity, direction);
      return { state, result: { quantum: state.quantum } };
    }),
});

export const addRelic = mutation({
  args: { ...keyed, name: v.string() },
  handler: (ctx, { characterId, idempotencyKey, name }) => {
    const relicName = input(z.string().trim().min(1, "Name the relic.").max(80), name);
    return mb(ctx, characterId, idempotencyKey, "extra_add_relic", { name: relicName }, (s) => ({
      state: addRelicTo(s, { id: idempotencyKey.slice(0, 100), name: relicName }),
      result: null,
    }));
  },
});

export const sellRelic = mutation({
  args: { ...keyed, relicId: v.string() },
  handler: (ctx, { characterId, idempotencyKey, relicId }) =>
    mb(ctx, characterId, idempotencyKey, "extra_sell_relic", { relicId }, (s) => {
      const state = sellRelicFrom(s, relicId);
      return { state, result: { quantum: state.quantum } };
    }),
});

export const craftAugment = mutation({
  args: { ...keyed, augmentId: v.string() },
  handler: (ctx, { characterId, idempotencyKey, augmentId }) =>
    mb(ctx, characterId, idempotencyKey, "extra_craft_augment", { augmentId }, (s, { sheet }) => ({
      state: craft(s, augmentId, tierForLevel(sheet.level)),
      result: null,
    })),
});

export const salvageAugment = mutation({
  args: { ...keyed, augmentId: v.string() },
  handler: (ctx, { characterId, idempotencyKey, augmentId }) =>
    mb(ctx, characterId, idempotencyKey, "extra_salvage_augment", { augmentId }, (s) => ({ state: salvage(s, augmentId), result: null })),
});

export const installAugments = mutation({
  args: { ...keyed, augmentIds: v.array(v.string()) },
  handler: (ctx, { characterId, idempotencyKey, augmentIds }) =>
    mb(ctx, characterId, idempotencyKey, "extra_install_augments", { augmentIds }, (s, { sheet }) => ({
      state: install(s, augmentIds, tierForLevel(sheet.level)),
      result: null,
    })),
});

/** Manual corrections of quantum and scrap counts. */
export const correctWallet = mutation({
  args: { ...keyed, correction: v.any() },
  handler: (ctx, { characterId, idempotencyKey, correction }) => {
    const parsed = input(walletCorrectionSchema, correction);
    return mb(ctx, characterId, idempotencyKey, "extra_correct_wallet", parsed, (s) => ({ state: applyCorrection(s, parsed), result: null }));
  },
});

// ---- Beast Feast

export const addIngredient = mutation({
  args: { ...keyed, ingredient: v.any() },
  handler: (ctx, { characterId, idempotencyKey, ingredient }) => {
    const parsed = input(ingredientInputSchema, ingredient);
    return change(ctx, characterId, "beastFeast", { idempotencyKey, kind: "extra_add_ingredient", request: parsed }, (s, { sheet }) => ({
      state: addIngredientTo(s, { ...parsed, id: idempotencyKey.slice(0, 100) }, ingredientCapacity(sheet.traits)),
      result: null,
    }));
  },
});

export const removeIngredient = mutation({
  args: { ...keyed, ingredientId: v.string() },
  handler: (ctx, { characterId, idempotencyKey, ingredientId }) =>
    change(ctx, characterId, "beastFeast", { idempotencyKey, kind: "extra_remove_ingredient", request: { ingredientId } }, (s) => ({
      state: removeIngredientFrom(s, ingredientId),
      result: null,
    })),
});

/** Any member of a Beast Feast campaign adds recipes to the party cookbook. */
export const addCookbookEntry = mutation({
  args: { campaignId: v.id("campaigns"), entry: v.any(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, entry, idempotencyKey }) => {
    const user = await requireUser(ctx);
    const { campaign } = await loadCampaign(ctx, user, campaignId);
    if (campaign.frameId !== FRAME_OF.beastFeast) throw new ConvexError("MECHANIC_DISABLED");
    const parsed = input(cookbookEntryInputSchema, entry);
    return withIdempotency(
      ctx,
      { scopeKey: campaignScope(campaignId), key: idempotencyKey, kind: "extra_cookbook_add", request: parsed, createdBy: user._id, campaignId },
      async () => {
        const book = await readCookbook(ctx, campaignId);
        const next = { entries: [...book.entries, { ...parsed, id: idempotencyKey.slice(0, 100), addedBy: user._id, at: Date.now() }] };
        await writeTracker(ctx, campaignId, COOKBOOK_KEY, cookbookStateSchema.parse(next));
        return null;
      },
    );
  },
});

/** The recipe's author or the GM removes it. */
export const removeCookbookEntry = mutation({
  args: { campaignId: v.id("campaigns"), entryId: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, entryId, idempotencyKey }) => {
    const user = await requireUser(ctx);
    const { campaign, role } = await loadCampaign(ctx, user, campaignId);
    if (campaign.frameId !== FRAME_OF.beastFeast) throw new ConvexError("MECHANIC_DISABLED");
    return withIdempotency(
      ctx,
      { scopeKey: campaignScope(campaignId), key: idempotencyKey, kind: "extra_cookbook_remove", request: { entryId }, createdBy: user._id, campaignId },
      async () => {
        const book = await readCookbook(ctx, campaignId);
        const entry = book.entries.find((e) => e.id === entryId);
        if (!entry) throw new ConvexError({ code: "EXTRA_RULE", message: "That recipe is gone." });
        if (role !== "gm" && entry.addedBy !== user._id) throw new ConvexError("FORBIDDEN");
        await writeTracker(ctx, campaignId, COOKBOOK_KEY, { entries: book.entries.filter((e) => e.id !== entryId) });
        return null;
      },
    );
  },
});

// ---- Castle High

export const saveSkyshard = mutation({
  args: { ...keyed, skyshard: v.any() },
  handler: (ctx, { characterId, idempotencyKey, skyshard }) => {
    const next = input(castleHighStateSchema, { skyshard });
    return change(ctx, characterId, "castleHigh", { idempotencyKey, kind: "extra_skyshard", request: next }, () => ({ state: next, result: null }));
  },
});
