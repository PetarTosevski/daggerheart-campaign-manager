import { v } from "convex/values";

import { markStress } from "../src/lib/domain/characters/index";
import { withEffects } from "../src/lib/domain/characters/effects";
import { appError } from "../src/lib/errors/app-error";
import { featureEffect } from "../src/lib/srd/feature-effects/index";
import { FOCUS_HOLD_MAX, type CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction } from "./lib/actionLog";
import { cardChoicesValidator, cardRollValidator, keepDice, keptDice, parseChoices, type CardChoice, type CardRoll } from "./lib/cardChoices";
import { handSharedWithPlayers } from "./lib/cardHand";
import { needsChoiceValidator, pendingCardValidator } from "./lib/cardRows";
import { buildRun, replaying, runCard, type BuiltRun, type RunOutcome } from "./lib/cardRunner";
import { assertCanAct, loadCharacter, readSheet, saveSheet } from "./lib/characterSheet";
import { attackScene } from "./lib/combatActions";
import { closeRequest, encounterRunning, loadOpenRequest, openRequests } from "./lib/combatRequests";
import { rollDie } from "./lib/dice";
import { drawerOf, drawerValidator, FLYING_FEATURES, REFOCUS_KEY } from "./lib/featureDrawer";
import {
  FLYING_EFFECT_ID,
  featureSlot,
  needsMap,
  ownedHere,
  partyFor,
  pickFeature,
  resolveFeatureUse,
  resolvedFeatureValidator,
  splitFeatureChoices,
  type FeatureUseRequest,
} from "./lib/featureRunner";
import { campaignFearState } from "./lib/fear";
import { campaignQuery, keyedCampaignMutation, keyedGmMutation } from "./lib/functions";
import { atLeast } from "./lib/permissions";
import { rangeBandValidator } from "./lib/validators/combatRequests";

/**
 * Features on the Combat Map sheet drawer (plan sheet-drawer, tracer SD3; docs/tasks/TASK-SD-SD3.md). Players act for a
 * character they edit (their own; the GM any, CA6's "Play for this character"): campaign wrappers with `need: "view"`,
 * then `loadCharacter(..., "edit")`, so another player's character is FORBIDDEN and an outsider NOT_FOUND (CF2).
 *
 * - `drawer`: trackers, every owned feature with its state, badges, tokens and uses, the D5 counters (featureDrawer.ts).
 *   The character's player and the GM always; another player only while hands are shared (as `combatCards.hand`).
 * - `useFeature`: uses an owned feature from the map (or, for self and party uses, without one): ownership, limits and
 *   costs, the roll, enemy instances, self and allies through the card path; one undoable actionLog group (U1, U4). A
 *   target outside the use's range waits for the GM (combat-actions Q1).
 * - `pending` / `sanction` (GM): the feature sanctions (`combatRequests` kind `sanction`, action kind `feature`).
 * - `setFlying` (Q16), `shiftStance` and `refocus` (Q5, HF p.12): keyed intents on the sheet, undoable.
 *
 * What a player receives never holds an enemy's HP, Stress, thresholds or Difficulty (U1).
 */

async function editableHere(ctx: QueryCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, characterId: Id<"characters">) {
  const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
  if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
  return { campaign, character, sheet: readSheet(character.sheet) };
}

const LAST_ROLL_SCAN = 20;

async function lastRollWithHope(ctx: QueryCtx, characterId: Id<"characters">): Promise<boolean> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(LAST_ROLL_SCAN);
  const last = rows.find((r) => r.undoneAt === undefined && r.roll?.kind === "action");
  return last?.roll?.outcome === "successHope" || last?.roll?.outcome === "critical";
}

export const drawer = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters") },
  returns: drawerValidator,
  handler: async (ctx, { characterId }) => {
    const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "view", "owner");
    if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
    if (!atLeast(permission, "edit") && !handSharedWithPlayers(campaign, character)) throw appError("FORBIDDEN");
    return drawerOf(characterId, readSheet(character.sheet), campaign);
  },
});

// ---------------------------------------------------------------- using a feature

