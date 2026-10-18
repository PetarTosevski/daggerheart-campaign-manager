import { v } from "convex/values";

import { adversariesFor } from "../src/lib/domain/adversaries/index";
import { instanceStats, nextLabels, type StatSource } from "../src/lib/domain/encounters/instances";
import { appError } from "../src/lib/errors/app-error";
import { resolveOptions } from "../src/lib/frames/options";
import { ADVERSARIES } from "../src/lib/srd/adversaries";
import type { AdversaryDef } from "../src/lib/srd/types";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertTextLength,
  assertWholeInRange,
  loadEncounter,
  loadInstance,
  MAX_ENCOUNTER_NAME,
  MAX_ENCOUNTER_NOTES,
  MAX_ENCOUNTERS,
  MAX_INSTANCES,
  MAX_MINIONS,
  MAX_PCS,
  MIN_PCS,
} from "./lib/encounters";
import { gmMutation, gmQuery, keyedGmMutation } from "./lib/functions";
import {
  adversarySourceValidator,
  adversaryTypeValidator,
  bpAdjustmentValidator,
  encounterAdversaryFields,
  encounterFields,
  encounterStatusValidator,
  type AdversarySource,
} from "./lib/validators/encounters";

/**
 * Encounters and their adversary instances (D8 A3): the GM's prep list, the Battle Points inputs (party size and
 * adjustments, CB p.197) and adding adversaries from the catalogue. GM-only: every function is a GM wrapper, so a
 * player gets FORBIDDEN and an outsider NOT_FOUND. The live tracker (HP, Stress, conditions, spotlight) is
 * convex/encounterTracking.ts (A4).
 */

/** Separate rows added at once for a non-Minion adversary ("2 Bears"). */
const MAX_ADD_COUNT = 10;
/** Ended encounters listed by default; the client asks for more. */
const ENDED_PAGE = 20;
/** Party size when the campaign has no active character (the Sessions board's default). */
const DEFAULT_PCS = 4;
/** Characters read to count the active ones for the default party size. */
const MAX_CHARACTERS_READ = 100;

const SRD_BY_ID = new Map<string, AdversaryDef>(ADVERSARIES.map((a) => [a.id, a]));

// ---------------------------------------------------------------- validators

const encounterSummaryValidator = v.object({
  _id: v.id("encounters"),
  name: v.string(),
  status: encounterStatusValidator,
  pcs: v.number(),
  updatedAt: v.number(),
});

const encounterDocValidator = v.object({ _id: v.id("encounters"), _creationTime: v.number(), ...encounterFields });

/** An instance plus what its stat block says about it: name, type and tier (null when its custom block is gone). */
const instanceViewValidator = v.object({
  _id: v.id("encounterAdversaries"),
  _creationTime: v.number(),
  ...encounterAdversaryFields,
  name: v.union(v.string(), v.null()),
  type: v.union(adversaryTypeValidator, v.null()),
  tier: v.union(v.number(), v.null()),
});

const budgetChangeValidator = v.union(
  v.object({ kind: v.literal("pcs"), delta: v.number() }),
  v.object({ kind: v.literal("adjustment"), adjustment: bpAdjustmentValidator, on: v.boolean() }),
);

// ---------------------------------------------------------------- helpers

function encounterName(raw: string): string {
  const name = raw.trim();
  if (name === "") throw appError("ENCOUNTER_RULE", "Give the encounter a name.");
  assertTextLength(name, MAX_ENCOUNTER_NAME, "An encounter name");
  return name;
}

function summary(e: Doc<"encounters">) {
  return { _id: e._id, name: e.name, status: e.status, pcs: e.pcs, updatedAt: e.updatedAt };
}

function byStatus(ctx: QueryCtx, campaignId: Id<"campaigns">, status: Doc<"encounters">["status"]) {
  return ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId).eq("status", status))
    .order("desc");
}

/** The encounter's instances in order (at most MAX_INSTANCES, so one bounded read). */
function instancesOf(ctx: QueryCtx, encounterId: Id<"encounters">) {
  return ctx.db
    .query("encounterAdversaries")
    .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounterId))
    .take(MAX_INSTANCES + 1);
}

