import { v } from "convex/values";

import { adversaryCountdownArmed, adversaryCountdownLabels, adversaryCountdownName, countdownLabelBonus } from "../src/lib/domain/adversary-actions/index";
import { COUNTDOWN_DICE_SIDES, MAX_COUNTDOWN_DICE, startFromDice } from "../src/lib/domain/countdowns/advanced";
import { COUNTDOWN_VISIBILITY_PRESETS, MAX_COUNTDOWN_START } from "../src/lib/domain/countdowns/index";
import { parseCountdownLabel } from "../src/lib/domain/countdowns/labels";
import { environmentCountdownCategory } from "../src/lib/domain/environments/index";
import { appError } from "../src/lib/errors/app-error";
import { COUNTDOWN_DETAILS_MAX_LENGTH } from "../src/lib/validation/countdowns";
import type { Id } from "./_generated/dataModel";
import { adversaryAction, afterHitTriggers, forcedStandardAttack, gmControlledAttack as gmControlledAttackOf, isPreRollRow, pcEscape as pcEscapeOf, replayHeld, respondPreRoll, type ActionArgs, type PreRollRow } from "./lib/adversaryActions";
import { blockOf, countdownTickOn, featureAsk as featureAskOf } from "./lib/adversaryFeatures";
import { rollDice } from "./lib/dice";
import { loadInstance } from "./lib/encounters";
import { recordHistory } from "./tables/history";
import { assertCanAct, loadCharacter, readSheet } from "./lib/characterSheet";
import { closeRequest, encounterRunning, loadOpenRequest } from "./lib/combatRequests";
import { gmQuery, keyedCampaignMutation, keyedGmMutation } from "./lib/functions";
import {
  groupUndone,
  hasAfterHit,
  isHitRow,
  partyMembers,
  resolveIncomingHit,
  respondAfterHit,
  respondToHit,
  type HitResolution,
  type HitRow,
} from "./lib/incomingHits";
import { rollValidator } from "./lib/validators/actionLog";
import { hitChoiceValidator, preRollFeatureChoiceValidator } from "./lib/validators/combatRequests";
import { traitIdValidator } from "./lib/validators/characters";

/**
 * Adversary actions against PCs (plan combat-actions, tracer AA2; docs/tasks/TASK-CA-AA2.md). The GM attacks with an
 * adversary or uses one of its features from the Encounter tab or the Combat Map (Q12, Q16); the server rolls, opens a
 * reaction window per hit PC (Q13), lets the target choose armor and allies answer with eligible cards (`respond`),
 * resolves when everyone answered or the GM says so (`resolve`, Q17), and logs it all as one undoable group (U4).
 * Players see that they were hit, never the roll; the hit PC sees their own damage and severity (`pending`, Q14).
 * The reads `pending` and `windows` are in adversaryActionsReads.ts (dcm-uh6r).
 */

const severityValidator = v.union(v.literal("none"), v.literal("minor"), v.literal("major"), v.literal("severe"));

/** The most entries of each list argument (situations, options, optionals, splits, reactions). */
const MAX_LIST = 20;

const sharedArgs = {
  instanceId: v.string(),
  /** Character ids, or PC token ids on the live map (Q18: any party PC without one). */
  targets: v.array(v.string()),
  advantage: v.optional(v.number()),
  disadvantage: v.optional(v.number()),
  /** An adversary Experience by name, added for 1 Fear (CB p.160). */
  experience: v.optional(v.string()),
  /** Fear the GM agreed to spend (Q19): Fear costs, an Experience, an extra spotlight. */
  spendFear: v.optional(v.number()),
  /** Reactions on this attack the GM opted into (Heavy Hitter, …; Q19 default No), by feature name. */
  reactions: v.optional(v.array(v.string())),
  /**
   * Lane E7 round 3 (dcm-eut): the PC feature ids whose "unless the attacker marks a Stress" disadvantage the attacker pays
   * off for this attack (Defensive stance, HF p.12); the attacker marks the cost. Unpaid ones come back in the GM feed.
   */
  buyOffs: v.optional(v.array(v.string())),
};

