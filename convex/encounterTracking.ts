import { v } from "convex/values";

import { applyCondition, applyMark, damageSeverity, damageTaken, hpForDamage, isDefeated, MAX_DAMAGE, minionDefeats } from "../src/lib/domain/encounters/damage";
import { applySpotlight, spotlightCostsFear, turnSpotlights } from "../src/lib/domain/encounters/spotlight";
import { minionValue } from "../src/lib/domain/adversaries/index";
import { appError } from "../src/lib/errors/app-error";
import { ADVERSARIES } from "../src/lib/srd/adversaries";
import type { AdversaryDef } from "../src/lib/srd/types";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { expireParty } from "./campaignTime";
import { assertRunning, assertTextLength, assertWholeInRange, loadEncounter, loadInstance, MAX_INSTANCE_NOTE, MAX_INSTANCES, MAX_MINIONS, MAX_TAG, MAX_TAGS } from "./lib/encounters";
import { logAction, newGroupId } from "./lib/actionLog";
import { liveCombatMap, tokensOnMap } from "./lib/combatMaps";
import { FEAR_SPEND_REASONS, spendFear as spendCampaignFear } from "./lib/fear";
import { gmQuery, keyedGmMutation } from "./lib/functions";
import { adversaryDefeated } from "./lib/spotlight";
import { seenThisScene } from "./lib/spotlightSeen";
import { customAdversaryFields, encounterConditionValidator } from "./lib/validators/encounters";

/**
 * The live encounter tracker (D8 A4): HP and Stress per adversary instance, damage through thresholds, Minion
 * groups, conditions, tags, spotlights per GM turn and Fear spending. GM-only (GM wrappers: player FORBIDDEN,
 * outsider NOT_FOUND). Every mutation is keyed (a retried click applies once), sends an intent (a delta, a
 * condition, a count) and refuses with ENCOUNTER_NOT_RUNNING unless the encounter is running. The rules are the pure
 * functions in src/lib/domain/encounters/damage.ts and spotlight.ts, which the tracker's optimistic updates share.
 */

const SRD_BY_ID = new Map<string, AdversaryDef>(ADVERSARIES.map((a) => [a.id, a]));

const severityValidator = v.union(v.literal("none"), v.literal("minor"), v.literal("major"), v.literal("severe"), v.literal("defeat"));
const tracksResult = v.object({ hp: v.number(), stress: v.number(), defeated: v.boolean() });
const fearReasonValidator = v.union(...FEAR_SPEND_REASONS.map((r) => v.literal(r)));
const customBlockValidator = v.object({ _id: v.id("customAdversaries"), _creationTime: v.number(), ...customAdversaryFields });

/** The instance and its encounter, which must be running. */
async function loadRunning(ctx: MutationCtx, campaignId: Id<"campaigns">, instanceId: string) {
  const instance = await loadInstance(ctx, campaignId, instanceId);
  const encounter = await loadEncounter(ctx, campaignId, instance.encounterId);
  assertRunning(encounter);
  return { instance, encounter };
}

/** X of the instance's "Minion (X)" (SRD or custom block); null when unknown. */
async function minionX(ctx: MutationCtx, instance: Doc<"encounterAdversaries">): Promise<number | null> {
  if (instance.source.kind === "srd") {
    const def = SRD_BY_ID.get(instance.source.adversaryId);
    return def ? minionValue(def) : null;
  }
  const custom = await ctx.db.get("customAdversaries", instance.source.customId);
  if (custom === null) return null;
  for (const f of custom.features) {
    const m = /^Minion \((\d+)\)$/.exec(f.name);
    if (m) return Number(m[1]);
  }
  return null;
}

async function patchTracks(ctx: MutationCtx, instance: Doc<"encounterAdversaries">, hp: number, stress: number) {
  const defeated = isDefeated({ hp, hpMax: instance.stats.hpMax });
  await ctx.db.patch("encounterAdversaries", instance._id, { hp, stress, defeated, updatedAt: Date.now() });
  return { hp, stress, defeated };
}

