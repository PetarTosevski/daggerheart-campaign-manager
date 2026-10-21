import { v, type Infer } from "convex/values";

import { freeSquares, moveToken, snapTurn, startFace, startSide } from "../src/components/combat-map/tokens/geometry";
import { rasterize, type TerrainId } from "../src/lib/combat-map/raster";
import { checkMove } from "../src/lib/domain/combat-map/movement";
import { appError } from "../src/lib/errors/app-error";
import { applyCondition } from "../src/lib/domain/encounters/damage";
import { sessionEncounterTitle } from "../src/lib/domain/sessions/encounter-title";
import { ADVERSARIES } from "../src/lib/srd/adversaries";
import { PORTRAITS } from "../src/lib/srd/art";
import { CLASSES } from "../src/lib/srd/classes";
import type { AdversaryType } from "../src/lib/srd/types";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
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
import { movementGrid } from "./lib/combatMovement";
import { adversaryArtSrc, MAX_INSTANCES, startEncounter } from "./lib/encounters";
import { ownFileUrl } from "./lib/files";
import { campaignMutation, campaignQuery, gmMutation, gmQuery, keyedGmMutation } from "./lib/functions";
import { atLeast, permissionFor, type Permission } from "./lib/permissions";
import { currentSessionEncounter } from "./lib/sessions";
import { carriedLightValidator, tokenSideValidator } from "./lib/validators/combatMaps";
import { encounterConditionValidator, encounterStatusValidator } from "./lib/validators/encounters";

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
 * Reads: the GM's `list` returns every token with its stats. Players get `party`: the PC tokens only (their own
 * and the other PCs', Q4), never an adversary, ally or neutral token, until C7's filtered `playerView`.
 */

const SRD_TYPES = new Map<string, string>(ADVERSARIES.map((a) => [a.id, a.type]));
const CLASS_NAMES = new Map<string, string>(CLASSES.map((c) => [c.id, c.name]));

/** The highest Hit Points or Stress a custom token can have. */
const MAX_CUSTOM_TRACK = 99;
/** Most tokens one "Place all" puts down (the tracker's own cap). */
const MAX_PLACE = MAX_INSTANCES;

// ---------------------------------------------------------------- validators

const tokenKindValidator = v.union(v.literal("pc"), v.literal("adversary"), v.literal("custom"));

/** A token's portrait: an uploaded image or rulebook art (url), the chosen or default design art (an asset id), or none (initials). */
const portraitValidator = v.union(
  v.null(),
  v.object({ kind: v.literal("url"), url: v.string() }),
  v.object({ kind: v.literal("asset"), asset: v.string(), position: v.string() }),
);

const statsValidator = v.object({
  hp: v.number(),
  hpMax: v.number(),
  stress: v.number(),
  stressMax: v.number(),
  /** The sheet's conditions (PC) or the tracker's (adversary, custom). */
  conditions: v.array(v.string()),
  /** An adversary's Difficulty. */
  difficulty: v.optional(v.number()),
  /** Every HP marked (a downed PC, a defeated adversary): the token is greyed. */
  down: v.boolean(),
});

/**
 * A token as the map draws it. `stats` is null when the source row is gone (a deleted character or encounter
 * instance) or unreadable. `tracked` (adversaries): the tracker accepts changes because the encounter is running.
 */
export const tokenViewValidator = v.object({
  _id: v.id("combatTokens"),
  kind: tokenKindValidator,
  characterId: v.optional(v.id("characters")),
  instanceId: v.optional(v.id("encounterAdversaries")),
  side: tokenSideValidator,
  x: v.number(),
  y: v.number(),
  size: v.number(),
  face: v.number(),
  light: carriedLightValidator,
  /** GM only: who this token was revealed to (R10). */
  revealedTo: v.optional(v.array(v.id("characters"))),
  name: v.string(),
  /** "Bard · level 1", "Bruiser", "" (custom). */
  sub: v.string(),
  portrait: portraitValidator,
  /** The caller may move and turn it (GM: every token; a player: their own PC's). */
  canMove: v.boolean(),
  /** The caller's own character's token (players; false for the GM). */
  mine: v.boolean(),
  stats: v.union(v.null(), statsValidator),
  tracked: v.optional(v.boolean()),
});
export type TokenView = Infer<typeof tokenViewValidator>;

const combatantsValidator = v.object({
  /** Active characters not yet on this map ("＋ Party (n)"). */
  partyLeft: v.number(),
  /** The running encounter, or null. */
  encounter: v.union(v.null(), v.object({ _id: v.id("encounters"), name: v.string() })),
  /** The board's "From the Adversaries tab" queue: the running encounter's instances not yet on this map, in order. */
  queue: v.array(v.object({ instanceId: v.id("encounterAdversaries"), name: v.string(), solo: v.boolean() })),
});