const featureArgs = {
  ...sharedArgs,
  /** The feature as printed on the stat block. */
  feature: v.string(),
  /** Which use of a multi-use feature; default its first action. */
  useId: v.optional(v.string()),
  picked: v.optional(v.array(v.string())),
  allies: v.optional(v.array(v.string())),
  followUp: v.optional(v.array(v.string())),
  /**
   * Lane E7, round 2 (dcm-e16o, dcm-7az): the creatures of each further link of a repeating follow-up (Rip & Tear, HF
   * p.76: "not already targeted"), link by link; the first link is `followUp`.
   */
  chain: v.optional(v.array(v.array(v.string()))),
  /** Lane E7, round 2 (dcm-q0a): the allies (instance ids) who pay to raise a save's Difficulty (Enchanting Song, CB p.226). */
  raisers: v.optional(v.array(v.string())),
  /** A reaction fired by hand: who set it off (character, token or instance id) and the amount. */
  trigger: v.optional(v.object({ sourceId: v.optional(v.string()), subjectId: v.optional(v.string()), amount: v.optional(v.number()) })),
  options: v.optional(v.array(v.object({ id: v.string(), values: v.array(v.string()) }))),
  optionals: v.optional(v.array(v.string())),
  situations: v.optional(v.array(v.string())),
  eitherCosts: v.optional(v.array(v.number())),
  splits: v.optional(v.array(v.object({ id: v.string(), amount: v.number() }))),
};

const promptValidator = v.object({
  kind: v.union(v.literal("manual"), v.literal("move"), v.literal("pcSave"), v.literal("summon"), v.literal("countdown"), v.literal("spotlight"), v.literal("choice")),
  text: v.string(),
});

/** Asked first (Q19): nothing was rolled, paid or written. */
const confirmFearValidator = v.object({ status: v.literal("confirmFear"), fear: v.number(), spotlight: v.number(), feature: v.number(), experience: v.number() });

/** What the GM receives: the roll, hit / miss and the waiting hit per target, Fear, prompts and reactions to offer. */
const resolvedActionValidator = v.object({
  status: v.literal("resolved"),
  groupId: v.string(),
  entryId: v.id("actionLog"),
  roll: v.union(v.null(), rollValidator),
  success: v.boolean(),
  targets: v.array(
    v.object({
      characterId: v.optional(v.id("characters")),
      instanceId: v.optional(v.id("encounterAdversaries")),
      hit: v.boolean(),
      requestId: v.optional(v.id("combatRequests")),
      damage: v.optional(v.number()),
      resolved: v.boolean(),
      /** AA2b: resolved at once and it marked the last HP of the PC who took it (their death move is due). */
      deathMove: v.optional(v.boolean()),
    }),
  ),
  fearDelta: v.number(),
  prompts: v.array(promptValidator),
  offers: v.array(v.object({ feature: v.string(), useId: v.string(), trigger: v.string() })),
  /** SD4 (Q2): nothing was rolled yet; the attack waits for the PCs' before-roll answers in this request. */
  held: v.optional(v.id("combatRequests")),
  /** FH-AP (user 2026-11-05): nothing applied yet; the use waits for the PCs' own picks in this `allyPick` request. */
  picks: v.optional(v.id("combatRequests")),
});

function whole(n: number | undefined, max: number, what: string) {
  if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > max)) throw appError("INVALID", `${what} must be a whole number from 0 to ${max}.`);
}

function checkArgs(args: ActionArgs) {
  whole(args.advantage, 3, "Advantage");
  whole(args.disadvantage, 3, "Disadvantage");
  whole(args.spendFear, 12, "Fear to spend");
  for (const list of [args.reactions, args.situations, args.options, args.optionals, args.eitherCosts, args.splits, args.chain, args.raisers, args.buyOffs, ...(args.chain ?? [])]) {
    if ((list?.length ?? 0) > MAX_LIST) throw appError("INVALID", `At most ${MAX_LIST} entries per list.`);
  }
}