const markArgs = { instanceId: v.string(), delta: v.number() };

/** Marks (positive) or clears (negative) HP, kept within the track. Defeated once every HP is marked (CB p.208). */
export const markHp = keyedGmMutation({
  args: markArgs,
  returns: tracksResult,
  handler: async (ctx, { instanceId, delta }) =>
    ctx.once("encounter_mark_hp", { instanceId, delta }, async () => {
      const { instance } = await loadRunning(ctx, ctx.campaign._id, instanceId);
      assertWholeInRange(delta, -MAX_MINIONS, MAX_MINIONS, "An HP change");
      const next = applyMark(instance, "hp", delta);
      return patchTracks(ctx, instance, next.hp, next.stress);
    }),
});

/** Marks or clears Stress; marking past a full track marks 1 HP instead (CB p.92, open question 2). */
export const markStress = keyedGmMutation({
  args: markArgs,
  returns: tracksResult,
  handler: async (ctx, { instanceId, delta }) =>
    ctx.once("encounter_mark_stress", { instanceId, delta }, async () => {
      const { instance } = await loadRunning(ctx, ctx.campaign._id, instanceId);
      assertWholeInRange(delta, -MAX_MINIONS, MAX_MINIONS, "A Stress change");
      const next = applyMark(instance, "stress", delta);
      return patchTracks(ctx, instance, next.hp, next.stress);
    }),
});

/**
 * Damage against the instance's thresholds (CB p.91; halved first when `resistant`, CB p.99): marks 1, 2 or 3 HP, or
 * every remaining HP for a block without thresholds. A Minion group marks nothing: the result suggests how many
 * Minions fall (CB p.201) and the GM confirms with `defeatMinions`.
 */
export const applyDamage = keyedGmMutation({
  args: { instanceId: v.string(), amount: v.number(), resistant: v.boolean() },
  returns: v.object({
    taken: v.number(),
    severity: severityValidator,
    marked: v.number(),
    suggestedDefeats: v.union(v.number(), v.null()),
    hp: v.number(),
    defeated: v.boolean(),
  }),
  handler: async (ctx, { instanceId, amount, resistant }) =>
    ctx.once("encounter_damage", { instanceId, amount, resistant }, async () => {
      const { instance } = await loadRunning(ctx, ctx.campaign._id, instanceId);
      assertWholeInRange(amount, 0, MAX_DAMAGE, "Damage");
      const taken = damageTaken(amount, resistant);
      const severity = damageSeverity(amount, instance.stats, resistant);
      const remaining = instance.stats.hpMax - instance.hp;
      if (instance.minionCount !== undefined) {
        const suggestedDefeats = minionDefeats(taken, await minionX(ctx, instance), remaining);
        return { taken, severity, marked: 0, suggestedDefeats, hp: instance.hp, defeated: instance.defeated };
      }
      const hp = hpForDamage(amount, instance.stats, resistant);
      const marked = hp === "all" ? remaining : Math.min(remaining, hp);
      const next = await patchTracks(ctx, instance, instance.hp + marked, instance.stress);
      return { taken, severity, marked, suggestedDefeats: null, hp: next.hp, defeated: next.defeated };
    }),
});

/** Defeats `count` Minions of a group (1 HP each): the group's remaining count shrinks; all gone = defeated. */
export const defeatMinions = keyedGmMutation({
  args: { instanceId: v.string(), count: v.number() },
  returns: v.object({ remaining: v.number(), defeated: v.boolean() }),
  handler: async (ctx, { instanceId, count }) =>
    ctx.once("encounter_defeat_minions", { instanceId, count }, async () => {
      const { instance } = await loadRunning(ctx, ctx.campaign._id, instanceId);
      if (instance.minionCount === undefined) throw appError("ENCOUNTER_RULE", "Only a Minion group has Minions to defeat.");
      assertWholeInRange(count, 1, MAX_MINIONS, "Minions to defeat");
      const next = await patchTracks(ctx, instance, Math.min(instance.stats.hpMax, instance.hp + count), instance.stress);
      return { remaining: instance.stats.hpMax - next.hp, defeated: next.defeated };
    }),
});

