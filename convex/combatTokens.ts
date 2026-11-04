import { v } from "convex/values";

import { freeSquares, moveToken, snapTurn, startFace, startSide } from "../src/components/combat-map/tokens/geometry";
import { rasterize, type TerrainId } from "../src/lib/combat-map/raster";
import { checkMove } from "../src/lib/domain/combat-map/movement";
import { rangeCheck } from "../src/lib/domain/combat-actions/distance";
import { appError } from "../src/lib/errors/app-error";
import { applyCondition } from "../src/lib/domain/encounters/damage";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { areasAfterMove, carryAlong, endAreasOnCasterEvent, endAreasOwnerLeft, moveRules, rangeTriggersAfterMove } from "./combatAreas";
import { partyOf, readSheet } from "./lib/characterSheet";
import {
  MAX_TOKEN_NAME,
  MAX_TOKEN_SIZE,
  MIN_TOKEN_SIZE,
  assertCanAddTokens,
  loadCombatMap,
  loadCombatToken,
  tokensOnMap,
} from "./lib/combatMaps";
import { movementGrid, uncloakAfterMove } from "./lib/combatMovement";
import { MAX_INSTANCES, startEncounter } from "./lib/encounters";
import { pcPortrait } from "./lib/pcPortrait";
import { tokenViewValidator, type TokenView } from "./lib/validators/combatTokens";
import { campaignMutation, gmMutation, keyedGmMutation } from "./lib/functions";
import { atLeast, permissionFor } from "./lib/permissions";
import { currentSessionEncounter, playCurrentScene } from "./lib/sessions";
import { tokenSideValidator } from "./lib/validators/combatMaps";
import { encounterConditionValidator } from "./lib/validators/encounters";
import { adversaryType, instancesOf, placedInstances, runningEncounter, type CampaignCtx } from "./lib/combatTokenViews";

/**
 * Tokens on a combat map (D9 C6, plan `.omc/plans/d9-combat-map.yaml`; R3, R4, R5, Q6). The GM places the party,
 * the running D8 encounter's adversaries and custom tokens, and changes their side and size; everyone moves and
 * turns the tokens they may (the GM any, a player only their own PC's: COMBAT_NOT_YOUR_TOKEN otherwise, R4).
 *
 * One source of truth for stats (R4): a PC token reads its character sheet and an adversary token its
 * `encounterAdversaries` row; the client writes them through the existing character and encounter-tracker
 * mutations. Only custom tokens keep their own numbers, changed here.
 *
 * D10 S8 (plan `.omc/plans/d10-sessions.yaml`, B11, Q2): `sessionEncounter` and `placeSessionEncounter` put the live
 * (else the newest planned) session's linked encounter on the map with one click ("＋ Session encounter").
 *
 * Reads (`combatTokensReads.ts` since dcm-uh6r, so they load without the movement and area engines): the GM's `list`
 * returns every token with its stats. Players get `party`: the PC tokens only (their own and the other PCs', Q4), never
 * an adversary, ally or neutral token, until C7's filtered `playerView`.
 */

/** The highest Hit Points or Stress a custom token can have. */
const MAX_CUSTOM_TRACK = 99;
/** Most tokens one "Place all" puts down (the tracker's own cap). */
const MAX_PLACE = MAX_INSTANCES;

// ---------------------------------------------------------------- validators

export { pcPortrait };

export { tokenViewValidator, type TokenView };

/** Sides the GM picks for a custom token (the party side belongs to PCs). */
const customSideValidator = v.union(v.literal("enemy"), v.literal("ally"), v.literal("neutral"));

// ---------------------------------------------------------------- helpers

function invalid(message: string): never {
  throw appError("INVALID", message);
}

function assertWhole(value: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < min || value > max) invalid(`${what} must be a whole number from ${min} to ${max}.`);
}

function tokenName(raw: string): string {
  const name = raw.trim();
  if (name === "") invalid("Give the token a name.");
  if (name.length > MAX_TOKEN_NAME) invalid(`A token name can be at most ${MAX_TOKEN_NAME} characters.`);
  return name;
}