type UseInput = { featureId: string; useId?: string; targetTokenIds: readonly string[]; choices: readonly CardChoice[]; roll?: CardRoll };

/** Checks, picks and builds a feature use (shared by `useFeature` and the GM's approval). */
async function prepare(ctx: QueryCtx, campaign: Doc<"campaigns">, character: Doc<"characters">, sheet: CharacterSheet, mapId: Id<"combatMaps"> | undefined, input: UseInput) {
  assertCanAct(character, sheet);
  const { rest, times, dieIndexes } = splitFeatureChoices(input.choices);
  const parsed = parseChoices(rest);
  const entry = featureEffect(input.featureId);
  const offMapTargets = input.targetTokenIds.length > 0 || parsed.picked.length > 0 || parsed.allies.length > 0 || parsed.followUp.length > 0;
  const scene = mapId === undefined ? null : await attackScene(ctx, campaign, character, mapId);
  const party = await partyFor(ctx, campaign._id, character._id, scene, (c) => readSheet(c.sheet));
  const roll = input.roll ?? {};
  const pick = pickFeature({
    sheet,
    campaign,
    featureId: input.featureId,
    useId: input.useId,
    times,
    ...(dieIndexes ? { dieIndexes } : {}),
    rollUsedExperience: (roll.experienceIds?.length ?? 0) > 0,
    party,
  });
  if (scene === null && (offMapTargets || (entry !== undefined && needsMap(entry, pick.use.id)))) throw appError("FEATURE_NEEDS_MAP");
  const req: FeatureUseRequest = { campaign, character, sheet, scene, pick, targetTokenIds: input.targetTokenIds, choices: input.choices, roll };
  const fear = await campaignFearState(ctx, campaign._id);
  const built = await buildRun(ctx, {
    campaign,
    character,
    sheet,
    scene,
    pick,
    targetTokenIds: input.targetTokenIds,
    choices: parsed,
    roll,
    gmFear: fear.fear,
    lastRollWithHope: await lastRollWithHope(ctx, character._id),
  });
  return { req, built };
}

async function runKept(ctx: MutationCtx, req: FeatureUseRequest, built: BuiltRun, userId: Id<"users">): Promise<RunOutcome> {
  const kept = await keptDice(ctx, featureSlot(req));
  const outcome = runCard(built, req.pick, kept ? replaying(kept, rollDie) : rollDie);
  if (outcome.kind === "needsChoice") await keepDice(ctx, featureSlot(req), outcome.dice, userId);
  return outcome;
}

const useArgs = {
  characterId: v.id("characters"),
  /** The live map; absent for a self or party use made without one. */
  mapId: v.optional(v.id("combatMaps")),
  featureId: v.string(),
  /** The use (`CardUse.id`); default the feature's first action use. */
  useId: v.optional(v.string()),
  targetTokenIds: v.array(v.id("combatTokens")),
  /** As `combatCards.useCard`, plus `{id: "times", value: n}` (CB p.107) and `{id: "dieIndexes", value: ["0"]}`. */
  choices: cardChoicesValidator,
  roll: v.optional(cardRollValidator),
};

/**
 * Uses an owned feature. Refusals: FEATURE_NOT_OWNED, FEATURE_NOT_COMBAT (out of combat, narrative, passive, not yet
 * automated), FEATURE_EXHAUSTED, FEATURE_COST_UNPAID, FEATURE_NEEDS_MAP (targets without a live map), INVALID (an
 * unconfirmed situation, a repeat on a roll, a bad choice), COMBAT_* for targets, CHARACTER_UNAVAILABLE. Out of range:
 * `pending` (combat-actions Q1), nothing paid. A missing choice: `needsChoice`, nothing written.
 */