/** The "＋ Session encounter" button (B11): its title, and the session and encounter it places (null: none). */
const sessionEncounterValidator = v.object({
  /** 'Session N: 2× Bruiser, 1× Leader' (S1's sessionEncounterTitle over every instance), or 'No planned session with an encounter'. */
  title: v.string(),
  session: v.union(
    v.null(),
    v.object({
      sessionId: v.id("sessions"),
      n: v.number(),
      encounterId: v.id("encounters"),
      encounterName: v.string(),
      status: encounterStatusValidator,
      /** Instances in the encounter. */
      adversaries: v.number(),
      /** Its undefeated instances not on this map yet (0 for an unknown map). */
      unplaced: v.number(),
    }),
  ),
});

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

/** A campaign's map by id, or null (other campaigns' and malformed ids read as missing). */
async function findMap(ctx: QueryCtx, campaignId: Id<"campaigns">, mapId: string): Promise<Doc<"combatMaps"> | null> {
  const id = ctx.db.normalizeId("combatMaps", mapId);
  const map = id === null ? null : await ctx.db.get("combatMaps", id);
  return map !== null && map.campaignId === campaignId ? map : null;
}

/** The campaign's running encounter (at most one), or null. */
function runningEncounter(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId).eq("status", "running"))
    .first();
}

/** An instance's adversary type (SRD entry or the campaign's custom block), or null. */
async function adversaryType(ctx: QueryCtx, campaignId: Id<"campaigns">, instance: Doc<"encounterAdversaries">): Promise<string | null> {
  if (instance.source.kind === "srd") return SRD_TYPES.get(instance.source.adversaryId) ?? null;
  const block = await ctx.db.get("customAdversaries", instance.source.customId);
  return block !== null && block.campaignId === campaignId ? block.type : null;
}

/** An adversary token's portrait: its rulebook art as an image URL, or null (initials). */
async function adversaryPortrait(ctx: QueryCtx, campaignId: Id<"campaigns">, instance: Doc<"encounterAdversaries">): Promise<TokenView["portrait"]> {
  const src = await adversaryArtSrc(ctx, campaignId, instance);
  return src === null ? null : { kind: "url", url: src };
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

/** The encounter's instances in order (at most MAX_INSTANCES). */
function instancesOf(ctx: QueryCtx, encounterId: Id<"encounters">) {
  return ctx.db
    .query("encounterAdversaries")
    .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounterId))
    .take(MAX_INSTANCES);
}

/** The ids of the adversary instances already on a map. */
function placedInstances(tokens: Doc<"combatTokens">[]): Set<Id<"encounterAdversaries">> {
  return new Set(tokens.flatMap((t) => (t.ref.kind === "adversary" ? [t.ref.adversaryId] : [])));
}

/** A PC's portrait (CharacterPortrait's order: upload, chosen art, default art by subclass then ancestry). */
export async function pcPortrait(ctx: QueryCtx, characterId: Id<"characters">, sheet: ReturnType<typeof readSheet>): Promise<TokenView["portrait"]> {
  if (sheet.portrait?.kind === "upload") {
    const url = await ownFileUrl(ctx, "portrait", characterId, sheet.portrait.storageId);
    return url === null ? null : { kind: "url", url };
  }
  if (sheet.portrait?.kind === "asset") return { kind: "asset", asset: sheet.portrait.asset, position: "center 30%" };
  const ancestry = sheet.ancestry.kind === "single" ? sheet.ancestry.id : sheet.ancestry.kind === "mixed" ? sheet.ancestry.first : sheet.ancestry.form;
  const art = PORTRAITS[`sub-${sheet.subclassId}`] ?? PORTRAITS[`anc-${ancestry}`];
  return art ? { kind: "asset", asset: art.asset, position: art.position } : null;
}

/**
 * Builds the views of `tokens` for the caller. `gm`: every token may move and `revealedTo` is included; otherwise a
 * PC token may move when the caller can edit its character (permissionFor, R4). Reads each source row once.
 */
type CampaignCtx<C> = C & { user: Doc<"users">; campaign: Doc<"campaigns">; permission: Permission };