/** Squares new tokens may stand on: not wall, void, deep water or lava (the board's `walkable`); any square on an image. */
function walkableOn(map: Doc<"combatMaps">): ((x: number, y: number) => boolean) | undefined {
  if (map.source === "image") return undefined;
  const grid = rasterize({ w: map.w, h: map.h, base: map.base, areas: map.areas, plankV: map.plankV });
  const blocked = new Set<TerrainId>(["wall", "void", "deep", "lava"]);
  return (x, y) => {
    const t = grid[y]?.[x];
    return t !== undefined && !blocked.has(t);
  };
}

type NewToken = Omit<Doc<"combatTokens">, "_id" | "_creationTime" | "x" | "y" | "face" | "light" | "revealedTo" | "campaignId" | "mapId">;

/** Inserts tokens on free squares (the board's `addTokens`): the party and allies on the left, the rest on the right. */
async function insertTokens(ctx: MutationCtx, map: Doc<"combatMaps">, existing: Doc<"combatTokens">[], tokens: NewToken[]): Promise<Id<"combatTokens">[]> {
  const taken = existing.map((t) => ({ x: t.x, y: t.y, size: t.size }));
  const walkable = walkableOn(map);
  const ids: Id<"combatTokens">[] = [];
  for (const token of tokens) {
    const [spot] = freeSquares(map, taken, startSide(token.side), 1, walkable, token.size);
    const at = spot ?? { x: 0, y: 0 };
    const x = Math.min(at.x, map.w - token.size);
    const y = Math.min(at.y, map.h - token.size);
    taken.push({ x, y, size: token.size });
    ids.push(
      await ctx.db.insert("combatTokens", {
        campaignId: map.campaignId,
        mapId: map._id,
        ...token,
        x,
        y,
        face: startFace(token.side),
        light: "none",
        revealedTo: [],
      }),
    );
  }
  return ids;
}

/** A custom token or INVALID. */
function customRef(token: Doc<"combatTokens">) {
  if (token.ref.kind !== "custom") invalid("Only a custom token keeps its own numbers; change this one on its sheet or in the tracker.");
  return token.ref;
}

/** A moved token's name for the feed (an area it entered, plan lanes E4). */
async function moverName(ctx: QueryCtx, token: Doc<"combatTokens">): Promise<string> {
  const { ref } = token;
  if (ref.kind === "custom") return ref.name;
  if (ref.kind === "adversary") return (await ctx.db.get("encounterAdversaries", ref.adversaryId))?.label ?? "An adversary";
  if (ref.kind === "companion") return "A companion";
  const character = await ctx.db.get("characters", ref.characterId);
  try {
    return character ? readSheet(character.sheet).name : "A character";
  } catch {
    return "A character";
  }
}

/**
 * The token and its map when the caller may move and turn it: the GM any token; anyone else only a PC token on the
 * live map whose character they can edit (permissionFor on the character, R4), else COMBAT_NOT_YOUR_TOKEN.
 */
async function movableToken(ctx: CampaignCtx<MutationCtx>, tokenId: string) {
  const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
  const map = await loadCombatMap(ctx, ctx.campaign._id, token.mapId);
  if (atLeast(ctx.permission, "owner")) return { token, map };
  // Players see only the live map (R2, Q1).
  if (!map.live) throw appError("COMBAT_MAP_NOT_FOUND");
  if (token.ref.kind !== "pc") throw appError("COMBAT_NOT_YOUR_TOKEN");
  const character = await ctx.db.get("characters", token.ref.characterId);
  if (character === null || character.campaignId !== ctx.campaign._id) throw appError("COMBAT_NOT_YOUR_TOKEN");
  const permission = await permissionFor(ctx, ctx.user, { type: "character", campaign: ctx.campaign, character }, "edit");
  if (!atLeast(permission, "edit")) throw appError("COMBAT_NOT_YOUR_TOKEN");
  return { token, map };
}

// ---------------------------------------------------------------- GM: placing tokens