export const useFeature = keyedCampaignMutation({
  need: "view",
  rateLimit: "roll",
  args: useArgs,
  returns: v.union(resolvedFeatureValidator, pendingCardValidator, needsChoiceValidator),
  handler: async (ctx, args) =>
    ctx.once("combat_feature", args, async () => {
      const { campaign, character, sheet } = await editableHere(ctx, args.characterId);
      const { req, built } = await prepare(ctx, campaign, character, sheet, args.mapId, args);
      const outcome = await runKept(ctx, req, built, ctx.user._id);
      if (outcome.kind === "needsChoice") return { status: "needsChoice" as const, asks: outcome.asks };
      if (built.outOfRange.length === 0) return resolveFeatureUse(ctx, req, built, outcome, ctx.user._id);

      await keepDice(ctx, featureSlot(req), outcome.dice, ctx.user._id);
      const encounter = built.targets.find((t) => t.kind === "enemy");
      const scene = built.creatures.scene;
      const requestId = await ctx.db.insert("combatRequests", {
        campaignId: campaign._id,
        ...(encounter?.kind === "enemy" ? { encounterId: encounter.encounter._id } : {}),
        mapId: scene.map._id,
        kind: "sanction",
        status: "open",
        createdBy: ctx.user._id,
        createdAt: Date.now(),
        responses: [],
        payload: {
          schemaVersion: 1,
          kind: "sanction",
          characterId: character._id,
          action: { kind: "feature", featureId: args.featureId, useId: req.pick.use.id, targetTokenIds: args.targetTokenIds, choices: args.choices, ...(args.roll ? { roll: args.roll } : {}) },
          outOfRange: built.outOfRange,
        },
      });
      return { status: "pending" as const, requestId, outOfRange: built.outOfRange };
    }),
});

/**
 * The GM approves or declines a feature use waiting for them (Q1). Approving re-checks everything but the range and
 * resolves with the player who asked as the rows' actor. REQUEST_NOT_OPEN once answered; NOT_FOUND for another campaign's
 * request or one that is not a feature sanction.
 */
export const sanction = keyedGmMutation({
  rateLimit: "roll",
  args: { requestId: v.id("combatRequests"), approve: v.boolean() },
  returns: v.union(resolvedFeatureValidator, needsChoiceValidator, v.object({ status: v.literal("declined") })),
  handler: async (ctx, { requestId, approve }) =>
    ctx.once("combat_feature_sanction", { requestId, approve }, async () => {
      const row = await loadOpenRequest(ctx, ctx.campaign._id, requestId);
      if (row.payload.kind !== "sanction" || row.payload.action.kind !== "feature") throw appError("NOT_FOUND");
      if (!approve || !(await encounterRunning(ctx, row))) {
        await closeRequest(ctx, row._id, "declined", ctx.user._id);
        return { status: "declined" as const };
      }
      const { characterId, action } = row.payload;
      const character = await ctx.db.get("characters", characterId);
      if (character === null || character.campaignId !== ctx.campaign._id || row.mapId === undefined) throw appError("COMBAT_TARGET_INVALID");
      const sheet = readSheet(character.sheet);
      const { req, built } = await prepare(ctx, ctx.campaign, character, sheet, row.mapId, action);
      const outcome = await runKept(ctx, req, built, ctx.user._id);
      if (outcome.kind === "needsChoice") return { status: "needsChoice" as const, asks: outcome.asks };
      const result = await resolveFeatureUse(ctx, req, built, outcome, row.createdBy);
      await closeRequest(ctx, row._id, "resolved", ctx.user._id);
      return result;
    }),
});

const namedToken = v.object({ tokenId: v.id("combatTokens"), name: v.string() });

/** A feature sanction as `pending` shows it: names and bands only (U1, CF6). */
const pendingView = v.object({
  requestId: v.id("combatRequests"),
  characterId: v.id("characters"),
  characterName: v.string(),
  featureId: v.string(),
  featureName: v.string(),
  useId: v.string(),
  createdAt: v.number(),
  targets: v.array(namedToken),
  outOfRange: v.array(v.object({ tokenId: v.id("combatTokens"), band: rangeBandValidator })),
});