/** Active characters in the campaign, the default Battle Points party size (CB p.197 "the number of PCs in combat"). */
async function activePcs(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<number> {
  const characters = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CHARACTERS_READ);
  const active = characters.filter((c) => c.status === "active").length;
  return active === 0 ? DEFAULT_PCS : Math.min(MAX_PCS, active);
}

/**
 * The stat block an instance is made from: an SRD entry this campaign can use (Hope & Fear switch, frame-exclusive
 * blocks) or one of this campaign's custom adversaries; anything else is ADVERSARY_UNKNOWN.
 */
async function resolveSource(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  source: AdversarySource,
): Promise<{ name: string; block: StatSource }> {
  if (source.kind === "srd") {
    const options = resolveOptions(campaign.frameId, campaign.options);
    const def = SRD_BY_ID.get(source.adversaryId);
    const usable = def && adversariesFor([def], { hopeAndFear: options.hopeAndFear, frameId: campaign.frameId }).length === 1;
    if (!def || !usable) throw appError("ADVERSARY_UNKNOWN");
    return { name: def.name, block: def };
  }
  const custom = await ctx.db.get("customAdversaries", source.customId);
  if (custom === null || custom.campaignId !== campaign._id) throw appError("ADVERSARY_UNKNOWN");
  return { name: custom.name, block: custom };
}

async function touch(ctx: MutationCtx, encounter: Doc<"encounters">) {
  await ctx.db.patch("encounters", encounter._id, { updatedAt: Date.now() });
}

// ---------------------------------------------------------------- queries

/**
 * The campaign's encounters for the builder's list: the running one and the drafts (newest first, at most
 * MAX_ENCOUNTERS), then the newest `endedLimit` ended ones (default 20) and whether there are more.
 */
export const list = gmQuery({
  args: { endedLimit: v.optional(v.number()) },
  returns: v.object({
    active: v.array(encounterSummaryValidator),
    ended: v.array(encounterSummaryValidator),
    moreEnded: v.boolean(),
  }),
  handler: async (ctx, { endedLimit = ENDED_PAGE }) => {
    assertWholeInRange(endedLimit, 1, MAX_ENCOUNTERS, "The number of ended encounters");
    const campaignId = ctx.campaign._id;
    const running = await byStatus(ctx, campaignId, "running").take(MAX_ENCOUNTERS);
    const drafts = await byStatus(ctx, campaignId, "draft").take(MAX_ENCOUNTERS);
    const ended = await byStatus(ctx, campaignId, "ended").take(endedLimit + 1);
    return {
      active: [...running, ...drafts].map(summary),
      ended: ended.slice(0, endedLimit).map(summary),
      moreEnded: ended.length > endedLimit,
    };
  },
});

/**
 * One encounter with its instances in order, each with its stat block's name, type and tier (SRD entries come from
 * the bundled data; a custom adversary is read once per distinct block). Null when the encounter is gone or is not
 * this campaign's, so a live view never throws as it is deleted.
 */
export const get = gmQuery({
  args: { encounterId: v.string() },
  returns: v.union(v.object({ encounter: encounterDocValidator, instances: v.array(instanceViewValidator) }), v.null()),
  handler: async (ctx, { encounterId }) => {
    const id = ctx.db.normalizeId("encounters", encounterId);
    const encounter = id === null ? null : await ctx.db.get("encounters", id);
    if (encounter === null || encounter.campaignId !== ctx.campaign._id) return null;
    const rows = (await instancesOf(ctx, encounter._id)).slice(0, MAX_INSTANCES);
    const customs = new Map<Id<"customAdversaries">, Doc<"customAdversaries"> | null>();
    for (const row of rows) {
      if (row.source.kind === "custom" && !customs.has(row.source.customId)) {
        const custom = await ctx.db.get("customAdversaries", row.source.customId);
        customs.set(row.source.customId, custom && custom.campaignId === ctx.campaign._id ? custom : null);
      }
    }
    const instances = rows.map((row) => {
      const block = row.source.kind === "srd" ? (SRD_BY_ID.get(row.source.adversaryId) ?? null) : (customs.get(row.source.customId) ?? null);
      return { ...row, name: block?.name ?? null, type: block?.type ?? null, tier: block?.tier ?? null };
    });
    return { encounter, instances };
  },
});

// ---------------------------------------------------------------- encounter mutations

