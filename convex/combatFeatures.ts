import { v } from "convex/values";

import { withEffects } from "../src/lib/domain/characters/effects";
import { withPassiveTraits } from "../src/lib/domain/characters/derived";
import { hopeMax } from "../src/lib/domain/characters/index";
import { appError } from "../src/lib/errors/app-error";
import { featureEffect } from "../src/lib/srd/feature-effects/index";
import type { CharacterSheet } from "../src/lib/validation/characters";
import { FOCUS_HOLD_MAX } from "../src/lib/validation/character-constants";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { setStance } from "./lib/stanceDrop";
import { markStressOn, unshakableText, type UnshakableRoll } from "./lib/unshakable";
import { cardChoicesValidator, cardRollValidator, keepDice, keptDice, parseChoices, type CardChoice, type CardRoll } from "./lib/cardChoices";
import { effectEndsOf, needsChoiceValidator, pendingCardValidator, type ChoiceAsks } from "./lib/cardRows";
import { actorSheetAfter, buildRun, replaying, runCard, type BuiltRun, type RunOutcome } from "./lib/cardRunner";
import type { RunPlan } from "../src/lib/domain/card-effects/run";
import type { CardUse } from "../src/lib/domain/card-effects/types";
import { MAX_AREA_COUNT } from "./lib/combatAreas";
import { afterUse, foldPcRolls, foldSteps, rerunWith, runWithRiders, autoUsesOn, rollHost, type RiderSheets, type Square } from "./combatCards";
import { companionFor, companionNumbers } from "./lib/companion";
import { assertCanAct, loadCharacter, readSheet, saveSheet, storedSheet } from "./lib/characterSheet";
import { attackScene, defaultOnRiders, riderOptions, riderOptionValidator, weaponSlotValidator, type Host, type RiderRun } from "./lib/combatActions";
import { outOfRangeRefusal, refusesOutOfRange } from "./combatActions";
import { closeRequest, encounterRunning, loadOpenRequest } from "./lib/combatRequests";
import { rollDie } from "./lib/dice";
import { FLYING_FEATURES, REFOCUS_KEY } from "./lib/featureDrawer";
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
  type ResolvedFeature,
} from "./lib/featureRunner";
import { campaignFearState } from "./lib/fear";
import { assertMayAct, useActKind } from "./lib/spotlight";
import { campaignQuery, keyedCampaignMutation, keyedGmMutation } from "./lib/functions";
import { traitIdValidator } from "./lib/validators/characters";
import { fearFor } from "./lib/fearVisibility";
import { featureScope } from "./lib/featureScope";
import { riderValidator, type Rider } from "./lib/validators/combatRequests";
import { changed } from "./lib/rolls";

/**
 * Features on the Combat Map sheet drawer (plan sheet-drawer, tracer SD3; docs/tasks/TASK-SD-SD3.md). Players act for a
 * character they edit (their own; the GM any, CA6's "Play for this character"): campaign wrappers with `need: "view"`,
 * then `loadCharacter(..., "edit")`, so another player's character is FORBIDDEN and an outsider NOT_FOUND (CF2).
 *
 * - `drawer`: trackers, every owned feature with its state, badges, tokens and uses, the D5 counters (featureDrawer.ts).
 *   The character's player and the GM always; another player only while hands are shared (as `combatCardsReads.hand`).
 * - `useFeature`: uses an owned feature from the map (or, for self and party uses, without one): ownership, limits and
 *   costs, the roll, enemy instances, self and allies through the card path; one undoable actionLog group (U1, U4). A
 *   target outside the use's range waits for the GM (combat-actions Q1).
 * - `pending` / `sanction` (GM): the feature sanctions (`combatRequests` kind `sanction`, action kind `feature`).
 * - `setFlying` (Q16), `shiftStance` and `refocus` (Q5, HF p.12): keyed intents on the sheet, undoable.
 *
 * The reads (`drawer`, `pending`) live in `combatFeaturesReads.ts` (dcm-uh6r), so the HUD's subscriptions do not load
 * the feature and card runners this module needs.
 *
 * What a player receives never holds an enemy's HP, Stress, thresholds or Difficulty (U1).
 */