/**
 * The adversary's standard attack (CB p.160): one d20 (two with advantage / disadvantage) + ATK against each target's
 * Evasion; a natural 20 hits and crits (CB p.148); one target unless a feature says otherwise (CB p.161). Each hit opens
 * a reaction window. `confirmFear` when Fear must be spent first (Q19). GM only, keyed, rate limit `roll`.
 */
export const attack = keyedGmMutation({
  rateLimit: "roll",
  args: sharedArgs,
  returns: v.union(confirmFearValidator, resolvedActionValidator),
  handler: async (ctx, args) =>
    ctx.once("adversary_attack", args, async () => {
      checkArgs(args);
      return adversaryAction(ctx, ctx.campaign, ctx.user, args);
    }),
});

/**
 * One use of an adversary feature (its effect entry from the AE-* tables; Q15): pays Fear (on the GM's tap, Q19) and
 * adversary Stress, refuses NOT_ENOUGH_FEAR / ADVERSARY_FEATURE_UNAVAILABLE / ADVERSARY_NOT_SPOTLIT, runs the plan
 * (damage to PCs as reaction windows, conditions, Stress, Fear gains); summons, countdowns, movement and PC reaction
 * rolls come back as GM prompts. A feature without an entry (a custom block) is a manual prompt with its Fear paid.
 * dcm-y3mf: "all targets within <range>" with no `targets` reads them off the live map; an area the map can't measure
 * ("in front of", "in its path") is named by the GM, and an attack in one with no `targets` is COMBAT_TARGET_INVALID.
 */
export const useFeature = keyedGmMutation({
  rateLimit: "roll",
  args: featureArgs,
  returns: v.union(confirmFearValidator, resolvedActionValidator),
  handler: async (ctx, args) =>
    ctx.once("adversary_feature", args, async () => {
      checkArgs(args);
      return adversaryAction(ctx, ctx.campaign, ctx.user, args);
    }),
});

/**
 * Lane E7, round 2 (dcm-idz; user answer 2026-10-31): a GM-controlled PC (the `GM-controlled` tag: Enthralled, HF p.92;
 * Weredrake Curse, HF p.143) attacks like an adversary: d20 + the weapon's trait (or the stat block's ATK under the
 * Weredrake's) against other PCs' Evasion (a reaction window, this PC the attacker) or adversaries' Difficulty (a GM damage
 * prompt). A weapon whose trait is "choice" takes the GM-picked `trait` per attack (dcm-grqt). Refusals: NOT_FOUND,
 * INVALID (not GM-controlled, no weapon, a choice weapon without `trait`), COMBAT_TARGET_INVALID. GM only, keyed, `roll`.
 */
export const gmControlledAttack = keyedGmMutation({
  rateLimit: "roll",
  args: { characterId: v.id("characters"), targets: v.array(v.string()), weapon: v.optional(v.union(v.literal("primary"), v.literal("secondary"))), trait: v.optional(traitIdValidator) },
  returns: resolvedActionValidator,
  handler: async (ctx, args) => ctx.once("adversary_gm_controlled", args, async () => gmControlledAttackOf(ctx, ctx.campaign, ctx.user, args)),
});

/**
 * Lane E7 round 3 (dcm-f70y, dcm-c8h3, dcm-zi3k): a forced attack. The instance makes its standard attack against
 * `targets` (PCs or other instances of its encounter) outside its spotlight (Words of Discord, CB p.335; Beguiled, HF
 * p.75): no spotlight, no Fear. Adversary runs that force an adversary's attack call it themselves; this is the GM's
 * button for a card's forced attack until the card runner hands it over (E4). Refusals as `attack`. GM only, keyed, `roll`.
 */
export const forcedAttack = keyedGmMutation({
  rateLimit: "roll",
  args: { instanceId: v.string(), targets: v.array(v.string()) },
  returns: resolvedActionValidator,
  handler: async (ctx, args) =>
    ctx.once("adversary_forced_attack", args, async () => {
      if (args.targets.length > MAX_LIST) throw appError("INVALID", `At most ${MAX_LIST} entries per list.`);
      return forcedStandardAttack(ctx, ctx.campaign, ctx.user, args);
    }),
});