async function nameOf(ctx: QueryCtx, row: Doc<"combatRequests">, tokenId: Id<"combatTokens">): Promise<string> {
  const token = await ctx.db.get("combatTokens", tokenId);
  if (token === null || token.campaignId !== row.campaignId) return "Unknown";
  if (token.ref.kind === "custom") return token.ref.name;
  if (token.ref.kind === "companion") return "Companion";
  if (token.ref.kind === "pc") {
    const character = await ctx.db.get("characters", token.ref.characterId);
    return character === null || character.campaignId !== row.campaignId ? "Unknown" : readSheet(character.sheet).name;
  }
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  return instance !== null && instance.campaignId === row.campaignId ? instance.label : "Unknown";
}

/** The open feature sanctions: a player's own, every one for the GM. Those of an ended encounter are left out. */
export const pending = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.array(pendingView),
  handler: async (ctx) => {
    const gm = ctx.permission === "owner";
    const views = [];
    for (const row of await openRequests(ctx, ctx.campaign._id)) {
      if (!gm && row.createdBy !== ctx.user._id) continue;
      const p = row.payload;
      if (p.kind !== "sanction" || p.action.kind !== "feature" || !(await encounterRunning(ctx, row))) continue;
      const targets = [];
      for (const tokenId of p.action.targetTokenIds) targets.push({ tokenId, name: await nameOf(ctx, row, tokenId) });
      const character = await ctx.db.get("characters", p.characterId);
      const sheet = character !== null && character.campaignId === row.campaignId ? readSheet(character.sheet) : null;
      const featureId = p.action.featureId;
      views.push({
        requestId: row._id,
        characterId: p.characterId,
        characterName: sheet?.name ?? "Unknown",
        featureId,
        featureName: (sheet ? ownedHere(sheet, ctx.campaign).find((f) => f.featureId === featureId)?.name : undefined) ?? featureId,
        useId: p.action.useId,
        createdAt: row.createdAt,
        targets,
        outOfRange: p.outOfRange,
      });
    }
    return views;
  },
});

// ---------------------------------------------------------------- Flying (Q16) and stances (Q5)

/** Saves the sheet and logs one undoable public row. */
async function writeIntent(ctx: MutationCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">, actorId: Id<"users">, before: CharacterSheet, after: CharacterSheet, summary: string) {
  await saveSheet(ctx, characterId, after);
  await logAction(ctx, { campaignId, characterId, actorId, kind: "feature", visibility: "public", summary, before, undoable: true });
}

/**
 * Q16 (CB p.57 Wings: "You can fly. While flying, …"): the Flying toggle, a sheet effect until turned off, for a character
 * holding a feature that lets them fly (FEATURE_NOT_OWNED otherwise). The "while flying" features read it.
 */
export const setFlying = keyedCampaignMutation({
  need: "view",
  args: { characterId: v.id("characters"), flying: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { characterId, flying }) =>
    ctx.once("combat_feature_flying", { characterId, flying }, async () => {
      const { campaign, character, sheet } = await editableHere(ctx, characterId);
      if (!ownedHere(sheet, campaign).some((f) => FLYING_FEATURES.has(f.featureId))) throw appError("FEATURE_NOT_OWNED");
      const now = sheet.effects.some((e) => e.id === FLYING_EFFECT_ID);
      if (now === flying) return null;
      const effects = flying ? [...sheet.effects, { id: FLYING_EFFECT_ID, source: "Flying", text: "Flying", until: "manual" as const }].slice(-20) : sheet.effects.filter((e) => e.id !== FLYING_EFFECT_ID);
      await writeIntent(ctx, campaign._id, character._id, ctx.user._id, sheet, { ...sheet, effects }, flying ? `${sheet.name} takes to the air` : `${sheet.name} lands`);
      return null;
    }),
});

/** Flow State (HF p.11): "You can mark a Stress instead of spending a Focus to shift into a different stance." */
const FLOW_STATE = "subclass:martial-artist:flow-state";

/**
 * HF p.12, Shifting into Stances: "You can spend a Focus to shift into a martial stance and gain its effects. You can
 * shift only into stances you've marked as known. … If you are already in a stance when you shift into a different
 * stance, you automatically drop out of the previously active stance." `payWith: "stress"` needs Flow State.
 * FEATURE_STATE_MISSING without the Martial Artist's state; FEATURE_NOT_OWNED for an unknown stance (or Stress without
 * Flow State); FEATURE_COST_UNPAID without Focus; INVALID for the stance already active.
 */
