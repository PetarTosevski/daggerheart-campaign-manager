import { v } from "convex/values";

import { validateCustom, type CustomAdversaryInput } from "../src/lib/adversaries/custom";
import { appError } from "../src/lib/errors/app-error";
import { ADVERSARIES } from "../src/lib/srd/adversaries";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { MAX_CUSTOM, MAX_INSTANCES } from "./lib/encounters";
import { gmMutation, gmQuery, keyedGmMutation } from "./lib/functions";
import { customAdversaryFields } from "./lib/validators/encounters";

/**
 * A campaign's custom adversaries (D8 A5, open question 6: yes): "Duplicate & edit" of an SRD stat block, or a blank
 * one prefilled with the improvised statistics by tier (CB p.208). GM-only: every function is a GM wrapper, so a
 * player gets FORBIDDEN and an outsider NOT_FOUND. Encounters use them through encounters.addAdversary
 * (source `custom`), which snapshots their numbers, so an edit never moves live pips.
 */

const SRD_IDS = new Set(ADVERSARIES.map((a) => a.id));

const f = customAdversaryFields;
const inputFields = {
  name: f.name,
  tier: f.tier,
  type: f.type,
  hordePerHp: f.hordePerHp,
  description: f.description,
  motives: f.motives,
  difficulty: f.difficulty,
  thresholds: f.thresholds,
  hp: f.hp,
  stress: f.stress,
  attack: f.attack,
  experiences: f.experiences,
  features: f.features,
};

/** The editable fields, as the editor sends them on create. */
const customInputValidator = v.object(inputFields);

/** One edit: only the changed fields (CL3); `hordePerHp: null` clears it; features and experiences are whole lists. */
const customPatchValidator = v.object({
  name: v.optional(inputFields.name),
  tier: v.optional(inputFields.tier),
  type: v.optional(inputFields.type),
  hordePerHp: v.optional(v.union(v.number(), v.null())),
  description: v.optional(inputFields.description),
  motives: v.optional(inputFields.motives),
  difficulty: v.optional(inputFields.difficulty),
  thresholds: v.optional(inputFields.thresholds),
  hp: v.optional(inputFields.hp),
  stress: v.optional(inputFields.stress),
  attack: v.optional(inputFields.attack),
  experiences: v.optional(inputFields.experiences),
  features: v.optional(inputFields.features),
});

const customDocValidator = v.object({ _id: v.id("customAdversaries"), _creationTime: v.number(), ...customAdversaryFields });

/** The campaign's custom adversary, or NOT_FOUND when the id is malformed, the row is gone or it is another campaign's (CD7). */
async function loadCustom(ctx: QueryCtx, campaignId: Id<"campaigns">, customId: string): Promise<Doc<"customAdversaries">> {
  const id = ctx.db.normalizeId("customAdversaries", customId);
  const custom = id === null ? null : await ctx.db.get("customAdversaries", id);
  if (custom === null || custom.campaignId !== campaignId) throw appError("NOT_FOUND");
  return custom;
}

function inputOf(row: Doc<"customAdversaries">): CustomAdversaryInput {
  return {
    name: row.name,
    tier: row.tier,
    type: row.type,
    ...(row.hordePerHp !== undefined ? { hordePerHp: row.hordePerHp } : {}),
    description: row.description,
    motives: row.motives,
    difficulty: row.difficulty,
    thresholds: row.thresholds,
    hp: row.hp,
    stress: row.stress,
    attack: row.attack,
    experiences: row.experiences,
    features: row.features,
  };
}

/** The campaign's custom adversaries by name (at most MAX_CUSTOM). */
export const list = gmQuery({
  args: {},
  returns: v.array(customDocValidator),
  handler: async (ctx) =>
    ctx.db
      .query("customAdversaries")
      .withIndex("by_campaign_name", (q) => q.eq("campaignId", ctx.campaign._id))
      .take(MAX_CUSTOM),
});

/** A new custom adversary; `basedOn` names the SRD entry it was duplicated from. CUSTOM_ADVERSARY_LIMIT past MAX_CUSTOM. */
export const create = keyedGmMutation({
  args: { adversary: customInputValidator, basedOn: v.optional(v.string()) },
  returns: v.object({ customId: v.id("customAdversaries") }),
  handler: async (ctx, { adversary, basedOn }) =>
    ctx.once("custom_adversary_create", { adversary, basedOn: basedOn ?? null }, async () => {
      const campaignId = ctx.campaign._id;
      const input = validateCustom(adversary);
      if (basedOn !== undefined && !SRD_IDS.has(basedOn)) throw appError("ADVERSARY_UNKNOWN");
      const existing = await ctx.db
        .query("customAdversaries")
        .withIndex("by_campaign_name", (q) => q.eq("campaignId", campaignId))
        .take(MAX_CUSTOM);
      if (existing.length >= MAX_CUSTOM) throw appError("CUSTOM_ADVERSARY_LIMIT");
      const now = Date.now();
      const customId = await ctx.db.insert("customAdversaries", {
        campaignId,
        ...input,
        ...(basedOn !== undefined ? { basedOn } : {}),
        createdAt: now,
        updatedAt: now,
      });
      return { customId };
    }),
});

/** An edit of one custom adversary: the changed fields only, checked together with the rest of the block. */
export const update = gmMutation({
  args: { customId: v.string(), patch: customPatchValidator },
  returns: v.null(),
  handler: async (ctx, { customId, patch }) => {
    const custom = await loadCustom(ctx, ctx.campaign._id, customId);
    const { hordePerHp, ...rest } = patch;
    const merged: CustomAdversaryInput = { ...inputOf(custom), ...rest };
    if (hordePerHp === null) delete merged.hordePerHp;
    else if (hordePerHp !== undefined) merged.hordePerHp = hordePerHp;
    const input = validateCustom(merged);
    // `replace` so a field the checked block no longer has (hordePerHp off a non-Horde) is removed.
    await ctx.db.replace("customAdversaries", custom._id, {
      campaignId: custom.campaignId,
      ...input,
      ...(custom.basedOn !== undefined ? { basedOn: custom.basedOn } : {}),
      createdAt: custom.createdAt,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Deletes a custom adversary. Refused (ENCOUNTER_RULE) while the running encounter uses it; draft and ended encounters
 * keep their instances' snapshots, which then show as a deleted custom adversary.
 */
export const remove = gmMutation({
  args: { customId: v.string() },
  returns: v.null(),
  handler: async (ctx, { customId }) => {
    const custom = await loadCustom(ctx, ctx.campaign._id, customId);
    const running = await ctx.db
      .query("encounters")
      .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", ctx.campaign._id).eq("status", "running"))
      .first();
    if (running !== null) {
      const instances = await ctx.db
        .query("encounterAdversaries")
        .withIndex("by_encounter_order", (q) => q.eq("encounterId", running._id))
        .take(MAX_INSTANCES + 1);
      if (instances.some((i) => i.source.kind === "custom" && i.source.customId === custom._id)) {
        throw appError("ENCOUNTER_RULE", `${custom.name} is in the running encounter. End it or remove the adversary from it first.`);
      }
    }
    await ctx.db.delete("customAdversaries", custom._id);
    return null;
  },
});