/**
 * Plan lanes-2 E7.4 (dcm-0hlq, dcm-thwj): a PC escaped the named tokens an adversary put on them (Encumber's bramble
 * tokens, CB p.218); the table rolled, the GM records the success. The tokens come off the sheet and the running
 * encounter hears `pcEscapes` (Drain and Multiply). GM only, keyed. INVALID without such tokens; NOT_FOUND outside the party.
 */
export const pcEscape = keyedGmMutation({
  args: { characterId: v.id("characters"), name: v.string() },
  returns: v.object({
    groupId: v.string(),
    tokens: v.number(),
    lines: v.array(v.string()),
    prompts: v.array(v.object({ kind: v.string(), text: v.string() })),
    offers: v.array(v.object({ instanceId: v.id("encounterAdversaries"), feature: v.string(), useId: v.string() })),
  }),
  handler: async (ctx, args) =>
    ctx.once("adversary_pc_escape", args, async () => {
      if (args.name.length === 0 || args.name.length > 40) throw appError("INVALID", "Token names are 1 to 40 characters.");
      return pcEscapeOf(ctx, ctx.campaign, ctx.user, args);
    }),
});

/**
 * Plan lanes-2 E7.4 (dcm-wiwi, dcm-0hlq): the named tokens on the party's sheets (`creatureTokens`; Encumber's bramble
 * tokens), for the GM's "Escaped" button. Reads only. GM only.
 */
export const pcTokens = gmQuery({
  args: {},
  returns: v.array(v.object({ characterId: v.id("characters"), pcName: v.string(), name: v.string(), count: v.number() })),
  handler: async (ctx) => {
    const out = [];
    for (const m of await partyMembers(ctx, ctx.campaign._id)) {
      for (const t of m.sheet.creatureTokens ?? []) if (t.count > 0) out.push({ characterId: m.character._id, pcName: m.sheet.name, name: t.name, count: t.count });
    }
    return out;
  },
});

const targetAskValidator = v.union(
  v.null(),
  v.object({ side: v.string(), range: v.string(), count: v.union(v.literal("one"), v.literal("upTo"), v.literal("all"), v.literal("any")), max: v.union(v.number(), v.null()), sight: v.boolean(), area: v.optional(v.string()) }),
);
const costAskValidator = { fear: v.number(), stress: v.number(), hp: v.number(), label: v.string() };

/** What one feature use needs before it runs (AA2c; docs/tasks/TASK-CA-AA2c.md has the shape for AA3b's dialog). */
const featureAskValidator = v.object({
  feature: v.string(),
  useId: v.string(),
  uses: v.array(v.object({ id: v.string(), activation: v.union(v.literal("action"), v.literal("reaction"), v.literal("auto"), v.literal("passive")) })),
  automated: v.boolean(),
  text: v.optional(v.string()),
  activation: v.union(v.literal("action"), v.literal("reaction"), v.literal("auto")),
  needsSpotlight: v.boolean(),
  spotlit: v.boolean(),
  available: v.boolean(),
  unavailable: v.array(v.string()),
  attack: v.boolean(),
  followUpAttack: v.boolean(),
  targets: targetAskValidator,
  picked: targetAskValidator,
  allies: targetAskValidator,
  followUp: targetAskValidator,
  trigger: v.union(v.null(), v.object({ kind: v.string(), text: v.optional(v.string()), source: v.boolean(), subject: v.boolean(), amount: v.boolean() })),
  options: v.array(v.object({ id: v.string(), label: v.string(), count: v.union(v.number(), v.null()), distinct: v.boolean(), options: v.array(v.object({ id: v.string(), label: v.string() })) })),
  optionals: v.array(v.object({ id: v.string(), label: v.string(), fear: v.number(), stress: v.number() })),
  situations: v.array(v.object({ text: v.string(), feature: v.string() })),
  splits: v.array(v.object({ what: v.union(v.literal("damage"), v.literal("clear"), v.literal("hope"), v.literal("stress"), v.literal("hp")), among: v.string(), track: v.optional(v.string()) })),
  eitherCosts: v.array(v.object({ index: v.number(), options: v.array(v.object({ index: v.number(), ...costAskValidator })) })),
  fear: v.object({ total: v.number(), spotlight: v.number(), feature: v.number(), perTrigger: v.boolean(), gmFear: v.number(), enough: v.boolean() }),
  stress: v.number(),
  experiences: v.array(v.object({ name: v.string(), value: v.number() })),
  reactions: v.array(v.object({ feature: v.string(), useId: v.string() })),
});