async function viewsOf(ctx: CampaignCtx<QueryCtx>, tokens: Doc<"combatTokens">[], gm: boolean): Promise<TokenView[]> {
  const encounters = new Map<Id<"encounters">, Doc<"encounters"> | null>();
  const views: TokenView[] = [];
  for (const token of tokens) {
    const base = {
      _id: token._id,
      side: token.side,
      x: token.x,
      y: token.y,
      size: token.size,
      face: token.face,
      light: token.light,
      ...(gm ? { revealedTo: token.revealedTo } : {}),
    };
    const { ref } = token;
    if (ref.kind === "custom") {
      views.push({
        ...base,
        kind: "custom",
        name: ref.name,
        sub: "",
        portrait: null,
        canMove: gm,
        mine: false,
        stats: { hp: ref.hp, hpMax: ref.hpMax, stress: ref.stress, stressMax: ref.stressMax, conditions: ref.conditions, down: ref.hpMax > 0 && ref.hp >= ref.hpMax },
      });
    } else if (ref.kind === "pc") {
      const character = await ctx.db.get("characters", ref.characterId);
      if (character === null || character.campaignId !== ctx.campaign._id) {
        views.push({ ...base, kind: "pc", characterId: ref.characterId, name: "Missing character", sub: "", portrait: null, canMove: gm, mine: false, stats: null });
        continue;
      }
      const mine = !gm && character.ownerId === ctx.user._id;
      const canMove = gm || atLeast(await permissionFor(ctx, ctx.user, { type: "character", campaign: ctx.campaign, character }, "edit"), "edit");
      let sheet: ReturnType<typeof readSheet>;
      try {
        sheet = readSheet(character.sheet);
      } catch {
        views.push({ ...base, kind: "pc", characterId: character._id, name: "Unreadable character", sub: "", portrait: null, canMove, mine, stats: null });
        continue;
      }
      views.push({
        ...base,
        kind: "pc",
        characterId: character._id,
        name: sheet.name,
        sub: `${CLASS_NAMES.get(sheet.classId) ?? sheet.classId} · level ${sheet.level}`,
        portrait: await pcPortrait(ctx, character._id, sheet),
        canMove,
        mine,
        stats: {
          hp: sheet.hp,
          hpMax: sheet.hpMax,
          stress: sheet.stress,
          stressMax: sheet.stressMax,
          conditions: sheet.conditions,
          down: character.status === "dead" || (sheet.hpMax > 0 && sheet.hp >= sheet.hpMax),
        },
      });
    } else {
      const instance = await ctx.db.get("encounterAdversaries", ref.adversaryId);
      if (instance === null || instance.campaignId !== ctx.campaign._id) {
        views.push({ ...base, kind: "adversary", instanceId: ref.adversaryId, name: "Removed adversary", sub: "", portrait: null, canMove: gm, mine: false, stats: null, tracked: false });
        continue;
      }
      if (!encounters.has(instance.encounterId)) encounters.set(instance.encounterId, await ctx.db.get("encounters", instance.encounterId));
      const encounter = encounters.get(instance.encounterId) ?? null;
      const type = await adversaryType(ctx, ctx.campaign._id, instance);
      views.push({
        ...base,
        kind: "adversary",
        instanceId: instance._id,
        name: instance.label,
        sub: [type, encounter?.name].filter(Boolean).join(" · "),
        // The rulebook art when the adversary has it (user 2026-10-21), else the side's colour and initials.
        portrait: await adversaryPortrait(ctx, ctx.campaign._id, instance),
        canMove: gm,
        mine: false,
        stats: {
          hp: instance.hp,
          hpMax: instance.stats.hpMax,
          stress: instance.stress,
          stressMax: instance.stats.stressMax,
          conditions: instance.conditions,
          difficulty: instance.stats.difficulty,
          down: instance.defeated,
        },
        tracked: encounter?.status === "running",
      });
    }
  }
  return views;
}

