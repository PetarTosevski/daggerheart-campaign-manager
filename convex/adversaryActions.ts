import { v } from "convex/values";

import { awaiting } from "../src/lib/domain/adversary-actions/index";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { adversaryAction, afterHitTriggers, type ActionArgs } from "./lib/adversaryActions";
import { featureAsk as featureAskOf } from "./lib/adversaryFeatures";
import { assertCanAct, loadCharacter, readSheet } from "./lib/characterSheet";
import { closeRequest, encounterRunning, loadOpenRequest, openRequests } from "./lib/combatRequests";
import { campaignQuery, gmQuery, keyedCampaignMutation, keyedGmMutation } from "./lib/functions";
import { groupUndone, hasAfterHit, hitView, isHitRow, isPcAttacker, memberId, rebuildWindow, resolveIncomingHit, respondAfterHit, respondToHit, type HitResolution, type HitRow } from "./lib/incomingHits";
import { rollValidator } from "./lib/validators/actionLog";
import { hitChoiceValidator } from "./lib/validators/combatRequests";

/**
 * Adversary actions against PCs (plan combat-actions, tracer AA2; docs/tasks/TASK-CA-AA2.md). The GM attacks with an
 * adversary or uses one of its features from the Encounter tab or the Combat Map (Q12, Q16); the server rolls, opens a
 * reaction window per hit PC (Q13), lets the target choose armor and allies answer with eligible cards (`respond`),
 * resolves when everyone answered or the GM says so (`resolve`, Q17), and logs it all as one undoable group (U4).
 * Players see that they were hit, never the roll; the hit PC sees their own damage and severity (`pending`, Q14).
 */

const severityValidator = v.union(v.literal("none"), v.literal("minor"), v.literal("major"), v.literal("severe"));
const damageTypeValidator = v.union(v.literal("physical"), v.literal("magic"), v.literal("both"));

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
});

function whole(n: number | undefined, max: number, what: string) {
  if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > max)) throw appError("INVALID", `${what} must be a whole number from 0 to ${max}.`);
}