/**
 * Revives a defeated adversary (bead dcm-6c2o, user 2026-11-04: "Give the GM the option to revive a dead adversary"):
 * one step sets its marked HP and Stress (the GM's box starts at full health, 0 and 0) and clears the defeat. Defeat
 * today is the instance's `defeated` flag plus every HP marked (`adversaryDefeated`; a Minion group's HP are its fallen
 * Minions, so 0 HP marked brings the whole group back, `minionCount` never changes); the token's grey (`stats.down`),
 * the spotlight refusal (ADVERSARY_DEFEATED) and the attack / card target checks all read those two fields, so
 * clearing them reverses the defeat everywhere. Conditions, tags and effects stay as they were (defeat sets none).
 *
 * `hp` must leave at least one HP (or Minion) unmarked, 0..hpMax-1, and `stress` 0..stressMax (ENCOUNTER_RULE); an
 * adversary that is not defeated is refused (ENCOUNTER_RULE); the encounter must be running (ENCOUNTER_NOT_RUNNING).
 * Logged as one undoable GM-only row (kind `adversary`) carrying the instance before (`adversaryBefore`): the GM's undo
 * (`actionLog.undo`) puts it back to defeated with its previous marks.
 *
 * Players get a public feed line in the same group (dcm-bn14, user 2026-11-04): '<label> is back on its feet', the
 * label being the name its token and the spotlight show. While it is hidden from the players (`namedForPlayers`) the
 * line does not name it, as the interrupt's public line does not (convex/lib/spotlight.ts): 'An adversary is back on
 * its feet'. The GM's undo takes both lines back.
 */
export const reviveInstance = keyedGmMutation({
  args: { instanceId: v.string(), hp: v.number(), stress: v.number() },
  returns: tracksResult,
  handler: async (ctx, { instanceId, hp, stress }) =>
    ctx.once("encounter_revive", { instanceId, hp, stress }, async () => {
      const { instance } = await loadRunning(ctx, ctx.campaign._id, instanceId);
      if (!adversaryDefeated(instance)) throw appError("ENCOUNTER_RULE", "Only a defeated adversary can be revived.");
      const { hpMax, stressMax } = instance.stats;
      const minions = instance.minionCount !== undefined;
      assertWholeInRange(hp, 0, Math.max(0, hpMax - 1), minions ? "Fallen Minions" : "Marked HP");
      assertWholeInRange(stress, 0, stressMax, "Marked Stress");
      // Undo writes these back (`undoEntry`); revive changes nothing else on the row.
      const before = { instanceId: instance._id, hp: instance.hp, stress: instance.stress, defeated: instance.defeated };
      await ctx.db.patch("encounterAdversaries", instance._id, { hp, stress, defeated: false, updatedAt: Date.now() });
      const marks = minions ? `${hpMax - hp} of ${hpMax} Minions standing` : `${hp} of ${hpMax} HP marked`;
      const base = { campaignId: ctx.campaign._id, actorId: ctx.user._id, kind: "adversary" as const, groupId: newGroupId(), undoable: true };
      await logAction(ctx, {
        ...base,
        visibility: "gm",
        summary: `${instance.label} revived: ${marks}${stressMax > 0 ? `, ${stress} of ${stressMax} Stress marked` : ""}`,
        adversaryBefore: [before],
      });
      const who = (await namedForPlayers(ctx, instance)) ? instance.label : "An adversary";
      await logAction(ctx, { ...base, visibility: "public", summary: `${who} is back on its feet` });
      return { hp, stress, defeated: false };
    }),
});

/**
 * Whether a public line may name the adversary (dcm-bn14): the rule the spotlight follows for players
 * (`combatSpotlight.state`, user 2026-11-03). With a token on the live map, only once the party saw one of its tokens
 * this scene (`combatSeen`); off the map (no live map, or no token on it) the players know it by name, as its action
 * lines name it (convex/lib/adversaryActions.ts).
 */