/** A custom token or INVALID. */
function customRef(token: Doc<"combatTokens">) {
  if (token.ref.kind !== "custom") invalid("Only a custom token keeps its own numbers; change this one on its sheet or in the tracker.");
  return token.ref;
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

// ---------------------------------------------------------------- reads

/** GM: every token on the map with its stats (R4). An unknown or other campaign's map reads as empty. */
export const list = gmQuery({
  args: { mapId: v.string() },
  returns: v.array(tokenViewValidator),
  handler: async (ctx, { mapId }) => {
    const map = await findMap(ctx, ctx.campaign._id, mapId);
    if (map === null) return [];
    return viewsOf(ctx, await tokensOnMap(ctx, map._id), true);
  },
});

/**
 * Everyone in the campaign: the map's PC tokens only (the caller's own and the other PCs', Q4); never an adversary,
 * ally, neutral or custom token, so no adversary stats reach a player (R4). Players read only the live map (any
 * other map reads as empty); the GM reads any. C7's `playerView` replaces this for players.
 */
export const party = campaignQuery({
  need: "view",
  enough: "owner",
  args: { mapId: v.string() },
  returns: v.array(tokenViewValidator),
  handler: async (ctx, { mapId }) => {
    const gm = atLeast(ctx.permission, "owner");
    const map = await findMap(ctx, ctx.campaign._id, mapId);
    if (map === null || (!gm && !map.live)) return [];
    const pcs = (await tokensOnMap(ctx, map._id)).filter((t) => t.ref.kind === "pc");
    return viewsOf(ctx, pcs, gm);
  },
});

/** GM, the Combatants card: party members not yet placed and the running encounter's queue (unplaced, not defeated). */
export const combatants = gmQuery({
  args: { mapId: v.string() },
  returns: combatantsValidator,
  handler: async (ctx, { mapId }) => {
    const map = await findMap(ctx, ctx.campaign._id, mapId);
    if (map === null) return { partyLeft: 0, encounter: null, queue: [] };
    const tokens = await tokensOnMap(ctx, map._id);
    const placedPcs = new Set(tokens.flatMap((t) => (t.ref.kind === "pc" ? [t.ref.characterId] : [])));
    const placedAdversaries = new Set(tokens.flatMap((t) => (t.ref.kind === "adversary" ? [t.ref.adversaryId] : [])));
    const party = await partyOf(ctx, ctx.campaign._id);
    const partyLeft = party.filter((c) => c.status === "active" && !placedPcs.has(c._id)).length;
    const encounter = await runningEncounter(ctx, ctx.campaign._id);
    if (encounter === null) return { partyLeft, encounter: null, queue: [] };
    const instances = await ctx.db
      .query("encounterAdversaries")
      .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
      .take(MAX_INSTANCES);
    const queue = [];
    for (const instance of instances) {
      if (instance.defeated || placedAdversaries.has(instance._id)) continue;
      queue.push({ instanceId: instance._id, name: instance.label, solo: (await adversaryType(ctx, ctx.campaign._id, instance)) === "Solo" });
    }
    return { partyLeft, encounter: { _id: encounter._id, name: encounter.name }, queue };
  },
});

/**
 * GM, the "＋ Session encounter" button (B11): the live session, else the newest planned one, with its linked
 * encounter, the title 'Session N: 2× Bruiser, 1× Leader' over every instance, and how many of its undefeated
 * instances are not on this map yet; `session: null` with 'No planned session with an encounter' otherwise.
 */
export const sessionEncounter = gmQuery({
  args: { mapId: v.string() },
  returns: sessionEncounterValidator,
  handler: async (ctx, { mapId }) => {
    const campaignId = ctx.campaign._id;
    const found = await currentSessionEncounter(ctx, campaignId);
    if (found === null) return { title: sessionEncounterTitle(null), session: null };
    const { session, encounter } = found;
    const instances = await instancesOf(ctx, encounter._id);
    const types: { type: AdversaryType | null }[] = [];
    for (const instance of instances) types.push({ type: (await adversaryType(ctx, campaignId, instance)) as AdversaryType | null });
    const map = await findMap(ctx, campaignId, mapId);
    const placed = map === null ? null : placedInstances(await tokensOnMap(ctx, map._id));
    const unplaced = placed === null ? 0 : instances.filter((i) => !i.defeated && !placed.has(i._id)).length;
    return {
      title: sessionEncounterTitle({ n: session.n, instances: types }),
      session: {
        sessionId: session._id,
        n: session.n,
        encounterId: encounter._id,
        encounterName: encounter.name,
        status: encounter.status,
        adversaries: instances.length,
        unplaced,
      },
    };
  },
});

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

/** Takes one token off the map (its character or tracker row stays). */
export const remove = gmMutation({
  args: { tokenId: v.string() },
  returns: v.null(),
  handler: async (ctx, { tokenId }) => {
    const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
    await ctx.db.delete("combatTokens", token._id);
    return null;
  },
});

/** Takes every token off the map (the board's "Clear tokens", confirmed with a second click). */
export const clear = gmMutation({
  args: { mapId: v.string() },
  returns: v.object({ removed: v.number() }),
  handler: async (ctx, { mapId }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    const tokens = await tokensOnMap(ctx, map._id);
    for (const token of tokens) await ctx.db.delete("combatTokens", token._id);
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
 */
export const move = campaignMutation({
  need: "view",
  enough: "owner",
  args: { tokenId: v.string(), x: v.number(), y: v.number() },
  returns: v.object({ x: v.number(), y: v.number(), face: v.number(), blocked: v.boolean(), difficult: v.boolean() }),
  handler: async (ctx, { tokenId, x, y }) => {
    const { token, map } = await movableToken(ctx, tokenId);
    const next = moveToken(token, x, y, map);
    const stays = next.x === token.x && next.y === token.y;
    const { blocked, difficult } = stays
      ? { blocked: false, difficult: false }
      : checkMove(await movementGrid(ctx, ctx.campaign._id, map), token, next, token.size);
    if (blocked && !atLeast(ctx.permission, "owner")) throw appError("MOVE_BLOCKED");
    await ctx.db.patch("combatTokens", token._id, next);
    return { ...next, blocked, difficult };
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