/** A new draft encounter. `pcs` defaults to the campaign's active characters (4 when there are none). */
export const create = keyedGmMutation({
  args: { name: v.string(), pcs: v.optional(v.number()) },
  returns: v.object({ encounterId: v.id("encounters") }),
  handler: async (ctx, { name: rawName, pcs: rawPcs }) =>
    ctx.once("encounter_create", { name: rawName, pcs: rawPcs ?? null }, async () => {
      const campaignId = ctx.campaign._id;
      const name = encounterName(rawName);
      if (rawPcs !== undefined) assertWholeInRange(rawPcs, MIN_PCS, MAX_PCS, "The party size");
      const existing = await ctx.db
        .query("encounters")
        .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId))
        .take(MAX_ENCOUNTERS);
      if (existing.length >= MAX_ENCOUNTERS) throw appError("ENCOUNTER_LIMIT");
      const pcs = rawPcs ?? (await activePcs(ctx, campaignId));
      const now = Date.now();
      const encounterId = await ctx.db.insert("encounters", {
        campaignId,
        name,
        status: "draft",
        pcs,
        adjustments: [],
        gmTurn: 1,
        createdAt: now,
        updatedAt: now,
      });
      return { encounterId };
    }),
});

export const rename = gmMutation({
  args: { encounterId: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { encounterId, name }) => {
    const encounter = await loadEncounter(ctx, ctx.campaign._id, encounterId);
    await ctx.db.patch("encounters", encounter._id, { name: encounterName(name), updatedAt: Date.now() });
    return null;
  },
});

/** The GM's notes on the encounter; blank clears them. */
export const setNotes = gmMutation({
  args: { encounterId: v.string(), notes: v.string() },
  returns: v.null(),
  handler: async (ctx, { encounterId, notes }) => {
    const encounter = await loadEncounter(ctx, ctx.campaign._id, encounterId);
    assertTextLength(notes, MAX_ENCOUNTER_NOTES, "Encounter notes");
    await ctx.db.patch("encounters", encounter._id, { notes: notes.trim() === "" ? undefined : notes, updatedAt: Date.now() });
    return null;
  },
});

/**
 * A Battle Points input as an intent: the party size moves by `delta` (kept within 1..12), or one adjustment is
 * switched on or off. Returns the stored values.
 */
export const setBudget = gmMutation({
  args: { encounterId: v.string(), change: budgetChangeValidator },
  returns: v.object({ pcs: v.number(), adjustments: v.array(bpAdjustmentValidator) }),
  handler: async (ctx, { encounterId, change }) => {
    const encounter = await loadEncounter(ctx, ctx.campaign._id, encounterId);
    let { pcs, adjustments } = encounter;
    if (change.kind === "pcs") {
      assertWholeInRange(change.delta, -MAX_PCS, MAX_PCS, "The party size change");
      pcs = Math.min(MAX_PCS, Math.max(MIN_PCS, pcs + change.delta));
    } else {
      const rest = adjustments.filter((a) => a !== change.adjustment);
      adjustments = change.on ? [...rest, change.adjustment] : rest;
    }
    await ctx.db.patch("encounters", encounter._id, { pcs, adjustments, updatedAt: Date.now() });
    return { pcs, adjustments };
  },
});

/** Starts the encounter (a draft or an ended one); ENCOUNTER_RUNNING while another encounter is running. */
export const start = gmMutation({
  args: { encounterId: v.string() },
  returns: v.null(),
  handler: async (ctx, { encounterId }) => {
    const encounter = await loadEncounter(ctx, ctx.campaign._id, encounterId);
    if (encounter.status === "running") return null;
    const running = await byStatus(ctx, ctx.campaign._id, "running").first();
    if (running !== null) throw appError("ENCOUNTER_RUNNING");
    const now = Date.now();
    await ctx.db.patch("encounters", encounter._id, { status: "running", startedAt: now, endedAt: undefined, updatedAt: now });
    return null;
  },
});

/** Ends the running encounter; ENCOUNTER_NOT_RUNNING otherwise. */
export const end = gmMutation({
  args: { encounterId: v.string() },
  returns: v.null(),
  handler: async (ctx, { encounterId }) => {
    const encounter = await loadEncounter(ctx, ctx.campaign._id, encounterId);
    if (encounter.status !== "running") throw appError("ENCOUNTER_NOT_RUNNING");
    const now = Date.now();
    await ctx.db.patch("encounters", encounter._id, { status: "ended", endedAt: now, updatedAt: now });
    return null;
  },
});