async function editableHere(ctx: QueryCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, characterId: Id<"characters">) {
  const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
  if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
  // Config R2: `gm` (the GM or a co-GM acting for a PC) is never refused for range.
  return { campaign, character, sheet: readSheet(character.sheet), gm: permission === "owner" };
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

// ---------------------------------------------------------------- using a feature

type UseInput = { featureId: string; useId?: string; targetTokenIds: readonly string[]; choices: readonly CardChoice[]; roll?: CardRoll; point?: Square };

/**
 * Checks, picks and builds a feature use (shared by `useFeature` and the GM's approval). Plan lanes-2 E1.3a: `transform`
 * changes the use before it runs (the riders' damage changes, `foldSteps`); `heldDicePicks` goes to the pick (dcm-ef77:
 * which Prayer Dice to spend, CB p.44).
 */
async function prepare(ctx: QueryCtx, campaign: Doc<"campaigns">, character: Doc<"characters">, sheet: CharacterSheet, mapId: Id<"combatMaps"> | undefined, input: UseInput, transform?: (use: CardUse) => CardUse) {
  assertCanAct(character, sheet, campaign);
  const { rest, times, dieIndexes, heldDicePicks } = splitFeatureChoices(input.choices);
  const parsed = parseChoices(rest);
  const entry = featureEffect(input.featureId);
  const offMapTargets = input.targetTokenIds.length > 0 || parsed.picked.length > 0 || parsed.allies.length > 0 || parsed.followUp.length > 0;
  const scene = mapId === undefined ? null : await attackScene(ctx, campaign, character, mapId);
  const party = await partyFor(ctx, campaign._id, character._id, scene, (c) => readSheet(c.sheet));
  const roll = input.roll ?? {};
  // Plan lanes-2 E6 (dcm-b9hc (1)): the Beastbound companion's die, range and damage type (CB p.40-41).
  const companion = await companionFor(ctx, character._id);
  const pick = pickFeature({
    sheet,
    campaign,
    featureId: input.featureId,
    useId: input.useId,
    times,
    ...(dieIndexes ? { dieIndexes } : {}),
    ...(heldDicePicks ? { heldDicePicks } : {}),
    rollUsedExperience: (roll.experienceIds?.length ?? 0) > 0,
    party,
    companion: companion && companionNumbers(companion, sheet.level),
    ...(transform ? { transform } : {}),
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

/** dcm-m7tm: a plain feature use with the adversaries' `pcRolls` uses on its roll (`foldPcRolls`); only a resolving run. */
async function featurePcRolls(ctx: MutationCtx, req: FeatureUseRequest, built: BuiltRun, outcome: Extract<RunOutcome, { kind: "plan" }>): Promise<{ plan: RunPlan; lines: string[] }> {
  const folded = await foldPcRolls(ctx, { campaign: req.campaign, characterId: req.character._id, use: req.pick.use, trait: req.roll.trait }, outcome, async (dice, delta) => ({ outcome: rerunWith(built, req.pick, dice, delta) }));
  return { plan: folded.plan, lines: folded.lines };
}

const squareValidator = v.object({ x: v.number(), y: v.number() });

const useArgs = {
  characterId: v.id("characters"),
  /** The live map; absent for a self or party use made without one. */
  mapId: v.optional(v.id("combatMaps")),
  featureId: v.string(),
  /** The use (`CardUse.id`); default the feature's first action use. */
  useId: v.optional(v.string()),
  targetTokenIds: v.array(v.id("combatTokens")),
  /**
   * As `combatCards.useCard`, plus `{id: "times", value: n}` (CB p.107), `{id: "dieIndexes", value: ["0"]}` and
   * `{id: "heldDicePicks", value: [held die ids]}` (dcm-ef77, CB p.44 Prayer Dice).
   */
  choices: cardChoicesValidator,
  roll: v.optional(cardRollValidator),
  /** Plan lanes-2 E6 (dcm-u2wx): the square a `point`-centred area goes on (Dark Cloud, CB p.42: "a point ... within Close range"). */
  point: v.optional(squareValidator),
  /** Plan lanes-2 E1.3a: more squares after `point` (a wall's second end, a `count` area's others). */
  points: v.optional(v.array(squareValidator)),
  /**
   * Plan lanes-2 E1.3a (dcm-3s6e, dcm-1kvg): riders taken with the feature's action roll (as `combatCards.useCard`; Feed's
   * Fear Die, HF p.39). Automatic uses that fit the roll (Wolf Form's +1d10 on Fangs, HF p.40) ride without being sent.
   */
  riders: v.optional(v.array(riderValidator)),
  /** DA2 (CB p.48): `false` turns Rise to the Challenge's d20 Hope Die off for this roll. */
  riseToTheChallenge: v.optional(v.boolean()),
};

type Squares = { point?: Square; points?: readonly Square[] };

/**
 * Plan lanes-2 E6 (dcm-u2wx, dcm-9z2z, dcm-erhv) and E1.3a: after `resolveFeatureUse` saved the use, in its undo group,
 * `afterUse` (convex/combatCards.ts): what the use and its riders end, an ordinary Cloaked after a feature attack
 * (dcm-bxp.99.19.67, CB p.42), then the plan's map areas. A wall or a `point` area without its squares (the GM's approval
 * keeps none) is left for the table with a note. Returns the result with the lines added to its notes.
 */
async function afterFeatureUse(
  ctx: MutationCtx,
  input: { result: ResolvedFeature; req: FeatureUseRequest; before: CharacterSheet; built: BuiltRun; plan: RunPlan; actorId: Id<"users">; riderRuns?: readonly RiderRun[]; gmNotes?: readonly string[] } & Squares,
): Promise<ResolvedFeature> {
  const { result, req } = input;
  const out = await afterUse(ctx, {
    campaign: req.campaign,
    character: req.character,
    before: input.before,
    built: input.built,
    plan: input.plan,
    use: req.pick.use,
    sourceId: req.pick.featureId,
    name: req.pick.name,
    entryId: result.entryId,
    actorId: input.actorId,
    ...(input.riderRuns ? { riderRuns: input.riderRuns } : {}),
    ...(input.point ? { point: input.point } : {}),
    ...(input.points ? { points: input.points } : {}),
    ...(input.gmNotes ? { gmNotes: input.gmNotes } : {}),
  });
  const notes = [...result.notes, ...out.lines, ...out.byHand];
  return notes.length === result.notes.length ? result : { ...result, notes };
}

/**
 * Plan lanes-2 E1.3a (dcm-1kvg, dcm-3s6e; dcm-bn1, dcm-gvr): what a feature's action roll is to riders and automatic uses
 * (`rollHost`: `fromUse` = the feature and use, so Feed rides only on Fangs, HF p.39; a trait roll `asWeapon` is a weapon
 * attack, Elemental Breath, CB p.54). Null without an action roll.
 */
function featureHost(req: FeatureUseRequest): Host | null {
  return rollHost(req.sheet, req.pick.use, req.roll, parseChoices(splitFeatureChoices(req.choices).rest).weapon, { id: req.pick.featureId, useId: req.pick.use.id });
}

/** A feature use computed through the rider path, or the choice it still needs. */
type RiderResolved =
  | { status: "plan"; req: FeatureUseRequest; built: BuiltRun; plan: RunPlan; sheets: RiderSheets; runs: RiderRun[]; post: (entryId: Id<"actionLog">) => Promise<RiderRun[]>; pcLines: string[] }
  | { status: "needsChoice"; asks: ChoiceAsks };

/**
 * Whether a feature use goes through the rider path (its host), or null: riders were sent, or an automatic or default-on
 * rider fits its roll (on a map: riders need the scene). INVALID for riders on a use without an action roll;
 * FEATURE_NEEDS_MAP for riders off the map.
 */
function ridesWith(req: FeatureUseRequest, riders: readonly Rider[], riseOff: boolean): Host | null {
  const host = featureHost(req);
  if (riders.length > 0) {
    if (host === null) throw appError("INVALID", "Riders ride on a feature that makes an action roll.");
    if (req.scene === null) throw appError("FEATURE_NEEDS_MAP");
    return host;
  }
  if (host === null || req.scene === null) return null;
  if (autoUsesOn(req.sheet, req.campaign, host).length > 0) return host;
  return !riseOff && defaultOnRiders(req.sheet, req.campaign, host, false, []).length > 0 ? host : null;
}

/**
 * The rider path of a feature use (`runWithRiders`): the before-roll riders' costs paid, the feature picked and built again
 * on that sheet with their damage changes (`foldSteps` as the pick's `transform`), the riders on its result.
 */
async function featureWithRiders(ctx: MutationCtx, first: FeatureUseRequest, host: Host, mapId: Id<"combatMaps"> | undefined, input: UseInput, riders: readonly Rider[], actorId: Id<"users">, riseOff: boolean, resolving?: boolean): Promise<RiderResolved> {
  const scene = first.scene;
  if (scene === null) throw appError("FEATURE_NEEDS_MAP");
  let last = first;
  const out = await runWithRiders(
    ctx,
    {
      campaign: first.campaign,
      character: first.character,
      sheet: first.sheet,
      scene,
      host,
      targetTokenIds: first.targetTokenIds,
      roll: first.roll,
      slot: featureSlot(first),
      build: async (sheet, folds) => {
        const { req, built } = await prepare(ctx, first.campaign, first.character, sheet, mapId, input, (use) => foldSteps(use, folds));
        last = req;
        return { built, pick: req.pick };
      },
      ...(resolving !== undefined ? { resolving } : {}),
    },
    riders,
    actorId,
    riseOff,
  );
  if (out.kind === "needsChoice") return { status: "needsChoice", asks: out.outcome.asks };
  return { status: "plan", req: { ...last, sheet: out.sheet, pick: out.pick }, built: out.built, plan: out.plan, sheets: out.sheets, runs: out.runs, post: out.post, pcLines: out.pcLines };
}

/**
 * The after-roll riders' changes to the actor's sheet (`withRiders` against `without`, the sheet the runner gave the use
 * alone) put on `saved` (the sheet the resolver wrote): the tracks and Hope by difference, the effects, limits and tokens
 * the riders added or removed.
 */
function riderDelta(saved: CharacterSheet, without: CharacterSheet, withRiders: CharacterSheet): CharacterSheet {
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
  const effectIds = new Set(without.effects.map((e) => e.id));
  const effectsLeft = new Set(withRiders.effects.map((e) => e.id));
  const useKeys = new Set(without.featureUses.map((u) => u.key));
  const usesLeft = new Set(withRiders.featureUses.map((u) => u.key));
  const count = (list: CharacterSheet["cardTokens"], key: string) => (list ?? []).find((t) => t.cardId === key)?.count ?? 0;
  const keys = new Set([...(saved.cardTokens ?? []), ...(without.cardTokens ?? []), ...(withRiders.cardTokens ?? [])].map((t) => t.cardId));
  const tokens = [...keys].map((cardId) => ({ cardId, count: Math.max(0, count(saved.cardTokens, cardId) + count(withRiders.cardTokens, cardId) - count(without.cardTokens, cardId)) })).filter((t) => t.count > 0);
  return {
    ...saved,
    hope: clamp(saved.hope + withRiders.hope - without.hope, hopeMax(saved.scars, saved.hopeSlotBonus)),
    stress: clamp(saved.stress + withRiders.stress - without.stress, saved.stressMax),
    hp: clamp(saved.hp + withRiders.hp - without.hp, saved.hpMax),
    armorMarked: Math.max(0, saved.armorMarked + withRiders.armorMarked - without.armorMarked),
    effects: [...saved.effects.filter((e) => !effectIds.has(e.id) || effectsLeft.has(e.id)), ...withRiders.effects.filter((e) => !effectIds.has(e.id))],
    featureUses: [...saved.featureUses.filter((u) => !useKeys.has(u.key) || usesLeft.has(u.key)), ...withRiders.featureUses.filter((u) => !useKeys.has(u.key))],
    cardTokens: tokens,
  };
}

/**
 * Resolves a feature use that went through the rider path, in one undo group: `resolveFeatureUse` on the sheet after the
 * before-roll riders; the public row's `before` set back to the sheet before them (one undo returns their costs too); the
 * after-roll riders' sheet changes on top of what the resolver wrote (`riderDelta`); their `post` writes; `afterFeatureUse`.
 */
async function resolveWithRiders(ctx: MutationCtx, r: Extract<RiderResolved, { status: "plan" }>, actorId: Id<"users">, squares: Squares): Promise<ResolvedFeature> {
  const original = r.sheets.before;
  // The before-roll riders' costs are on the sheet first: the resolver writes only what the use itself changes.
  const paid = changed(original, r.req.sheet);
  if (paid) await saveSheet(ctx, r.req.character._id, r.req.sheet);
  const result = await resolveFeatureUse(ctx, r.req, r.built, { plan: r.plan }, actorId);
  const entry = await ctx.db.get("actionLog", result.entryId);
  if (entry !== null && paid) await ctx.db.patch("actionLog", entry._id, { characterId: r.req.character._id, before: JSON.stringify(storedSheet(original)) });
  const ownAfter = actorSheetAfter(r.built.paidSheet, r.plan, r.built.context.actor.id, r.req.pick.name);
  if (entry?.groupId !== undefined && changed(ownAfter, r.sheets.next)) {
    const now = await ctx.db.get("characters", r.req.character._id);
    if (now !== null) {
      const saved = readSheet(now.sheet);
      const next = riderDelta(saved, ownAfter, r.sheets.next);
      if (changed(saved, next)) {
        await saveSheet(ctx, now._id, next);
        await logAction(ctx, { campaignId: r.req.campaign._id, characterId: now._id, actorId, kind: "feature", visibility: "public", summary: `${saved.name}: ${r.sheets.names.join(", ") || "riders"}`.slice(0, 1000), groupId: entry.groupId, before: saved, undoable: true });
      }
    }
  }
  const postRuns = await r.post(result.entryId);
  const named = r.sheets.names.length > 0 ? { ...result, notes: [...result.notes, ...r.sheets.names] } : result;
  return afterFeatureUse(ctx, { result: named, req: r.req, before: original, built: r.built, plan: r.plan, actorId, riderRuns: [...r.runs, ...postRuns], gmNotes: r.pcLines, ...squares });
}

/**
 * Q1: an out-of-range feature use waits for the GM as a `sanction` request. Plan lanes-2 E1.4a (dcm-mcgj; V4's feature
 * `sanctionAction.riders`): the riders the player sent are stored and the approval replays them with the automatic and
 * default-on ones.
 */
async function openSanction(
  ctx: MutationCtx & { user: Doc<"users"> },
  input: { campaign: Doc<"campaigns">; character: Doc<"characters">; built: BuiltRun; args: UseInput & { targetTokenIds: Id<"combatTokens">[] }; useId: string; riseOff: boolean; riders: readonly Rider[] },
) {
  const { campaign, character, built, args, riseOff } = input;
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
      action: {
        kind: "feature",
        featureId: args.featureId,
        useId: input.useId,
        targetTokenIds: args.targetTokenIds,
        choices: [...args.choices],
        ...(args.roll || riseOff ? { roll: { ...args.roll, ...(riseOff ? { riseToTheChallenge: false } : {}) } } : {}),
        // dcm-0x2g: the point area's square, replayed on approval (E2.3 widened the payload).
        ...(args.point ? { point: args.point } : {}),
        ...(input.riders.length > 0 ? { riders: [...input.riders] } : {}),
      },
      outOfRange: built.outOfRange,
    },
  });
  return { status: "pending" as const, requestId, outOfRange: built.outOfRange };
}

/**
 * dcm-bxp.99.32.19 (plan combat-hud H3.3): the riders that ride on a feature's own action roll, as
 * `combatActionsReads.riders` gives them for a weapon attack: the same `riderOptions` over the feature's host (`rollHost`
 * with `fromUse` = the feature and use, upgrades applied by `pickFeature`; `trait` for a use whose roll lets the player
 * pick it, `weapon` for an attack with either weapon). Empty for a use without an action roll. Access: edit on the
 * character (its player or the GM; another player FORBIDDEN, U1). FEATURE_NOT_OWNED / FEATURE_NOT_COMBAT / INVALID as
 * `useFeature` refuses the pick.
 */
export const riders = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters"), featureId: v.string(), useId: v.optional(v.string()), trait: v.optional(traitIdValidator), weapon: v.optional(weaponSlotValidator) },
  returns: v.array(riderOptionValidator),
  handler: async (ctx, { characterId, featureId, useId, trait, weapon }) => {
    const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
    if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
    const sheet = readSheet(character.sheet);
    const pick = pickFeature({ sheet, campaign, featureId, useId, times: 1, rollUsedExperience: false, party: [] });
    const host = rollHost(sheet, pick.use, trait ? { trait } : {}, weapon, { id: featureId, useId: pick.use.id });
    return host === null ? [] : riderOptions(sheet, campaign, host);
  },
});