/** Places every active character not yet on the map (the board's "＋ Party"); COMBAT_TOKEN_LIMIT past the cap. */
export const addParty = keyedGmMutation({
  args: { mapId: v.string() },
  returns: v.object({ added: v.number() }),
  handler: async (ctx, { mapId }) =>
    ctx.once("combat_add_party", { mapId }, async () => {
      const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
      const existing = await tokensOnMap(ctx, map._id);
      const placed = new Set(existing.flatMap((t) => (t.ref.kind === "pc" ? [t.ref.characterId] : [])));
      const party = (await partyOf(ctx, ctx.campaign._id)).filter((c) => c.status === "active" && !placed.has(c._id));
      if (party.length === 0) return { added: 0 };
      await assertCanAddTokens(ctx, map._id, party.length);
      await insertTokens(
        ctx,
        map,
        existing,
        party.map((c) => ({ ref: { kind: "pc" as const, characterId: c._id }, side: "pc" as const, size: 1 })),
      );
      return { added: party.length };
    }),
});

/**
 * Places instances of the running encounter (the board's "From the Adversaries tab" queue: one chip or "Place all").
 * Each id must be an instance of the campaign's running encounter (NOT_FOUND otherwise, ENCOUNTER_NOT_RUNNING
 * without one); instances already on the map are skipped. Solo adversaries take 2 × 2 squares.
 */
export const placeAdversaries = keyedGmMutation({
  args: { mapId: v.string(), instanceIds: v.array(v.string()) },
  returns: v.object({ added: v.number() }),
  handler: async (ctx, { mapId, instanceIds }) =>
    ctx.once("combat_place_adversaries", { mapId, instanceIds }, async () => {
      if (instanceIds.length === 0 || instanceIds.length > MAX_PLACE) invalid(`Place 1 to ${MAX_PLACE} adversaries at a time.`);
      const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
      const encounter = await runningEncounter(ctx, ctx.campaign._id);
      if (encounter === null) throw appError("ENCOUNTER_NOT_RUNNING");
      const existing = await tokensOnMap(ctx, map._id);
      const placed = new Set(existing.flatMap((t) => (t.ref.kind === "adversary" ? [t.ref.adversaryId] : [])));
      const adding: NewToken[] = [];
      for (const raw of new Set(instanceIds)) {
        const id = ctx.db.normalizeId("encounterAdversaries", raw);
        const instance = id === null ? null : await ctx.db.get("encounterAdversaries", id);
        if (instance === null || instance.campaignId !== ctx.campaign._id || instance.encounterId !== encounter._id) throw appError("NOT_FOUND");
        if (placed.has(instance._id)) continue;
        placed.add(instance._id);
        const solo = (await adversaryType(ctx, ctx.campaign._id, instance)) === "Solo";
        adding.push({ ref: { kind: "adversary", adversaryId: instance._id }, side: "enemy", size: solo ? 2 : 1 });
      }
      if (adding.length === 0) return { added: 0 };
      await assertCanAddTokens(ctx, map._id, adding.length);
      await insertTokens(ctx, map, existing, adding);
      return { added: adding.length };
    }),
});

/**
 * "＋ Session encounter" (B11, Q2 default a): the live (else newest planned) session's linked encounter is started
 * with D8's start rules when it is a draft or ended (ENCOUNTER_RUNNING, 'End the running encounter first', while
 * ANOTHER encounter runs), then every unplaced, undefeated instance is placed as `placeAdversaries` does (enemy side,
 * a Solo 2 × 2, COMBAT_TOKEN_LIMIT past the cap). SESSION_NO_ENCOUNTER without a linked encounter. One transaction:
 * a refusal writes nothing.
 */