/** Deletes the encounter and its instances (at most MAX_INSTANCES) in one transaction. */
export const remove = gmMutation({
  args: { encounterId: v.string() },
  returns: v.null(),
  handler: async (ctx, { encounterId }) => {
    const encounter = await loadEncounter(ctx, ctx.campaign._id, encounterId);
    for (const row of await instancesOf(ctx, encounter._id)) await ctx.db.delete("encounterAdversaries", row._id);
    await ctx.db.delete("encounters", encounter._id);
    return null;
  },
});

// ---------------------------------------------------------------- instance mutations

/**
 * Adds an adversary from the catalogue (an SRD entry this campaign can use, or one of its custom adversaries):
 * `count` separate instances (1..10, numbered "Bear", "Bear 2"), or for a Minion one group row of `count` Minions
 * (1..30). `summoned` instances cost no Battle Points (CB p.197). ENCOUNTER_FULL past MAX_INSTANCES instances.
 */
export const addAdversary = keyedGmMutation({
  args: { encounterId: v.string(), source: adversarySourceValidator, count: v.number(), summoned: v.boolean() },
  returns: v.object({ instanceIds: v.array(v.id("encounterAdversaries")) }),
  handler: async (ctx, { encounterId, source, count, summoned }) =>
    ctx.once("encounter_add_adversary", { encounterId, source, count, summoned }, async () => {
      const encounter = await loadEncounter(ctx, ctx.campaign._id, encounterId);
      const { name, block } = await resolveSource(ctx, ctx.campaign, source);
      const minion = block.type === "Minion";
      if (minion) assertWholeInRange(count, 1, MAX_MINIONS, "A Minion group");
      else assertWholeInRange(count, 1, MAX_ADD_COUNT, "The number of adversaries");
      const rows = minion ? 1 : count;

      const existing = await instancesOf(ctx, encounter._id);
      if (existing.length + rows > MAX_INSTANCES) throw appError("ENCOUNTER_FULL");
      const labels = nextLabels(
        name,
        existing.map((r) => r.label),
        rows,
      );
      let order = existing.reduce((max, r) => Math.max(max, r.order), 0);
      const now = Date.now();
      const stats = instanceStats(block, minion ? count : undefined);
      const instanceIds: Id<"encounterAdversaries">[] = [];
      for (const label of labels) {
        order += 1;
        instanceIds.push(
          await ctx.db.insert("encounterAdversaries", {
            campaignId: ctx.campaign._id,
            encounterId: encounter._id,
            source,
            label,
            order,
            summoned,
            ...(minion ? { minionCount: count } : {}),
            stats,
            hp: 0,
            stress: 0,
            defeated: false,
            conditions: [],
            tags: [],
            spotlights: 0,
            spotlightTurn: encounter.gmTurn,
            updatedAt: now,
          }),
        );
      }
      await touch(ctx, encounter);
      return { instanceIds };
    }),
});

export const removeInstance = gmMutation({
  args: { instanceId: v.string() },
  returns: v.null(),
  handler: async (ctx, { instanceId }) => {
    const instance = await loadInstance(ctx, ctx.campaign._id, instanceId);
    const encounter = await loadEncounter(ctx, ctx.campaign._id, instance.encounterId);
    await ctx.db.delete("encounterAdversaries", instance._id);
    await touch(ctx, encounter);
    return null;
  },
});

/** Moves an instance one place up or down the encounter's order (swaps with its neighbour; no-op at either end). */
export const reorder = gmMutation({
  args: { instanceId: v.string(), direction: v.union(v.literal("up"), v.literal("down")) },
  returns: v.null(),
  handler: async (ctx, { instanceId, direction }) => {
    const instance = await loadInstance(ctx, ctx.campaign._id, instanceId);
    const rows = await instancesOf(ctx, instance.encounterId);
    const i = rows.findIndex((r) => r._id === instance._id);
    const neighbour = rows[direction === "up" ? i - 1 : i + 1];
    if (i === -1 || neighbour === undefined) return null;
    const now = Date.now();
    await ctx.db.patch("encounterAdversaries", instance._id, { order: neighbour.order, updatedAt: now });
    await ctx.db.patch("encounterAdversaries", neighbour._id, { order: instance.order, updatedAt: now });
    return null;
  },
});