/**
 * What one use of an adversary feature needs from the GM before `useFeature` runs it (AA2c; user answer 2026-10-22:
 * AA3b asks the GM's choices in a dialog): targets and the other creature lists, `choose` options, optional steps,
 * situations to confirm, damage splits, `either` cost picks, the Fear it will ask for, and whether it is available now.
 * Reads only. GM only (it carries the stat block's numbers; players never receive them).
 */
export const featureAsk = gmQuery({
  args: { instanceId: v.string(), feature: v.string(), use: v.optional(v.string()) },
  returns: featureAskValidator,
  handler: async (ctx, args) => featureAskOf(ctx, ctx.campaign, args),
});

/**
 * The hit (or, SD4, before-roll) row when it can still be answered; one whose encounter ended or whose action was undone
 * is declined (null).
 */
async function liveRow(ctx: Parameters<typeof closeRequest>[0], campaignId: Id<"campaigns">, requestId: Id<"combatRequests">, by: Id<"users">): Promise<HitRow | PreRollRow | null> {
  const row = await loadOpenRequest(ctx, campaignId, requestId);
  if (!isHitRow(row) && !isPreRollRow(row)) throw appError("NOT_FOUND");
  if (!(await encounterRunning(ctx, row)) || (await groupUndone(ctx, row))) {
    await closeRequest(ctx, row._id, "declined", by);
    return null;
  }
  return row;
}

const answerResult = v.object({
  status: v.union(v.literal("open"), v.literal("resolved"), v.literal("declined")),
  requestId: v.id("combatRequests"),
  /** AA2b: the hit marked the last HP of the PC who took it; their sheet's death move is due now. */
  deathMove: v.optional(v.boolean()),
  /** AA2b: the hit resolved, and the PC who took it may still answer an after-hit card (`pending` lists it). */
  afterHit: v.optional(v.boolean()),
});

/**
 * An answer in a hit's reaction window (Q13, Q17), for a character the caller edits (its player or the GM): the target's
 * `armor {slots?}` / `noArmor` / `pass`, an offered reaction `card {cardId}` (paid at once: Stress, Hope, its once-per
 * entry), or (SD4) an offered `feature {featureId, useId?, choices}` (paid at once: Hope, Stress, Favor, Focus, held
 * dice). SD4 (Q2): on a before-roll prompt, a before-roll `feature` or `pass`; the last answer rolls the held attack.
 * NOT_A_RESPONDER for a character the window doesn't list or that already answered; REQUEST_NOT_OPEN once resolved. The
 * last answer resolves the hit in the same mutation. A hit whose encounter ended or whose action the GM undid comes back
 * `declined`.
 */