function checkArgs(args: ActionArgs) {
  whole(args.advantage, 3, "Advantage");
  whole(args.disadvantage, 3, "Disadvantage");
  whole(args.spendFear, 12, "Fear to spend");
  for (const list of [args.reactions, args.situations, args.options, args.optionals, args.eitherCosts, args.splits]) {
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

const targetAskValidator = v.union(
  v.null(),
  v.object({ side: v.string(), range: v.string(), count: v.union(v.literal("one"), v.literal("upTo"), v.literal("all"), v.literal("any")), max: v.union(v.number(), v.null()), sight: v.boolean() }),
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
  splits: v.array(v.object({ what: v.union(v.literal("damage"), v.literal("clear")), among: v.string(), track: v.optional(v.string()) })),
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

/** The hit row when it can still be answered; a hit whose encounter ended or whose action was undone is declined (null). */
async function liveHit(ctx: Parameters<typeof closeRequest>[0], campaignId: Id<"campaigns">, requestId: Id<"combatRequests">, by: Id<"users">): Promise<HitRow | null> {
  const row = await loadOpenRequest(ctx, campaignId, requestId);
  if (!isHitRow(row)) throw appError("NOT_FOUND");
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
 * `armor {slots?}` / `noArmor` / `pass`, or an offered reaction `card {cardId}` (paid at once: Stress, Hope, its
 * once-per entry). NOT_A_RESPONDER for a character the window doesn't list or that already answered; REQUEST_NOT_OPEN
 * once resolved. The last answer resolves the hit in the same mutation. A hit whose encounter ended or whose action the
 * GM undid comes back `declined`.
 */
export const respond = keyedCampaignMutation({
  need: "view",
  enough: "owner",
  rateLimit: "roll",
  args: { requestId: v.id("combatRequests"), characterId: v.id("characters"), choice: hitChoiceValidator },
  returns: answerResult,
  handler: async (ctx, args) =>
    ctx.once("adversary_respond", args, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, args.characterId, "edit", "owner");
      if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
      if (args.choice.kind === "card") assertCanAct(character, readSheet(character.sheet));
      const row = await liveHit(ctx, ctx.campaign._id, args.requestId, ctx.user._id);
      if (row === null) return { status: "declined" as const, requestId: args.requestId };
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

/** Who made a hit, for `windows`: the instance, or (AA2b) the PC whose card it was. One shape, both fields optional. */
function attackerIds(attacker: HitRow["payload"]["attacker"]): { instanceId?: Id<"encounterAdversaries">; attackerCharacterId?: Id<"characters"> } {
  return isPcAttacker(attacker) ? { attackerCharacterId: attacker.characterId } : { instanceId: attacker.instanceId };
}

/** The AA2b flags of a resolution on an answer: the death move now due, an after-hit card still to answer. */
function resolutionFlags(res: HitResolution): { deathMove?: boolean; afterHit?: boolean } {
  return { ...(res.deathMove ? { deathMove: true } : {}), ...(res.afterHit ? { afterHit: true } : {}) };
}

/** The GM's "Resolve now" (Q17): whoever hasn't answered takes no armor and plays no card. */
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
    }),
  ),
  handler: async (ctx, { requestId }) =>
    ctx.once("adversary_resolve", { requestId }, async () => {
      const row = await liveHit(ctx, ctx.campaign._id, requestId, ctx.user._id);
      if (row === null) return { status: "declined" as const, requestId };
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

/** Open hits of a running encounter whose action wasn't undone (reads leave stale rows for the next write to decline). */
async function liveHits(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<HitRow[]> {
  const out: HitRow[] = [];
  for (const row of await openRequests(ctx, campaignId)) {
    if (!isHitRow(row) || !(await encounterRunning(ctx, row)) || (await groupUndone(ctx, row))) continue;
    out.push(row);
  }
  return out;
}

const armorStepValidator = v.object({ slots: v.number(), severity: severityValidator, hp: v.number() });

/**
 * A character's open hits (need edit on the character: its player or the GM). As the hit PC (Q14): the damage, its
 * severity against their own thresholds, how many Armor Slots they may mark and what each gives, and their eligible
 * cards. As an ally: who was hit, by whom, and their eligible cards. Never the attack roll or an adversary's stats (CF6).
 */
export const pending = campaignQuery({
  need: "view",
  enough: "owner",
  args: { characterId: v.id("characters") },
  returns: v.array(
    v.object({
      requestId: v.id("combatRequests"),
      attackerLabel: v.string(),
      targetCharacterId: v.id("characters"),
      targetName: v.string(),
      role: v.union(v.literal("target"), v.literal("ally")),
      awaiting: v.boolean(),
      cardIds: v.array(v.string()),
      createdAt: v.number(),
      damage: v.optional(v.number()),
      severity: v.optional(severityValidator),
      direct: v.optional(v.boolean()),
      maxSlots: v.optional(v.number()),
      armorPreview: v.optional(v.array(armorStepValidator)),
      /** AA2b: the hit resolved; answer an after-hit card in `cardIds` (Unbreakable) with `card` or `pass`. */
      afterHit: v.optional(v.boolean()),
      /** AA2b: with `afterHit`, the hit marked this character's last HP. */
      deathMove: v.optional(v.boolean()),
      /** AA2b: after a redirect (I Am Your Shield), the PC hit first. */
      originalTargetName: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { characterId }) => {
    const { campaign } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
    if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
    const views = [];
    for (const row of await liveHits(ctx, ctx.campaign._id)) {
      const view = await hitView(ctx, row, characterId);
      if (view) views.push(view);
    }
    return views;
  },
});

/** The GM's view of the open reaction windows (Q17): who was hit for how much, and who still has to answer. */
export const windows = gmQuery({
  args: {},
  returns: v.array(
    v.object({
      requestId: v.id("combatRequests"),
      encounterId: v.optional(v.id("encounters")),
      /** The attacking instance; absent when a PC's card made the hit (AA2b: `attackerCharacterId` instead). */
      instanceId: v.optional(v.id("encounterAdversaries")),
      /** AA2b: the PC whose card made the hit (card damage to an ally). */
      attackerCharacterId: v.optional(v.id("characters")),
      attackerLabel: v.string(),
      feature: v.optional(v.string()),
      originalTargetId: v.id("characters"),
      targetCharacterId: v.id("characters"),
      targetName: v.string(),
      damage: v.number(),
      damageType: damageTypeValidator,
      direct: v.boolean(),
      critical: v.boolean(),
      awaiting: v.array(v.object({ characterId: v.id("characters"), name: v.string(), role: v.union(v.literal("target"), v.literal("ally")) })),
      answers: v.number(),
      createdAt: v.number(),
      /** AA2b: the hit resolved; only its target's after-hit answer (`awaiting`) is left. */
      afterHit: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx) => {
    const out = [];
    for (const row of await liveHits(ctx, ctx.campaign._id)) {
      const { state, members } = await rebuildWindow(ctx, row);
      const nameOf = (id: string) => members.find((m: { character: Doc<"characters"> }) => m.character._id === id)?.sheet.name ?? "Unknown";
      const p = row.payload;
      const offer = p.afterHit;
      out.push({
        requestId: row._id,
        ...(row.encounterId ? { encounterId: row.encounterId } : {}),
        ...attackerIds(p.attacker),
        ...(offer ? { afterHit: true } : {}),
        attackerLabel: p.attacker.label,
        ...(p.attacker.feature !== undefined ? { feature: p.attacker.feature } : {}),
        originalTargetId: p.targetCharacterId,
        targetCharacterId: memberId(members, state.targetId, p.targetCharacterId),
        targetName: nameOf(state.targetId),
        damage: p.damage,
        damageType: p.damageType,
        direct: p.direct,
        critical: p.critical,
        awaiting: offer ? [{ characterId: offer.characterId, name: nameOf(offer.characterId), role: "target" as const }] : awaiting(state).map((id) => ({ characterId: memberId(members, id, p.targetCharacterId), name: nameOf(id), role: state.responders.find((r) => r.characterId === id)?.role ?? ("ally" as const) })),
        answers: row.responses.length,
        createdAt: row.createdAt,
      });
    }
    return out;
  },
});