export const placeSessionEncounter = keyedGmMutation({
  args: { mapId: v.string() },
  returns: v.object({ n: v.number(), added: v.number(), started: v.boolean() }),
  handler: async (ctx, { mapId }) =>
    ctx.once("combat_place_session_encounter", { mapId }, async () => {
      const campaignId = ctx.campaign._id;
      const map = await loadCombatMap(ctx, campaignId, mapId);
      const found = await currentSessionEncounter(ctx, campaignId);
      if (found === null) throw appError("SESSION_NO_ENCOUNTER");
      const { session, encounter } = found;
      const started = await startEncounter(ctx, campaignId, encounter, "End the running encounter first.");
      // Journal JD4 (Q7): the encounter's scene becomes Playing now, "Scene N began" logged while live.
      await playCurrentScene(ctx, found, ctx.user._id);
      const existing = await tokensOnMap(ctx, map._id);
      const placed = placedInstances(existing);
      const adding: NewToken[] = [];
      for (const instance of await instancesOf(ctx, encounter._id)) {
        if (instance.defeated || placed.has(instance._id)) continue;
        const solo = (await adversaryType(ctx, campaignId, instance)) === "Solo";
        adding.push({ ref: { kind: "adversary", adversaryId: instance._id }, side: "enemy", size: solo ? 2 : 1 });
      }
      if (adding.length > 0) {
        await assertCanAddTokens(ctx, map._id, adding.length);
        await insertTokens(ctx, map, existing, adding);
      }
      return { n: session.n, added: adding.length, started };
    }),
});

/** A custom token (the board's "Add a custom token"): name, Hit Points, side; it keeps its own numbers. */
export const addCustom = keyedGmMutation({
  args: { mapId: v.string(), name: v.string(), hp: v.number(), side: customSideValidator },
  returns: v.object({ tokenId: v.id("combatTokens") }),
  handler: async (ctx, { mapId, name, hp, side }) =>
    ctx.once("combat_add_custom", { mapId, name, hp, side }, async () => {
      const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
      const clean = tokenName(name);
      assertWhole(hp, 0, MAX_CUSTOM_TRACK, "Hit Points");
      await assertCanAddTokens(ctx, map._id);
      const [tokenId] = await insertTokens(ctx, map, await tokensOnMap(ctx, map._id), [
        { ref: { kind: "custom", name: clean, hp: 0, hpMax: hp, stress: 0, stressMax: 0, conditions: [] }, side, size: 1 },
      ]);
      return { tokenId: tokenId! };
    }),
});

// ---------------------------------------------------------------- GM: editing tokens

/** Renames a custom token (PCs and adversaries take their name from their sheet or the tracker). */
export const rename = gmMutation({
  args: { tokenId: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { tokenId, name }) => {
    const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
    const ref = customRef(token);
    await ctx.db.patch("combatTokens", token._id, { ref: { ...ref, name: tokenName(name) } });
    return null;
  },
});

/** The token's side (board colours). The party side is only for PC tokens (Q4 shows every party token to players). */
export const setSide = gmMutation({
  args: { tokenId: v.string(), side: tokenSideValidator },
  returns: v.null(),
  handler: async (ctx, { tokenId, side }) => {
    const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
    if (side === "pc" && token.ref.kind !== "pc") invalid("Only a character's token can be on the party's side.");
    await ctx.db.patch("combatTokens", token._id, { side });
    return null;
  },
});

/** The token's size in squares per side, 1 to 3; it stays inside the map. */
export const setSize = gmMutation({
  args: { tokenId: v.string(), size: v.number() },
  returns: v.null(),
  handler: async (ctx, { tokenId, size }) => {
    assertWhole(size, MIN_TOKEN_SIZE, MAX_TOKEN_SIZE, "A token's size");
    const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
    const map = await loadCombatMap(ctx, ctx.campaign._id, token.mapId);
    const x = Math.max(0, Math.min(token.x, map.w - size));
    const y = Math.max(0, Math.min(token.y, map.h - size));
    await ctx.db.patch("combatTokens", token._id, { size, x, y });
    return null;
  },
});