export const respond = keyedCampaignMutation({
  need: "view",
  enough: "owner",
  rateLimit: "roll",
  args: { requestId: v.id("combatRequests"), characterId: v.id("characters"), choice: v.union(hitChoiceValidator, preRollFeatureChoiceValidator) },
  returns: answerResult,
  handler: async (ctx, args) =>
    ctx.once("adversary_respond", args, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, args.characterId, "edit", "owner");
      if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
      if (args.choice.kind === "card" || args.choice.kind === "feature") assertCanAct(character, readSheet(character.sheet));
      const row = await liveRow(ctx, ctx.campaign._id, args.requestId, ctx.user._id);
      if (row === null) return { status: "declined" as const, requestId: args.requestId };
      if (isPreRollRow(row)) {
        if (args.choice.kind !== "feature" && args.choice.kind !== "pass") throw appError("INVALID", "Use a before-roll feature or pass.");
        const { complete } = await respondPreRoll(ctx, { row, characterId: args.characterId, choice: args.choice, by: ctx.user._id });
        if (!complete) return { status: "open" as const, requestId: row._id };
        const fresh = await ctx.db.get("combatRequests", row._id);
        if (fresh === null || !isPreRollRow(fresh)) throw new Error("respond: the held attack is gone.");
        await replayHeld(ctx, fresh, ctx.user._id);
        return { status: "resolved" as const, requestId: row._id };
      }
      // AA2b: a resolved hit waiting for the target's after-hit card (Unbreakable) takes only that answer.
      if (hasAfterHit(row)) return { status: await respondAfterHit(ctx, { row, characterId: args.characterId, choice: args.choice, by: ctx.user._id }), requestId: row._id };
      const { complete } = await respondToHit(ctx, { row, characterId: args.characterId, choice: args.choice, by: ctx.user._id });
      if (!complete) return { status: "open" as const, requestId: row._id };
      const fresh = await ctx.db.get("combatRequests", row._id);
      if (fresh === null || !isHitRow(fresh)) throw new Error("respond: the hit row is gone.");
      const res = await resolveIncomingHit(ctx, { row: fresh, by: ctx.user._id, early: false });
      await afterHitTriggers(ctx, res, row.createdBy);
      return { status: "resolved" as const, requestId: row._id, ...resolutionFlags(res) };
    }),
});

/** The AA2b flags of a resolution on an answer: the death move now due, an after-hit card still to answer. */
function resolutionFlags(res: HitResolution): { deathMove?: boolean; afterHit?: boolean } {
  return { ...(res.deathMove ? { deathMove: true } : {}), ...(res.afterHit ? { afterHit: true } : {}) };
}

/**
 * The GM's "Resolve now" (Q17): whoever hasn't answered takes no armor and plays no card. SD4 (Q2): on a before-roll
 * prompt, whoever hasn't answered passes and the held attack rolls now (`preRoll`).
 */