export const shiftStance = keyedCampaignMutation({
  need: "view",
  args: { characterId: v.id("characters"), stance: v.string(), payWith: v.optional(v.union(v.literal("focus"), v.literal("stress"))) },
  returns: v.null(),
  handler: async (ctx, { characterId, stance, payWith }) =>
    ctx.once("combat_feature_stance", { characterId, stance, payWith }, async () => {
      const { campaign, character, sheet } = await editableHere(ctx, characterId);
      assertCanAct(character, sheet);
      const martial = sheet.classState.martial;
      if (martial === undefined) throw appError("FEATURE_STATE_MISSING");
      const held = ownedHere(sheet, campaign);
      const def = held.find((f) => f.featureId === `stance:martial-artist:${stance}`);
      if (def === undefined) throw appError("FEATURE_NOT_OWNED");
      if (martial.active === stance) throw appError("INVALID", `${def.name} is already your active stance.`);
      let next: CharacterSheet;
      if (payWith === "stress") {
        if (!held.some((f) => f.featureId === FLOW_STATE)) throw appError("FEATURE_NOT_OWNED");
        const { stress, hp } = markStress(sheet, 1);
        next = { ...sheet, stress, hp, classState: { ...sheet.classState, martial: { ...martial, active: stance } } };
      } else {
        if (martial.focus < 1) throw appError("FEATURE_COST_UNPAID");
        next = { ...sheet, classState: { ...sheet.classState, martial: { ...martial, active: stance, focus: martial.focus - 1 } } };
      }
      await writeIntent(ctx, campaign._id, character._id, ctx.user._id, sheet, next, `${sheet.name} shifts into ${def.name} (${payWith === "stress" ? "1 Stress" : "1 Focus"})`);
      return null;
    }),
});

/**
 * HF p.12, Focus: "Once per rest during a moment of calm, you can clear your mind and refocus your martial instincts.
 * Clear your Focus track, then roll a number of d6s equal to your Instinct and gain Focus equal to the highest result
 * rolled. You can hold a maximum of 6 Focus." The moment of calm is the player's confirmation (Q13, `calm: true`).
 * Once per rest (`featureUses` key, Q3). FEATURE_STATE_MISSING without the Martial Artist's state; FEATURE_EXHAUSTED once
 * used; INVALID without the confirmation.
 */
export const refocus = keyedCampaignMutation({
  need: "view",
  rateLimit: "roll",
  args: { characterId: v.id("characters"), calm: v.boolean() },
  returns: v.object({ dice: v.array(v.number()), focus: v.number() }),
  handler: async (ctx, { characterId, calm }) =>
    ctx.once("combat_feature_refocus", { characterId, calm }, async () => {
      const { campaign, character, sheet } = await editableHere(ctx, characterId);
      assertCanAct(character, sheet);
      const martial = sheet.classState.martial;
      if (martial === undefined) throw appError("FEATURE_STATE_MISSING");
      if (sheet.featureUses.some((u) => u.key === REFOCUS_KEY)) throw appError("FEATURE_EXHAUSTED");
      if (!calm) throw appError("INVALID", "Refocus needs a moment of calm.");
      const count = Math.max(0, withEffects(sheet).traits.instinct);
      const dice = Array.from({ length: count }, () => rollDie(6));
      const focus = Math.min(FOCUS_HOLD_MAX, Math.max(0, ...dice));
      const next: CharacterSheet = {
        ...sheet,
        classState: { ...sheet.classState, martial: { ...martial, focus } },
        featureUses: [...sheet.featureUses, { key: REFOCUS_KEY, until: "rest" }],
      };
      await writeIntent(ctx, campaign._id, character._id, ctx.user._id, sheet, next, `${sheet.name} refocuses: ${dice.length > 0 ? dice.join(", ") : "no dice"} → ${focus} Focus`);
      return { dice, focus };
    }),
});