/** Marks (positive) or clears (negative) a custom token's Hit Points or Stress, kept within its track. */
export const markCustom = keyedGmMutation({
  args: { tokenId: v.string(), track: v.union(v.literal("hp"), v.literal("stress")), delta: v.number() },
  returns: v.object({ hp: v.number(), stress: v.number() }),
  handler: async (ctx, { tokenId, track, delta }) =>
    ctx.once("combat_mark_custom", { tokenId, track, delta }, async () => {
      assertWhole(delta, -MAX_CUSTOM_TRACK, MAX_CUSTOM_TRACK, "A change");
      const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
      const ref = customRef(token);
      const hp = track === "hp" ? Math.max(0, Math.min(ref.hpMax, ref.hp + delta)) : ref.hp;
      const stress = track === "stress" ? Math.max(0, Math.min(ref.stressMax, ref.stress + delta)) : ref.stress;
      await ctx.db.patch("combatTokens", token._id, { ref: { ...ref, hp, stress } });
      return { hp, stress };
    }),
});

/** Switches one of the tracker's conditions on a custom token (the same list as the encounter tracker, CB p.102). */
export const toggleCustomCondition = keyedGmMutation({
  args: { tokenId: v.string(), condition: encounterConditionValidator },
  returns: v.object({ conditions: v.array(encounterConditionValidator) }),
  handler: async (ctx, { tokenId, condition }) =>
    ctx.once("combat_custom_condition", { tokenId, condition }, async () => {
      const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
      const ref = customRef(token);
      const { conditions } = applyCondition(ref, condition);
      await ctx.db.patch("combatTokens", token._id, { ref: { ...ref, conditions } });
      return { conditions };
    }),
});

/** Takes one token off the map (its character or tracker row stays), with its duplicates (plan lanes-2 E4.3, dcm-v27). */
export const remove = gmMutation({
  args: { tokenId: v.string() },
  returns: v.null(),
  handler: async (ctx, { tokenId }) => {
    const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
    await ctx.db.delete("combatTokens", token._id);
    await removeDuplicates(ctx, token);
    // Plan lanes-2 E4.4 (dcm-ii4): a caster taken off the map has left their Circle of Power.
    if (token.ref.kind === "pc") await endAreasOwnerLeft(ctx, { campaignId: ctx.campaign._id, mapId: token.mapId, actorId: ctx.user._id });
    return null;
  },
});

// ---------------------------------------------------------------- plan lanes-2 E4.3: second positions (dcm-v27)

/** The duplicates of a token on its map (`duplicateOf`; at most MAX_COMBAT_TOKENS tokens read). */
export async function duplicatesOf(ctx: QueryCtx, token: Doc<"combatTokens">): Promise<Doc<"combatTokens">[]> {
  return (await tokensOnMap(ctx, token.mapId)).filter((t) => t.duplicateOf === token._id);
}

/** Deletes a token's duplicates (the creature's other positions go with it). */
export async function removeDuplicates(ctx: MutationCtx, token: Doc<"combatTokens">): Promise<number> {
  const list = await duplicatesOf(ctx, token);
  for (const d of list) await ctx.db.delete("combatTokens", d._id);
  return list.length;
}

/**
 * Writes a second position of a creature (Blink Beast, HF p.71: "a duplicate of itself appears ... within Close range";
 * E7's `summon.duplicate` calls it): a token with the original's `ref`, side and size on square (x, y), `duplicateOf` the
 * original. The square must be on the map and within `within` (default Close) of the original (COMBAT_TARGET_INVALID); a
 * duplicate of a duplicate names the original. The original's earlier duplicates go first (one second position at a time,
 * unless `keepOld`). COMBAT_TOKEN_LIMIT past the map's tokens.
 */