async function namedForPlayers(ctx: MutationCtx, instance: Doc<"encounterAdversaries">): Promise<boolean> {
  const live = await liveCombatMap(ctx, instance.campaignId);
  if (live === null) return true;
  const own = (await tokensOnMap(ctx, live._id)).filter((t) => t.ref.kind === "adversary" && t.ref.adversaryId === instance._id);
  if (own.length === 0) return true;
  for (const token of own) if (await seenThisScene(ctx, instance.campaignId, token._id)) return true;
  return false;
}

/** Switches one condition on or off (CB p.102: the same condition can't stack). */
export const toggleCondition = keyedGmMutation({
  args: { instanceId: v.string(), condition: encounterConditionValidator },
  returns: v.object({ conditions: v.array(encounterConditionValidator) }),
  handler: async (ctx, { instanceId, condition }) =>
    ctx.once("encounter_condition", { instanceId, condition }, async () => {
      const { instance } = await loadRunning(ctx, ctx.campaign._id, instanceId);
      const { conditions } = applyCondition(instance, condition);
      await ctx.db.patch("encounterAdversaries", instance._id, { conditions, updatedAt: Date.now() });
      return { conditions };
    }),
});

/** The GM's own condition labels (Cursed, Glowing, …): trimmed, blanks and repeats dropped, at most 6 of 30 characters. */
export const setTags = keyedGmMutation({
  args: { instanceId: v.string(), tags: v.array(v.string()) },
  returns: v.object({ tags: v.array(v.string()) }),
  handler: async (ctx, { instanceId, tags: raw }) =>
    ctx.once("encounter_tags", { instanceId, tags: raw }, async () => {
      const { instance } = await loadRunning(ctx, ctx.campaign._id, instanceId);
      const tags = [...new Set(raw.map((t) => t.trim()).filter((t) => t !== ""))];
      if (tags.length > MAX_TAGS) throw appError("ENCOUNTER_RULE", `An adversary can carry at most ${MAX_TAGS} tags.`);
      for (const tag of tags) assertTextLength(tag, MAX_TAG, "A tag");
      await ctx.db.patch("encounterAdversaries", instance._id, { tags, updatedAt: Date.now() });
      return { tags };
    }),
});

/** A note on the instance (at most 500 characters); blank clears it. */
export const setNote = keyedGmMutation({
  args: { instanceId: v.string(), note: v.string() },
  returns: v.null(),
  handler: async (ctx, { instanceId, note }) =>
    ctx.once("encounter_note", { instanceId, note }, async () => {
      const { instance } = await loadRunning(ctx, ctx.campaign._id, instanceId);
      assertTextLength(note, MAX_INSTANCE_NOTE, "A note");
      await ctx.db.patch("encounterAdversaries", instance._id, { note: note.trim() === "" ? undefined : note, updatedAt: Date.now() });
      return null;
    }),
});

/**
 * Counts one spotlight for the encounter's current GM turn (CB p.153, p.195). Past the limit the tracker warns; the
 * server never refuses (open question 5). Fear is not taken here: the GM uses "Spend Fear". A defeated adversary
 * can't be spotlighted (ADVERSARY_DEFEATED, user 2026-11-04).
 */
export const spotlight = keyedGmMutation({
  args: { instanceId: v.string() },
  returns: v.object({ spotlights: v.number(), gmTurn: v.number(), fearSpent: v.boolean() }),
  handler: async (ctx, { instanceId }) =>
    ctx.once("encounter_spotlight", { instanceId }, async () => {
      const { instance, encounter } = await loadRunning(ctx, ctx.campaign._id, instanceId);
      if (adversaryDefeated(instance)) throw appError("ADVERSARY_DEFEATED");
      // Every spotlight after the first in a GM turn spends 1 Fear (CB p.153); FEAR_EMPTY when the GM has none.
      const all = await ctx.db
        .query("encounterAdversaries")
        .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
        .take(MAX_INSTANCES + 1);
      const fearSpent = spotlightCostsFear(turnSpotlights(all, encounter.gmTurn));
      if (fearSpent) await spendCampaignFear(ctx, ctx.campaign._id, 1, "move");
      const { spotlights, spotlightTurn } = applySpotlight(instance, encounter.gmTurn);
      await ctx.db.patch("encounterAdversaries", instance._id, { spotlights, spotlightTurn, updatedAt: Date.now() });
      return { spotlights, gmTurn: spotlightTurn, fearSpent };
    }),
});