/**
 * Uses an owned feature. Refusals: FEATURE_NOT_OWNED, FEATURE_NOT_COMBAT (out of combat, narrative, passive, not yet
 * automated), FEATURE_EXHAUSTED, FEATURE_COST_UNPAID, FEATURE_NEEDS_MAP (targets or riders without a live map), INVALID
 * (an unconfirmed situation, a repeat on a roll, a bad choice, riders on a use without an action roll), COMBAT_* for
 * targets, CHARACTER_UNAVAILABLE. Out of range: `pending` (combat-actions Q1), nothing paid. A missing choice:
 * `needsChoice`, nothing written. Plan lanes-2 E1.3a (dcm-1kvg): riders and automatic uses ride on its action roll.
 */
export const useFeature = keyedCampaignMutation({
  need: "view",
  rateLimit: "roll",
  args: useArgs,
  returns: v.union(resolvedFeatureValidator, pendingCardValidator, needsChoiceValidator),
  handler: async (ctx, args) =>
    fearFor(ctx, ctx.user, ctx.campaign, await ctx.once("combat_feature", args, async () => {
      const { campaign, character, sheet, gm } = await editableHere(ctx, args.characterId);
      // Config R2 (Q2 a): a player's use with a target out of its range is refused when the GM refuses them.
      const refuse = refusesOutOfRange(campaign, gm);
      if ((args.points?.length ?? 0) > MAX_AREA_COUNT) throw appError("INVALID", `At most ${MAX_AREA_COUNT} squares.`);
      const squares: Squares = { ...(args.point ? { point: args.point } : {}), ...(args.points ? { points: args.points } : {}) };
      const riders = args.riders ?? [];
      const riseOff = args.riseToTheChallenge === false;
      const { req, built } = await prepare(ctx, campaign, character, sheet, args.mapId, args);
      // S2 (plan rule-switches RS2): a feature's action waits while the GM holds the spotlight; a reaction never does.
      await assertMayAct(ctx, campaign, character, useActKind(req.pick.use), sheet.name);
      const host = ridesWith(req, riders, riseOff);
      if (host !== null) {
        const withRiders = await featureWithRiders(ctx, req, host, args.mapId, args, riders, ctx.user._id, riseOff);
        if (withRiders.status === "needsChoice") return { status: "needsChoice" as const, asks: withRiders.asks };
        if (withRiders.built.outOfRange.length === 0) return resolveWithRiders(ctx, withRiders, ctx.user._id, squares);
        if (refuse) throw outOfRangeRefusal(withRiders.built.outOfRange);
        // Q1: wait for the GM; the approval runs the feature and its riders (the sent ones are stored) again.
        return openSanction(ctx, { campaign, character, built: withRiders.built, args, useId: req.pick.use.id, riseOff, riders });
      }
      if (refuse && built.outOfRange.length > 0) throw outOfRangeRefusal(built.outOfRange);
      const outcome = await runKept(ctx, req, built, ctx.user._id);
      if (outcome.kind === "needsChoice") return { status: "needsChoice" as const, asks: outcome.asks };
      if (built.outOfRange.length === 0) {
        const folded = await featurePcRolls(ctx, req, built, outcome);
        const result = await resolveFeatureUse(ctx, req, built, { ...outcome, plan: folded.plan }, ctx.user._id);
        return afterFeatureUse(ctx, { result, req, before: sheet, built, plan: folded.plan, actorId: ctx.user._id, gmNotes: folded.lines, ...squares });
      }
      await keepDice(ctx, featureSlot(req), outcome.dice, ctx.user._id);
      return openSanction(ctx, { campaign, character, built, args, useId: req.pick.use.id, riseOff: false, riders: [] });
    }), "fearDelta", ctx.permission),
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
      const riseOff = action.roll?.riseToTheChallenge === false;
      // dcm-mcgj: the riders the player sent with the use, replayed.
      const riders = action.riders ?? [];
      const host = ridesWith(req, riders, riseOff);
      // dcm-0x2g: the square the player picked for a point area (the payload keeps `point` only, not `points`).
      const squares: Squares = action.point ? { point: action.point } : {};
      let result: ResolvedFeature;
      if (host !== null) {
        const withRiders = await featureWithRiders(ctx, req, host, row.mapId, action, riders, row.createdBy, riseOff, true);
        if (withRiders.status === "needsChoice") return { status: "needsChoice" as const, asks: withRiders.asks };
        result = await resolveWithRiders(ctx, withRiders, row.createdBy, squares);
      } else {
        const outcome = await runKept(ctx, req, built, ctx.user._id);
        if (outcome.kind === "needsChoice") return { status: "needsChoice" as const, asks: outcome.asks };
        const folded = await featurePcRolls(ctx, req, built, outcome);
        const resolved = await resolveFeatureUse(ctx, req, built, { ...outcome, plan: folded.plan }, row.createdBy);
        result = await afterFeatureUse(ctx, { result: resolved, req, before: sheet, built, plan: folded.plan, actorId: row.createdBy, gmNotes: folded.lines, ...squares });
      }
      await closeRequest(ctx, row._id, "resolved", ctx.user._id);
      return result;
    }),
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
      assertCanAct(character, sheet, campaign);
      const martial = sheet.classState.martial;
      if (martial === undefined) throw appError("FEATURE_STATE_MISSING");
      const held = ownedHere(sheet, campaign);
      const def = held.find((f) => f.featureId === `stance:martial-artist:${stance}`);
      if (def === undefined) throw appError("FEATURE_NOT_OWNED");
      if (martial.active === stance) throw appError("INVALID", `${def.name} is already your active stance.`);
      let paid: CharacterSheet;
      let unshakable: UnshakableRoll | null = null;
      if (payWith === "stress") {
        if (!held.some((f) => f.featureId === FLOW_STATE)) throw appError("FEATURE_NOT_OWNED");
        // DA10: Unshakable (CB p.59) rolls its d6 on this Stress too.
        const marked = markStressOn(sheet, 1);
        unshakable = marked.roll;
        paid = marked.sheet;
      } else {
        if (martial.focus < 1) throw appError("FEATURE_COST_UNPAID", undefined, { resource: "focus", need: 1, have: martial.focus });
        paid = { ...sheet, classState: { ...sheet.classState, martial: { ...martial, focus: martial.focus - 1 } } };
      }
      // DA10 / lane E6 (HF p.12, dcm-awh): the previous stance drops with what ends with it (Grappling's Restrain,
      // dcm-bxp.99.19.10; the stance's own `stanceDrops` effects), then the new stance is active (`setStance`).
      const shifted = await setStance(ctx, campaign._id, paid, stance, (e) => effectEndsOf(e));
      if (shifted === null) throw appError("FEATURE_NOT_OWNED");
      const next = shifted.sheet;
      const ended = shifted.lines.length > 0 ? `; ${shifted.lines.join("; ")}` : "";
      const summary = `${sheet.name} shifts into ${def.name} (${payWith === "stress" ? "1 Stress" : "1 Focus"}${unshakable ? `; ${unshakableText(unshakable)}` : ""})${ended}`;
      if (shifted.before.length > 0) {
        const groupId = newGroupId();
        await saveSheet(ctx, character._id, next);
        await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId: ctx.user._id, kind: "feature", visibility: "public", summary, groupId, before: sheet, undoable: true });
        await logAction(ctx, { campaignId: campaign._id, actorId: ctx.user._id, kind: "feature", visibility: "gm", summary: `${sheet.name}'s stance dropped: ${shifted.lines.join("; ")}`, groupId, adversaryBefore: shifted.before, undoable: true });
      } else await writeIntent(ctx, campaign._id, character._id, ctx.user._id, sheet, next, summary);
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
      assertCanAct(character, sheet, campaign);
      const martial = sheet.classState.martial;
      if (martial === undefined) throw appError("FEATURE_STATE_MISSING");
      if (sheet.featureUses.some((u) => u.key === REFOCUS_KEY)) throw appError("FEATURE_EXHAUSTED");
      if (!calm) throw appError("INVALID", "Refocus needs a moment of calm.");
      const count = Math.max(0, withPassiveTraits(withEffects(sheet), featureScope(campaign)).traits.instinct);
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