export async function placeDuplicate(
  ctx: MutationCtx,
  input: { original: Doc<"combatTokens">; x: number; y: number; within?: "melee" | "veryClose" | "close" | "far" | "veryFar"; keepOld?: boolean },
): Promise<Id<"combatTokens">> {
  const original = input.original.duplicateOf !== undefined ? ((await ctx.db.get("combatTokens", input.original.duplicateOf)) ?? input.original) : input.original;
  const map = await ctx.db.get("combatMaps", original.mapId);
  if (map === null) throw appError("COMBAT_MAP_NOT_FOUND");
  const at = { x: Math.trunc(input.x), y: Math.trunc(input.y), size: original.size };
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || at.x < 0 || at.y < 0 || at.x + at.size > map.w || at.y + at.size > map.h) throw appError("COMBAT_TARGET_INVALID", "That square is off the map.");
  if (!rangeCheck(original, at, input.within ?? "close").inRange) throw appError("COMBAT_TARGET_INVALID", `The duplicate must appear within ${input.within ?? "close"} range.`);
  if (input.keepOld !== true) await removeDuplicates(ctx, original);
  await assertCanAddTokens(ctx, map._id);
  const { _id: _ignored, _creationTime: _created, ...fields } = original;
  void _ignored;
  void _created;
  return ctx.db.insert("combatTokens", { ...fields, x: at.x, y: at.y, revealedTo: [], duplicateOf: original._id });
}

/** Takes every token off the map (the board's "Clear tokens", confirmed with a second click). */
export const clear = gmMutation({
  args: { mapId: v.string() },
  returns: v.object({ removed: v.number() }),
  handler: async (ctx, { mapId }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    const tokens = await tokensOnMap(ctx, map._id);
    for (const token of tokens) await ctx.db.delete("combatTokens", token._id);
    // Plan lanes-2 E4.4 (dcm-ii4): with every token gone, no caster stands in their circle.
    await endAreasOwnerLeft(ctx, { campaignId: ctx.campaign._id, mapId: map._id, actorId: ctx.user._id });
    return { removed: tokens.length };
  },
});

// ---------------------------------------------------------------- moving and turning (GM, or a player's own PC)

/**
 * Moves a token to square (x, y): whole squares, inside the map; it faces the way it moved (R5). The GM moves any
 * token; a player only their own PC's token on the live map (COMBAT_NOT_YOUR_TOKEN otherwise, R4).
 *
 * Movement (map-movement M0, D1-D4, D6): the token's footprint is checked along the straight line from where it stands
 * to (x, y). A player's move that crosses or ends on a blocking square (wall, building, closed door) is refused with
 * MOVE_BLOCKED, which carries no position; the GM's move always goes through and returns `blocked: true` so the map can
 * warn. `difficult`: the move crossed or ended on difficult terrain (a movement roll is needed to pass this turn, D5).
 * Players already receive the whole layout (`combatMaps.live`, Q1), so neither answer tells them anything new.
 *
 * Cloaked (DA3, DA18): a PC token that ends a move on the live map where a revealed enemy token sees it in clear light
 * loses Cloaked; in dim light only, the rogue makes one Finesse action roll against the highest Difficulty among those
 * enemies, and a failure ends it (`uncloakAfterMove`, public undoable feed rows); Vanishing Act's Cloaked stays. A dim
 * time phase counts as dim light. The GM's drag of a conscious rogue (not the GM's own character) is not the rogue's move:
 * no roll, Cloaked stays. An unconscious or dead rogue's token that moves drops Cloaked (dcm-bxp.99.19.62).
 */