/**
 * Ends the GM turn: `gmTurn` + 1. Spotlight counts reset because each instance's count is only read for the turn it
 * was stored in (no write to every instance). The party's feature uses limited to a GM turn end
 * (`expire(sheet, "gmTurn")`, one undoable actionLog group; nothing to end writes nothing).
 */
export const endGmTurn = keyedGmMutation({
  args: { encounterId: v.string() },
  returns: v.object({ gmTurn: v.number() }),
  handler: async (ctx, { encounterId }) =>
    ctx.once("encounter_end_gm_turn", { encounterId }, async () => {
      const encounter = await loadEncounter(ctx, ctx.campaign._id, encounterId);
      assertRunning(encounter);
      const gmTurn = encounter.gmTurn + 1;
      await ctx.db.patch("encounters", encounter._id, { gmTurn, updatedAt: Date.now() });
      // Plan lanes-2 CT (dcm-gfk3): uses limited to a GM turn end with it, logged as one undoable group.
      await expireParty(ctx, ctx.campaign, ctx.user._id, "gmTurn", `GM turn ${encounter.gmTurn} ended`);
      return { gmTurn };
    }),
});

/**
 * Spends GM Fear during the encounter (CB p.154: interrupt, an additional GM move, a Fear Feature, an Experience),
 * lowering the dashboard's Fear and writing a history row; FEAR_EMPTY when the GM holds less than `amount`.
 * `instanceId`, when given, must be one of this encounter's adversaries.
 */
export const spendFear = keyedGmMutation({
  args: { encounterId: v.string(), amount: v.number(), reason: fearReasonValidator, instanceId: v.optional(v.string()) },
  returns: v.object({ fear: v.number() }),
  handler: async (ctx, { encounterId, amount, reason, instanceId }) =>
    ctx.once("encounter_spend_fear", { encounterId, amount, reason, instanceId: instanceId ?? null }, async () => {
      const encounter = await loadEncounter(ctx, ctx.campaign._id, encounterId);
      assertRunning(encounter);
      if (instanceId !== undefined) {
        const instance = await loadInstance(ctx, ctx.campaign._id, instanceId);
        if (instance.encounterId !== encounter._id) throw appError("NOT_FOUND");
      }
      const { newValue } = await spendCampaignFear(ctx, ctx.campaign._id, amount, reason);
      return { fear: newValue };
    }),
});

/**
 * The custom stat blocks the encounter's instances come from (for the tracker's parchment stat block); SRD blocks are
 * bundled with the client. Deleted or other campaigns' blocks are left out.
 */
export const customBlocks = gmQuery({
  args: { encounterId: v.string() },
  returns: v.array(customBlockValidator),
  handler: async (ctx, { encounterId }) => {
    const id = ctx.db.normalizeId("encounters", encounterId);
    const encounter = id === null ? null : await ctx.db.get("encounters", id);
    if (encounter === null || encounter.campaignId !== ctx.campaign._id) return [];
    const rows = await ctx.db
      .query("encounterAdversaries")
      .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
      .take(MAX_INSTANCES);
    const ids = [...new Set(rows.flatMap((r) => (r.source.kind === "custom" ? [r.source.customId] : [])))];
    const blocks: Doc<"customAdversaries">[] = [];
    for (const customId of ids) {
      const block = await ctx.db.get("customAdversaries", customId);
      if (block !== null && block.campaignId === ctx.campaign._id) blocks.push(block);
    }
    return blocks;
  },
});
