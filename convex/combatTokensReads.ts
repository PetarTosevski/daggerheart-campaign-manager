import { v } from "convex/values";

import { sessionEncounterTitle } from "../src/lib/domain/sessions/encounter-title";
import type { AdversaryType } from "../src/lib/srd/types";
import { partyOf } from "./lib/characterSheet";
import { tokensOnMap } from "./lib/combatMaps";
import { adversaryType, findMap, instancesOf, placedInstances, runningEncounter, viewsOf } from "./lib/combatTokenViews";
import { MAX_INSTANCES } from "./lib/encounters";
import { campaignQuery, gmQuery } from "./lib/functions";
import { atLeast } from "./lib/permissions";
import { currentSessionEncounter } from "./lib/sessions";
import { tokenViewValidator } from "./lib/validators/combatTokens";
import { encounterStatusValidator } from "./lib/validators/encounters";

/**
 * The token reads of the Combat Map and the HUD (D9 C6, R4, Q4; D10 S8, B11). Moved out of `combatTokens.ts` by
 * dcm-uh6r so these subscriptions do not load the movement, area and placement code the token mutations need. Same
 * wrappers, arguments and returns as before.
 *
 * The GM's `list` returns every token with its stats. Players get `party`: the PC tokens only (their own and the other
 * PCs', Q4), never an adversary, ally or neutral token, until C7's filtered `playerView`. `combatants` and
 * `sessionEncounter` feed the GM's Combatants card and its "＋ Session encounter" button.
 */

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