export const move = campaignMutation({
  need: "view",
  enough: "owner",
  /** Plan lanes-2 E4 (dcm-lvgm, dcm-z5a6): tokens carried along (Wings of Light, Pin), each within Melee range of the mover. */
  args: { tokenId: v.string(), x: v.number(), y: v.number(), carry: v.optional(v.array(v.string())) },
  returns: v.object({
    x: v.number(),
    y: v.number(),
    face: v.number(),
    blocked: v.boolean(),
    difficult: v.boolean(),
    /** Plan lanes E4: the live areas the move entered, passed through, crossed or left that react to it (convex/combatAreas.ts). */
    areas: v.optional(v.array(v.object({ label: v.string(), event: v.union(v.literal("enter"), v.literal("through"), v.literal("leave"), v.literal("cross")), ended: v.boolean() }))),
    /** Plan lanes-2 E4: what the GM's drag broke (an area's hold, a movement limit); a player's move is refused instead. */
    warnings: v.optional(v.array(v.string())),
    /** Plan lanes-2 E4 (dcm-xobk): adversary `pcMoves` features the move set off (E7 runs them). */
    triggers: v.optional(v.array(v.object({ instanceId: v.id("encounterAdversaries"), feature: v.string(), useId: v.string(), stage: v.union(v.literal("would"), v.literal("did")) }))),
    /** Plan lanes-2 E4: where the carried tokens went. */
    carried: v.optional(v.array(v.object({ tokenId: v.id("combatTokens"), x: v.number(), y: v.number() }))),
  }),
  handler: async (ctx, { tokenId, x, y, carry }) => {
    const { token, map } = await movableToken(ctx, tokenId);
    const byGm = atLeast(ctx.permission, "owner");
    const next = moveToken(token, x, y, map);
    const stays = next.x === token.x && next.y === token.y;
    const { blocked, difficult } = stays
      ? { blocked: false, difficult: false }
      : checkMove(await movementGrid(ctx, ctx.campaign._id, map), token, next, token.size);
    if (blocked && !byGm) throw appError("MOVE_BLOCKED");
    let name: string | null = null;
    const nameOf = async () => (name ??= await moverName(ctx, token));
    // Plan lanes-2 E4: an area's hold (Bramble Patch), movement limits (Creeping Fire) and the adversaries' pcMoves features.
    const rules = stays ? { warnings: [], triggers: [] } : await moveRules(ctx, { campaignId: ctx.campaign._id, map, before: token, after: next, byGm, actorId: ctx.user._id, nameOf });
    await ctx.db.patch("combatTokens", token._id, next);
    const carried = carry === undefined || carry.length === 0 || stays ? [] : await carryAlong(ctx, { map, carrierBefore: token, carrierAfter: next, carry, byGm });
    // dcm-rx1k / dcm-bpr: the caster's areas that end when the caster moves.
    if (!stays && token.ref.kind === "pc") await endAreasOnCasterEvent(ctx, ctx.campaign._id, token.ref.characterId, "moves");
    // CB p.42 (Rogue, Cloaked): "end a move within line of sight of an adversary" ends it (Q9, plan drawer-answers DA3).
    // A GM's drag is not the rogue's move (dcm-bxp.99.19.62 (2)): `byGm`.
    if (!stays) await uncloakAfterMove(ctx, ctx.campaign, map, { ...token, ...next }, ctx.user._id, { byGm });
    // Plan lanes E4 (dcm-cma, dcm-wuu, dcm-ii4): live areas that react to entering, passing through, crossing or leaving.
    const areas = stays ? [] : await areasAfterMove(ctx, ctx.campaign._id, map._id, token, { ...token, ...next }, ctx.user._id, nameOf);
    // Plan lanes-2 E4.4 (dcm-ii4): a caster carried out of their own circle has exited it too.
    if (carried.length > 0) await endAreasOwnerLeft(ctx, { campaignId: ctx.campaign._id, mapId: map._id, actorId: ctx.user._id });
    // dcm-bpr: an enemy coming within a PC's Hold the Line range is named in the feed.
    if (!stays && map.live) await rangeTriggersAfterMove(ctx, ctx.campaign._id, map._id, token, { ...token, ...next }, ctx.user._id, nameOf);
    return {
      ...next,
      blocked,
      difficult,
      ...(areas.length > 0 ? { areas } : {}),
      ...(rules.warnings.length > 0 ? { warnings: rules.warnings } : {}),
      ...(rules.triggers.length > 0 ? { triggers: rules.triggers } : {}),
      ...(carried.length > 0 ? { carried } : {}),
    };
  },
});

/** Turns a token to `angle` radians, snapped to 15 degrees (R5). Same access as `move`. */
export const turn = campaignMutation({
  need: "view",
  enough: "owner",
  args: { tokenId: v.string(), angle: v.number() },
  returns: v.object({ face: v.number() }),
  handler: async (ctx, { tokenId, angle }) => {
    const { token } = await movableToken(ctx, tokenId);
    const face = snapTurn(angle);
    await ctx.db.patch("combatTokens", token._id, { face });
    return { face };
  },
});