export const resolve = keyedGmMutation({
  args: { requestId: v.id("combatRequests") },
  returns: v.union(
    v.object({ status: v.literal("declined"), requestId: v.id("combatRequests") }),
    v.object({
      status: v.literal("resolved"),
      requestId: v.id("combatRequests"),
      targetId: v.id("characters"),
      severity: severityValidator,
      hpMarked: v.number(),
      deathMove: v.boolean(),
      /** SD4: a held attack rolled (its hits open their own windows). */
      preRoll: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, { requestId }) =>
    ctx.once("adversary_resolve", { requestId }, async () => {
      const row = await liveRow(ctx, ctx.campaign._id, requestId, ctx.user._id);
      if (row === null) return { status: "declined" as const, requestId };
      if (isPreRollRow(row)) {
        const result = await replayHeld(ctx, row, ctx.user._id);
        if (result === null) return { status: "declined" as const, requestId };
        const first = row.payload.attack.targetCharacterIds[0]!;
        return { status: "resolved" as const, requestId, targetId: first, severity: "none" as const, hpMarked: 0, deathMove: false, preRoll: true };
      }
      if (hasAfterHit(row)) {
        // AA2b: the hit already resolved; "Resolve now" passes the after-hit offer.
        const offer = row.payload.afterHit;
        await closeRequest(ctx, row._id, "resolved", ctx.user._id);
        return { status: "resolved" as const, requestId, targetId: offer.characterId, severity: offer.severity, hpMarked: offer.hpMarked, deathMove: offer.deathMove };
      }
      const res = await resolveIncomingHit(ctx, { row, by: ctx.user._id, early: true });
      await afterHitTriggers(ctx, res, row.createdBy);
      return { status: "resolved" as const, requestId, targetId: res.targetId, severity: res.severity, hpMarked: res.hpMarked, deathMove: res.deathMove };
    }),
});

/**
 * Lane E7 (dcm-bxp.78; user answers 2026-10-30): the Start button of a countdown an adversary's feature names ("Countdown
 * (Loop 1d6)", "Countdown (Decreasing 8)", "Doom Countdown (1d6+1)"), on the tracker's countdown prompt and the instance's
 * stat block. Builds a dashboard countdown from the label (mode, repeat, fixed or rolled start, as the environments'
 * `startCountdown`), Private, armed only when it ticks on action rolls (CB p.162). `characterId` makes it a per-PC one,
 * "<Adversary>: <Feature> - <PC>". GM only, keyed. INVALID when the feature names no such countdown; NOT_FOUND for an
 * instance, feature or PC outside the campaign. Linking it to the instance (the "End this countdown?" prompt on defeat)
 * needs a countdowns field: follow-up bead (TASK-LN-E7.md).
 */
export const startCountdown = keyedGmMutation({
  args: { instanceId: v.string(), feature: v.string(), label: v.optional(v.string()), characterId: v.optional(v.id("characters")) },
  returns: v.object({ countdownId: v.id("countdowns"), name: v.string(), startingValue: v.number(), armed: v.boolean() }),
  handler: async (ctx, args) => {
    const campaignId = ctx.campaign._id;
    const instance = await loadInstance(ctx, campaignId, args.instanceId);
    const block = await blockOf(ctx, instance);
    const feature = block?.features.find((f) => f.name === args.feature);
    if (!block || !feature) throw appError("NOT_FOUND");
    // A custom block stores its countdown as a number ("Countdown (N)").
    const printed = typeof feature.countdown === "number" ? `Countdown (${feature.countdown})` : feature.countdown;
    const labels = adversaryCountdownLabels({ text: feature.text, ...(printed !== undefined ? { countdown: printed } : {}) });
    const label = args.label === undefined ? labels[0] : labels.find((l) => l === args.label);
    const bonus = label === undefined ? { label: "", plus: 0 } : countdownLabelBonus(label);
    const parsed = label === undefined ? null : parseCountdownLabel(bonus.label);
    if (label === undefined || parsed === null) throw appError("INVALID", "That feature has no such countdown.");
    let pcName: string | undefined;
    if (args.characterId !== undefined) {
      const member = (await partyMembers(ctx, campaignId)).find((m) => m.character._id === args.characterId);
      if (!member) throw appError("NOT_FOUND");
      pcName = member.sheet.name;
    }
    return ctx.once("adversary_start_countdown", args, async () => {
      const { mode, repeat, start } = parsed;
      const rolled = start.kind === "fixed" ? start.value : startFromDice(rollDice(start.count, start.sides), MAX_COUNTDOWN_START) + bonus.plus;
      const startingValue = Math.min(MAX_COUNTDOWN_START, Math.max(1, rolled));
      const sides = COUNTDOWN_DICE_SIDES.find((n) => start.kind === "dice" && n === start.sides);
      const startDice = start.kind === "dice" && bonus.plus === 0 && sides !== undefined && start.count >= 1 && start.count <= MAX_COUNTDOWN_DICE ? { count: start.count, sides } : undefined;
      const armed = mode !== "longTerm" && adversaryCountdownArmed(feature.text, countdownTickOn(block, feature.name));
      const name = adversaryCountdownName(instance.label, labels.length > 1 ? `${feature.name} (${label})` : feature.name, pcName);
      const countdownId = await ctx.db.insert("countdowns", {
        campaignId,
        name,
        description: feature.text.slice(0, COUNTDOWN_DETAILS_MAX_LENGTH),
        category: environmentCountdownCategory(label),
        startingValue,
        currentValue: startingValue,
        consequence: "",
        status: "active",
        createdAt: Date.now(),
        visibility: COUNTDOWN_VISIBILITY_PRESETS.private,
        armed,
        ...(mode !== "standard" ? { mode } : {}),
        ...(repeat !== null && mode !== "longTerm" ? { repeat, initialValue: startingValue } : {}),
        ...(startDice !== undefined && mode !== "longTerm" ? { startDice } : {}),
      });
      await recordHistory(ctx, ctx.user._id, { campaignId, kind: "countdown", action: "create", countdownId, before: null, after: { currentValue: startingValue, status: "active" } });
      return { countdownId, name, startingValue, armed };
    });
  },
});
