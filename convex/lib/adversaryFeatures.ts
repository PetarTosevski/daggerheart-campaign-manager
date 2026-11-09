/**
 * The adversary side's building blocks (plan combat-actions; split out of ./adversaryActions.ts by AA2c, CH9: logic
 * files under 800 lines): the instance's stat block (SRD or custom), its limited feature uses (per scene and, AA2c, per
 * session), the riders a plan puts on a hit PC, triggered uses, the runner's refusals, loading the acting instance, and
 * `featureAsk`: what one use of a feature needs from the GM before it runs (AA2c; AA3b's choices dialog). The action
 * itself (`adversaryAction`, `afterHitTriggers`) stays in ./adversaryActions.ts, which re-exports the public names here.
 *
 * User answers (binding, quoted in docs/tasks/TASK-CA-AA2c.md): "'once per session' adversary features last the whole
 * session (reset at session end)"; "the GM's feature choices are asked in a dialog (AA3b) - so the server exposes a query
 * describing what a feature use needs (options, picks, allies, splits, situations, cost choices, Fear amount)". Q19: Fear
 * only on the GM's tap; `featureAsk` reports the Fear the use will ask for, it spends nothing.
 *
 * Rules (printed pages): CB p.153-154, p.194 spotlight and Fear; CB p.160 an Experience for a Fear; CB p.195 reactions.
 */
import { adversaryFeatureId, adversaryFeatureUseKey, conditionStepsOf, lastingModsOf, pickAdversaryUse, run, upfrontFear, type AdversaryPlan, type AdversaryRunContext, type InstanceModifiers, type StandardAttack } from "../../src/lib/domain/adversary-effects/run";
import type { AdversaryCost, AdversaryFeatureEffect, AdversaryFeatureUse, AdversaryRequirement, AdversaryStep } from "../../src/lib/domain/adversary-effects/types";
import { passiveSummary, spotlightCost, triggeredUses, unmetAdversaryRequirements, type AdversaryEvent, type AdversaryState, type PassiveSummary, type TriggeredUse } from "../../src/lib/domain/adversary-actions/index";
import { featureFearCost, hordeDamage, relentlessValue } from "../../src/lib/domain/adversaries/index";
import type { PlanStep, ResolvedMod } from "../../src/lib/domain/card-effects/run";
import type { AttackedRider, BearerRider, ConditionRef, Duration, EndEvent, Escape, Gate, Limit, Mod, NumberSource, RollEnd, RollResult, Step, TargetSpec, TriggerTargets } from "../../src/lib/domain/card-effects/types";
import { endsOnOccurrence, type EffectEnds, type EndOccurrence, type EndRole, type EndRoll } from "../../src/lib/domain/characters/expiry";
import { tokenDistance, type Combatant } from "../../src/lib/domain/combat-actions/index";
import type { MapCreature } from "../../src/lib/domain/combat-actions/numbers";
import { turnSpotlights } from "../../src/lib/domain/encounters/spotlight";
import { appError } from "../../src/lib/errors/app-error";
import { ADVERSARIES } from "../../src/lib/srd/adversaries";
import { srdAdversary } from "../../src/lib/srd/adversary-lookup";
import { adversaryEffects, allAdversaryEffects } from "../../src/lib/srd/adversary-effects/index";
import { allCardEffects } from "../../src/lib/srd/card-effects/index";
import { allFeatureEffects } from "../../src/lib/srd/feature-effects/index";
import { alwaysOnResistance } from "../../src/lib/srd/adversary-resistance";
import type { AdversaryDef } from "../../src/lib/srd/types";
import type { CharacterSheet, FeatureUse } from "../../src/lib/validation/characters";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { assertRunning, loadEncounter, loadInstance, MAX_INSTANCES } from "./encounters";
import { campaignFearState } from "./fear";
import { rules } from "./rolls";
import { adversaryDefeated } from "./spotlight";
import type { AdversaryBefore } from "./validators/actionLog";
import type { HitRider } from "./validators/combatRequests";
import { MAX_INSTANCE_FEATURE_USES, type InstanceEffect, type InstanceFeatureUse } from "./validators/encounters";
import { effectSource, instanceEffectSource, srdUses } from "./cardRows";


// ---------------------------------------------------------------- the stat block

export type BlockFeature = { name: string; kind: "passive" | "action" | "reaction" | "evolution"; text: string; fearCost?: number; countdown?: string | number };

/** What the server reads of an instance's stat block: an SRD entry or the campaign's custom block. */
export type Block = {
  /** The registry key: the SRD slug, or `custom:<id>` (no effect entries). */
  adversaryId: string;
  tier: 1 | 2 | 3 | 4;
  attack: StandardAttack;
  experiences: readonly { name: string; value: number }[];
  features: readonly BlockFeature[];
  effects: readonly AdversaryFeatureEffect[];
  resistance: Combatant["resistance"];
  hordeX: string | null;
  relentless: number | "X" | null;
};

const SRD_RANGES = ["Melee", "Very Close", "Close", "Far", "Very Far"] as const;
/** A custom block's attack range as the runner reads it (unknown text: Melee). */
const srdRange = (r: string): StandardAttack["range"] => SRD_RANGES.find((x) => x === r) ?? "Melee";

const tierOf = (n: number): 1 | 2 | 3 | 4 => (n <= 1 ? 1 : n >= 4 ? 4 : (Math.round(n) as 2 | 3));

/**
 * The instance's stat block, or null when its source is gone. The instance's own resistance wins (CA2, Q8). Lane E7
 * (dcm-gx3): an Evolution on the instance (`evolvedBlock`) replaces its standard attack and drops the features it lost.
 */
export async function blockOf(ctx: QueryCtx, instance: Doc<"encounterAdversaries">): Promise<Block | null> {
  const block = await printedBlockOf(ctx, instance);
  return block === null ? null : evolvedBlock(block, instance);
}

const VOCABULARY_RANGES = ["melee", "veryClose", "close", "far", "veryFar"] as const;

/**
 * Lane E7, round 2 (dcm-gx3, Evolution, HF p.61): the block as the instance's modifiers changed it. The latest
 * `standardAttack` replaces the standard attack (its ATK stays the printed one: Enraged Mountain Troll, HF p.65, "replace
 * Skull Flail with the following standard attack: Claw Swipe: Very Close | 1d10+3 phy"); features in `featuresRemoved`
 * are gone from the feature list and from the effect entries. `featuresAdded` are printed on the block already (Double
 * Swipe) and stay listed.
 */
export function evolvedBlock(block: Block, instance: Pick<Doc<"encounterAdversaries">, "effects">): Block {
  const effects = instance.effects ?? [];
  const attack = [...effects].reverse().find((e) => e.standardAttack !== undefined)?.standardAttack;
  const removed = new Set(effects.flatMap((e) => e.featuresRemoved ?? []));
  if (attack === undefined && removed.size === 0) return block;
  const range: StandardAttack["range"] = SRD_RANGES.find((x) => x === attack?.range) ?? VOCABULARY_RANGES.find((x) => x === attack?.range) ?? block.attack.range;
  return {
    ...block,
    ...(attack ? { attack: { name: attack.name, modifier: block.attack.modifier, range, damage: attack.damage } } : {}),
    features: block.features.filter((f) => !removed.has(f.name)),
    effects: block.effects.filter((e) => !removed.has(e.feature)),
  };
}

async function printedBlockOf(ctx: QueryCtx, instance: Doc<"encounterAdversaries">): Promise<Block | null> {
  const own = instance.resistance;
  const fromInstance = own === undefined ? undefined : own.conditional === undefined || instance.resistanceActive === true ? { physical: own.physical, magic: own.magic } : { physical: "none" as const, magic: "none" as const };
  // Lane E7 round 3 (dcm-3ag5, Transform): a `form` modifier swaps in that SRD stat block.
  const form = formOf(instance);
  if (form !== undefined || instance.source.kind === "srd") {
    const def = form ?? (instance.source.kind === "srd" ? srdAdversary(instance.source.adversaryId) : undefined);
    if (!def) return null;
    return {
      adversaryId: def.id,
      tier: def.tier,
      attack: def.attack,
      experiences: def.experiences,
      features: def.features,
      effects: adversaryEffects(def.id),
      resistance: fromInstance ?? alwaysOnResistance(def.id),
      hordeX: hordeDamage(def),
      relentless: relentlessValue(def),
    };
  }
  const block = await ctx.db.get("customAdversaries", instance.source.customId);
  if (block === null || block.campaignId !== instance.campaignId) return null;
  const named = (re: RegExp) => block.features.map((f) => re.exec(f.name)?.[1]).find((x) => x !== undefined) ?? null;
  const relentless = named(/^Relentless \((\d+|X)\)$/);
  const custom = block.resistance && block.resistance.conditional === undefined ? { physical: block.resistance.physical, magic: block.resistance.magic } : undefined;
  return {
    adversaryId: `custom:${block._id}`,
    tier: tierOf(block.tier),
    attack: { ...block.attack, range: srdRange(block.attack.range) },
    experiences: block.experiences,
    features: block.features,
    effects: [],
    resistance: fromInstance ?? custom,
    hordeX: named(/^Horde \((.+)\)$/),
    relentless: relentless === null ? null : relentless === "X" ? "X" : Number(relentless),
  };
}

/** The instance as the engine reads it (side "adversary"). */
export function selfCombatant(instance: Doc<"encounterAdversaries">, block: Block): Combatant {
  // Lane E7 round 3: a Transform's form brings its own numbers (`instanceStatsOf`).
  const stats = instanceStatsOf(instance);
  return {
    id: instance._id,
    side: "adversary",
    difficulty: stats.difficulty + (instance.effects ?? []).reduce((s, e) => s + (e.difficulty ?? 0), 0),
    thresholds: { major: stats.major, severe: stats.severe },
    hp: instance.hp,
    hpMax: stats.hpMax,
    stress: instance.stress,
    stressMax: stats.stressMax,
    defeated: instance.defeated,
    ...(block.resistance ? { resistance: block.resistance } : {}),
    conditions: instance.conditions,
    tags: instance.tags,
  };
}

export function adversaryState(instance: Doc<"encounterAdversaries">): AdversaryState {
  return { hp: instance.hp, hpMax: instance.stats.hpMax, stress: instance.stress, stressMax: instance.stats.stressMax, conditions: instance.conditions, tags: instance.tags, tokens: instance.tokens ?? 0 };
}

export function instanceModifiers(instance: Doc<"encounterAdversaries">): InstanceModifiers {
  const effects = instance.effects ?? [];
  return {
    attack: effects.reduce((s, e) => s + (e.attack ?? 0), 0),
    damage: effects.reduce((s, e) => s + (e.damage ?? 0), 0),
    halfDamage: effects.some((e) => e.halfDamage === true),
    disadvantage: effects.some((e) => e.disadvantage === true),
  };
}

export function beforeOf(instance: Doc<"encounterAdversaries">): AdversaryBefore {
  return {
    instanceId: instance._id,
    hp: instance.hp,
    stress: instance.stress,
    defeated: instance.defeated,
    ...(instance.minionCount !== undefined ? { minionCount: instance.minionCount } : {}),
    conditions: instance.conditions,
    tags: instance.tags,
  };
}

export type Prompt = { kind: "manual" | "move" | "pcSave" | "summon" | "countdown" | "spotlight" | "choice"; text: string };

/** A fixed number's value, else "some" (a branch's numbers aren't rolled until the GM applies it). */
const fixedText = (n: { kind: string; value?: number } | undefined) => (n?.kind === "fixed" && n.value !== undefined ? String(n.value) : "some");

/** The adversary-only steps (summon, countdown, spotlight) of a save branch as GM prompts, nested steps included. */
export function adversaryOnlyPrompts(steps: readonly AdversaryStep[]): Prompt[] {
  const out: Prompt[] = [];
  for (const s of steps) {
    if (s.kind === "summon") out.push({ kind: "summon", text: `Summon ${fixedText(s.count)} ${s.label}${s.range ? ` within ${s.range}` : ""}` });
    else if (s.kind === "countdown") out.push({ kind: "countdown", text: `Countdown ${s.label}: ${s.op}${s.start ? ` at ${fixedText(s.start)}` : ""}${s.note ? ` (${s.note})` : ""}` });
    else if (s.kind === "spotlight") out.push({ kind: "spotlight", text: `Spotlight ${s.who}${s.name ? ` (${s.name})` : ""}` });
    else if (s.kind === "optional" || s.kind === "followUp") out.push(...adversaryOnlyPrompts(s.steps));
    else if (s.kind === "choose") for (const o of s.options) out.push(...adversaryOnlyPrompts(o.steps));
    else if (s.kind === "check") out.push(...adversaryOnlyPrompts(s.then), ...adversaryOnlyPrompts(s.otherwise));
    else if (s.kind === "save") out.push(...adversaryOnlyPrompts(s.onFail), ...adversaryOnlyPrompts(s.onSuccess));
  }
  return out;
}

/** The scene an encounter's run is: its latest `startedAt` (a restart is a new scene). */
export const sceneOf = (encounter: Doc<"encounters">) => encounter.startedAt ?? encounter.createdAt;

/** Steps that carry their own limit (an optional step's "once per scene"), nested branches included. */
function limitedSteps(steps: readonly AdversaryStep[]): { id: string; limit: Limit }[] {
  const out: { id: string; limit: Limit }[] = [];
  walkSteps(steps, (s) => {
    if (s.kind === "optional" && s.limit) out.push({ id: s.id, limit: s.limit });
  });
  return out;
}

/**
 * The period of a stored use key (AA2c): the limit of the use (or optional step) whose key it is, by the longest key
 * prefix (a per-target limit appends the target). Null when the block has no such limit.
 */
export function limitPerOf(block: Pick<Block, "adversaryId" | "effects">, key: string): Limit["per"] | null {
  return limitOf(block, key)?.per ?? null;
}

/** The limit of a stored use key (see `limitPerOf`), with its `period` (lane E7, dcm-c5h). */
export function limitOf(block: Pick<Block, "adversaryId" | "effects">, key: string): Limit | null {
  let best: { length: number; limit: Limit } | null = null;
  const consider = (prefix: string, limit: Limit) => {
    if ((key === prefix || key.startsWith(`${prefix}:`)) && (best === null || prefix.length > best.length)) best = { length: prefix.length, limit };
  };
  for (const e of block.effects) {
    for (const u of e.uses) {
      if (u.limit) consider(adversaryFeatureUseKey(block.adversaryId, e.feature, u.id), u.limit);
      for (const step of limitedSteps(u.steps)) consider(`card:${adversaryFeatureId(block.adversaryId, e.feature)}:${u.id}:${step.id}`, step.limit);
    }
  }
  return (best as { limit: Limit } | null)?.limit ?? null;
}

/**
 * Lane E7 (dcm-c5h): a "once per GM turn" use (Ravenous, HF p.97; `Limit.period: "gmTurn"`) is stored with the GM turn it
 * was made in after its key (`<key>@gmTurn<N>`), so it counts only during that turn. The stored shape needs no new field.
 */
const GM_TURN_MARK = "@gmTurn";

/** A stored key's own key and the GM turn it is bound to (none for every other period). */
function splitGmTurn(key: string): { key: string; gmTurn?: number } {
  const at = key.lastIndexOf(GM_TURN_MARK);
  if (at < 0) return { key };
  const turn = Number(key.slice(at + GM_TURN_MARK.length));
  return Number.isInteger(turn) ? { key: key.slice(0, at), gmTurn: turn } : { key };
}

/**
 * Whether a stored use still counts (AA2b, AA2c): recorded in this run of the encounter (per-scene limits reset when
 * it ends), or a session limit recorded in the live session (user answer 2026-10-22: "'once per session' adversary
 * features last the whole session (reset at session end)"). `session` is `campaignState.sessionStartedAt`. Lane E7: a
 * use bound to a GM turn counts only in that turn (`gmTurn`, the encounter's current turn).
 */
export function useCounts(u: InstanceFeatureUse, scene: number, session: number | undefined, gmTurn?: number): boolean {
  const bound = splitGmTurn(u.key).gmTurn;
  if (bound !== undefined && gmTurn !== undefined && bound !== gmTurn) return false;
  return u.scene === scene || (u.session !== undefined && u.session === session);
}

/**
 * The instance's limited feature uses that still count (AA2b; "Once per scene", TASK-CA-AA1 Q4): the entries recorded
 * in this run of the encounter, and (AA2c) session-limited ones of the live session (`session`, optional: without it
 * only the scene's count). Lane E7: GM-turn uses of this GM turn only, under their own key.
 */
export function instanceUses(instance: Doc<"encounterAdversaries">, encounter: Doc<"encounters">, session?: number): FeatureUse[] {
  const scene = sceneOf(encounter);
  return (instance.featureUses ?? []).filter((u) => useCounts(u, scene, session, encounter.gmTurn)).map((u) => ({ key: splitGmTurn(u.key).key, until: u.until }));
}

/**
 * The instance's stored uses after an action recorded `added` (AA2c): the ones that still count, then the new ones with
 * this scene and, for a session limit while a session is live, the session (it then outlasts the encounter). Without a
 * live session a session limit is kept for the scene only. At most MAX_INSTANCE_FEATURE_USES (oldest dropped).
 */
export function storedUses(instance: Doc<"encounterAdversaries">, encounter: Doc<"encounters">, block: Block, added: readonly FeatureUse[], session: number | undefined): InstanceFeatureUse[] {
  const scene = sceneOf(encounter);
  const kept = (instance.featureUses ?? []).filter((u) => useCounts(u, scene, session, encounter.gmTurn));
  // A sheet's `featureUses` gained `scene` (sheet-drawer SD0); an instance's scene limit is `session` stamped with `scene`.
  const fresh = added.map((u) => {
    const limit = limitOf(block, u.key);
    return {
      key: limit?.period === "gmTurn" ? `${u.key}${GM_TURN_MARK}${encounter.gmTurn}` : u.key,
      // Wave 9 E5.3 (dcm-pg8x): a sheet's campaign-long memory has no instance period; an instance lasts the encounter.
      until: u.until === "scene" || u.until === "campaign" ? ("session" as const) : u.until,
      scene,
      ...(session !== undefined && limit?.per === "session" ? { session } : {}),
    };
  });
  return [...kept, ...fresh].slice(-MAX_INSTANCE_FEATURE_USES);
}

/**
 * The riders a plan puts on a hit PC (AA2b): what `writeSheetChanges` would add to their sheet (conditions, effects,
 * Hope), as stored riders. A card tag's effect is marked `fromCondition` (Bold Presence avoids it with the conditions).
 */
export function ridersOf(before: CharacterSheet, after: CharacterSheet, steps: readonly PlanStep[], who: string): HitRider[] {
  const out: HitRider[] = [];
  for (const c of after.conditions) if (!before.conditions.includes(c)) out.push({ kind: "condition", condition: c });
  const tags = new Set(steps.flatMap((s) => (s.kind === "condition" && s.targetId === who && s.condition.kind === "tag" ? [s.condition.tag] : [])));
  for (const e of after.effects) {
    if (before.effects.some((b) => b.id === e.id)) continue;
    out.push({ kind: "effect", effect: e, ...(tags.has(e.text.split(";")[0] ?? "") ? { fromCondition: true } : {}) });
  }
  if (after.hope !== before.hope) out.push({ kind: "hope", delta: after.hope - before.hope });
  return out;
}

export const isAttackUse = (use: AdversaryFeatureUse) => use.roll?.kind === "adversaryAttack";

/** The uses an event sets off for this instance (AR8): `auto` ones run, `reaction` ones are offered (Q19, default No). */
export function triggered(block: Pick<Block, "effects">, instance: Doc<"encounterAdversaries">, events: readonly AdversaryEvent[]): TriggeredUse[] {
  const state = adversaryState(instance);
  const out: TriggeredUse[] = [];
  for (const event of events) {
    for (const t of triggeredUses(block.effects, event, state)) {
      if (!out.some((o) => o.effect.feature === t.effect.feature && o.use.id === t.use.id)) out.push(t);
    }
  }
  return out;
}

/** The ids of a use's optional steps (an opted-in reaction takes them all). */
export function optionalIds(use: AdversaryFeatureUse): string[] {
  const ids: string[] = [];
  const walk = (steps: readonly { kind: string; id?: string; steps?: readonly unknown[] }[]) => {
    for (const s of steps) {
      if (s.kind === "optional" && s.id) ids.push(s.id);
      if (Array.isArray(s.steps)) walk(s.steps as never);
    }
  };
  walk(use.steps as never);
  return ids;
}

/** Runs a use; the runner's refusal as its error code (COMBAT_TARGET_INVALID / INVALID without one). */
export function runOrThrow(effect: AdversaryFeatureEffect, context: AdversaryRunContext): AdversaryPlan {
  const result = rules(() => run(effect, context));
  if (result.ok) return result.plan;
  if (result.code) throw appError(result.code, result.detail, result.shortfall);
  throw appError(result.reason === "targets" ? "COMBAT_TARGET_INVALID" : "INVALID", result.detail);
}

export type Loaded = { instance: Doc<"encounterAdversaries">; encounter: Doc<"encounters">; block: Block; others: Doc<"encounterAdversaries">[] };

/**
 * The acting instance of a running encounter, its stat block and the encounter's instances; refusals as `useFeature`.
 * ADVERSARY_DEFEATED for a defeated adversary (marked defeated or every HP marked, `adversaryDefeated`; bead dcm-j5ft;
 * D8 Manual, only marked defeated: rule switches DEF):
 * it can't act at all, so neither its attack nor a feature runs, and none of them spotlights it.
 */
export async function loadActor(ctx: QueryCtx, campaign: Doc<"campaigns">, instanceId: string): Promise<Loaded> {
  const instance = await loadInstance(ctx, campaign._id, instanceId);
  const encounter = await loadEncounter(ctx, campaign._id, instance.encounterId);
  assertRunning(encounter);
  if (adversaryDefeated(campaign, instance)) throw appError("ADVERSARY_DEFEATED", "A defeated adversary can't act.");
  const block = await blockOf(ctx, instance);
  if (block === null) throw appError("ADVERSARY_FEATURE_UNAVAILABLE", "Its stat block is gone.");
  const others = await ctx.db
    .query("encounterAdversaries")
    .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
    .take(MAX_INSTANCES + 1);
  return { instance, encounter, block, others };
}

// ---------------------------------------------------------------- the spotlight

/**
 * Whether the instance holds the spotlight this GM turn, and the Fear spotlighting it now costs (CB p.153, p.194): the
 * turn's second spotlight, Relentless, "must spend a Fear to spotlight". 0 when the use needs no spotlight or it is spotlit.
 */
export function spotlightFearFor(
  instance: Doc<"encounterAdversaries">,
  encounter: Doc<"encounters">,
  others: readonly Doc<"encounterAdversaries">[],
  block: Block,
  passives: PassiveSummary,
  needsSpotlight: boolean,
): { spotlit: boolean; fear: number } {
  const spotlit = instance.spotlightTurn === encounter.gmTurn && instance.spotlights > 0;
  const fear =
    needsSpotlight && !spotlit
      ? spotlightCost({ spotlightsThisTurn: turnSpotlights(others, encounter.gmTurn), instanceSpotlights: 0, relentless: passives.relentless ?? block.relentless, costsFear: passives.spotlightCostsFear }).fear
      : 0;
  return { spotlit, fear };
}

// ---------------------------------------------------------------- featureAsk (AA2c)

/** Who a list argument of `useFeature` names: `side` as the entry reads it (`enemy` = PCs, `ally` = other adversaries). */
export type TargetAsk = { side: string; range: string; count: "one" | "upTo" | "all" | "any"; max: number | null; sight: boolean; /** dcm-y3mf: the shape of an "all targets" list ("front", "path"; the GM names its creatures). */ area?: string };

export type CostAsk = { fear: number; stress: number; hp: number; label: string };

/** What one use of a feature needs from the GM before `useFeature` runs it (AA3b's dialog). Nothing is rolled or paid. */
export type FeatureAsk = {
  feature: string;
  useId: string;
  /** Every use of the feature (pass one as `use` / `useId`); one entry for a manual feature. */
  uses: { id: string; activation: "action" | "reaction" | "auto" | "passive" }[];
  /** False: no effect entry (custom block, empty table): `useFeature` makes it a manual prompt with `text`. */
  automated: boolean;
  text?: string;
  activation: "action" | "reaction" | "auto";
  needsSpotlight: boolean;
  spotlit: boolean;
  /** False when a requirement the server can check fails or the limit is used up (`unavailable` says why). */
  available: boolean;
  unavailable: string[];
  /** The use rolls an attack (`targets` need line of sight on the live map; advantage / an Experience apply). */
  attack: boolean;
  /** A follow-up attack roll inside the use (`followUp` names its targets). */
  followUpAttack: boolean;
  targets: TargetAsk | null;
  picked: TargetAsk | null;
  allies: TargetAsk | null;
  followUp: TargetAsk | null;
  /** A reaction / automatic use fired by hand: what to pass as `trigger` (`source` / `subject` ids, the `amount`). */
  trigger: { kind: string; text?: string; source: boolean; subject: boolean; amount: boolean } | null;
  /** `choose` steps: pass `options [{id, values}]`. `count` null: decided by the run (a rolled or spent number). */
  options: { id: string; label: string; count: number | null; distinct: boolean; options: { id: string; label: string }[] }[];
  /** Optional steps the GM may take (Q19 default No): pass the ids as `optionals`. Their Fear comes out of the GM's Fear. */
  optionals: { id: string; label: string; fear: number; stress: number }[];
  /** Texts the GM confirms (`situations`): this use's requirements and gates, the passives and attack triggers that read them. */
  situations: { text: string; feature: string }[];
  /** Damage or clears "divided however you wish": pass `splits [{id: creature id, amount}]` among `among`. */
  splits: { what: "damage" | "clear" | "hope" | "stress" | "hp"; among: string; track?: string }[];
  /** `either` costs in the order the runner meets them: pass the picked option index per entry as `eitherCosts`. */
  eitherCosts: { index: number; options: (CostAsk & { index: number })[] }[];
  /** The Fear `useFeature` will ask for (`confirmFear`), with the first option of each `either` cost; `perTrigger`: the
   *  amount comes from the trigger (My Turn). An Experience adds 1 (`experiences`). */
  fear: { total: number; spotlight: number; feature: number; perTrigger: boolean; gmFear: number; enough: boolean };
  /** Stress the adversary marks up front. */
  stress: number;
  experiences: { name: string; value: number }[];
  /** `onAttack beforeDamage` reactions the GM may opt into for an attack (`reactions`, Q19 default No). */
  reactions: { feature: string; useId: string }[];
};

/** Calls `visit` on every step, nested branches included. */
function walkSteps(steps: readonly AdversaryStep[], visit: (s: AdversaryStep) => void): void {
  for (const s of steps) {
    visit(s);
    if (s.kind === "optional" || s.kind === "followUp") walkSteps(s.steps, visit);
    else if (s.kind === "choose") for (const o of s.options) walkSteps(o.steps, visit);
    else if (s.kind === "check") {
      walkSteps(s.then, visit);
      walkSteps(s.otherwise, visit);
    } else if (s.kind === "save") {
      walkSteps(s.onFail, visit);
      walkSteps(s.onSuccess, visit);
    }
  }
}

/** Lane E7 (dcm-bxp.78): what advances a feature's countdown, as its effect entry's `countdown` step says (V vocabulary). */
export function countdownTickOn(block: Pick<Block, "effects">, feature: string): Extract<AdversaryStep, { kind: "countdown" }>["tickOn"] {
  let found: Extract<AdversaryStep, { kind: "countdown" }>["tickOn"];
  for (const e of block.effects) {
    if (e.feature !== feature) continue;
    for (const u of e.uses) walkSteps(u.steps, (s) => {
      if (s.kind === "countdown" && s.tickOn !== undefined && found === undefined) found = s.tickOn;
    });
  }
  return found;
}

const fixedOf = (n: NumberSource | undefined): number | null => (n?.kind === "fixed" ? n.value : null);

function targetAsk(spec: TargetSpec): TargetAsk {
  const c = spec.count;
  const max = c.kind === "one" ? 1 : c.kind === "upTo" ? fixedOf(c.n) : c.kind === "any" ? fixedOf(c.max) : null;
  return { side: spec.side, range: spec.range, count: c.kind, max, sight: spec.sight === true, ...(spec.area ? { area: spec.area } : {}) };
}

const isTriggerTargets = (t: TargetSpec | TriggerTargets): t is TriggerTargets => t.side === "trigger";

/** A cost list as fixed numbers (a rolled or chosen amount counts 0 here; the run resolves it). */
function costAsk(costs: readonly AdversaryCost[]): CostAsk {
  const out = { fear: 0, stress: 0, hp: 0 };
  for (const c of costs) if (c.kind !== "either") out[c.kind] += fixedOf(c.amount) ?? 0;
  const label = [out.fear ? `${out.fear} Fear` : "", out.stress ? `${out.stress} Stress` : "", out.hp ? `${out.hp} HP` : ""].filter(Boolean).join(" + ");
  return { ...out, label: label || "Nothing" };
}

const situationsOfReqs = (reqs: readonly AdversaryRequirement[] | undefined) => (reqs ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : []));
const situationsOfGates = (gates: readonly Gate[] | undefined) =>
  (gates ?? []).flatMap((g) => (typeof g === "object" && g.kind === "requires" && g.requirement.kind === "situation" ? [g.requirement.text] : []));

/** The situation texts a use reads: its requirements and its steps' gates. */
function situationsOfUse(use: AdversaryFeatureUse): string[] {
  const out = situationsOfReqs(use.requires);
  walkSteps(use.steps, (s) => out.push(...situationsOfGates(s.when)));
  return out;
}

function requirementText(r: AdversaryRequirement): string {
  switch (r.kind) {
    case "hpMarkedAtLeast":
      return r.value === "half" ? "Needs half or more of its HP marked" : `Needs ${r.value} or more HP marked`;
    case "hpMarkedAtMost":
      return `Needs ${r.value} or fewer HP marked`;
    case "stressMarkedAtMost":
      return `Needs ${r.value} or fewer Stress marked`;
    case "hasCondition":
      return `Needs ${typeof r.condition === "string" ? r.condition : JSON.stringify(r.condition)}`;
    case "tokens":
      return r.atMost === 0 ? "Needs no token on its stat block" : `Needs ${r.atLeast ?? 0}${r.atMost !== undefined ? `-${r.atMost}` : "+"} tokens`;
    case "allyWithin":
      return `Needs an ally within ${r.range}`;
    case "situation":
      return r.text;
  }
}

/**
 * What one use of a feature needs before it runs (AA2c; user answer 2026-10-22: AA3b asks the GM in a dialog): the
 * targets and other creature lists, `choose` options, optional steps, situations, damage splits, `either` cost picks,
 * the Fear it will ask for and whether it is available now. Reads only; GM callers (it names the stat block's numbers).
 * ADVERSARY_FEATURE_UNAVAILABLE for a passive or unknown feature, a defeated instance or a lost stat block (as `useFeature`).
 */
export async function featureAsk(ctx: QueryCtx, campaign: Doc<"campaigns">, args: { instanceId: string; feature: string; use?: string }): Promise<FeatureAsk> {
  const { instance, encounter, block, others } = await loadActor(ctx, campaign, args.instanceId);
  const state = await campaignFearState(ctx, campaign._id);
  const effect = block.effects.find((e) => e.feature === args.feature);
  const manual = effect ? undefined : block.features.find((f) => f.name === args.feature);
  if (!effect && (!manual || manual.kind === "passive")) throw appError("ADVERSARY_FEATURE_UNAVAILABLE");
  const use = effect ? pickAdversaryUse(effect, args.use) : undefined;
  if (effect && (!use || use.activation.kind === "passive")) throw appError("ADVERSARY_FEATURE_UNAVAILABLE");
  const passives = passiveSummary(block.effects, { ...adversaryState(instance), situations: [] }, block.tier, () => 1, state.fear);
  const needsSpotlight = use ? use.needsSpotlight : manual!.kind === "action";
  const spot = spotlightFearFor(instance, encounter, others, block, passives, needsSpotlight);
  const experiences = block.experiences.map((e) => ({ name: e.name, value: e.value }));
  const none = { targets: null, picked: null, allies: null, followUp: null, trigger: null, options: [], optionals: [], splits: [], eitherCosts: [], reactions: [] };

  if (!effect || !use) {
    const feature = manual!.fearCost ?? featureFearCost(manual!.text) ?? 0;
    const total = spot.fear + feature;
    return {
      ...none,
      feature: manual!.name,
      useId: "main",
      uses: [{ id: "main", activation: manual!.kind === "reaction" ? "reaction" : "action" }],
      automated: false,
      text: manual!.text,
      activation: manual!.kind === "reaction" ? "reaction" : "action",
      needsSpotlight,
      spotlit: spot.spotlit,
      available: true,
      unavailable: [],
      attack: false,
      followUpAttack: false,
      targets: { side: "enemy", range: "unlimited", count: "any", max: null, sight: false },
      situations: [],
      fear: { total, spotlight: spot.fear, feature, perTrigger: false, gmFear: state.fear, enough: total <= state.fear },
      stress: 0,
      experiences,
    };
  }

  const self = selfCombatant(instance, block);
  const json = JSON.stringify(use);
  const ask: FeatureAsk = {
    ...none,
    feature: effect.feature,
    useId: use.id,
    uses: effect.uses.map((u) => ({ id: u.id, activation: u.activation.kind })),
    automated: true,
    activation: use.activation.kind as FeatureAsk["activation"],
    needsSpotlight,
    spotlit: spot.spotlit,
    available: true,
    unavailable: [],
    attack: isAttackUse(use),
    followUpAttack: false,
    situations: [],
    fear: { total: 0, spotlight: spot.fear, feature: 0, perTrigger: false, gmFear: state.fear, enough: true },
    stress: costAsk(use.costs ?? []).stress,
    experiences,
  };
  if (use.targets) {
    if (isTriggerTargets(use.targets)) ask.trigger = { kind: "", source: use.targets.who === "source", subject: use.targets.who === "subject", amount: false };
    else ask.targets = targetAsk(use.targets);
  }
  if (use.activation.kind === "reaction" || use.activation.kind === "auto") {
    const t = use.activation.trigger;
    ask.trigger = {
      kind: t.kind,
      ...(t.kind === "situation" ? { text: t.text } : {}),
      source: (ask.trigger?.source ?? false) || json.includes('"triggerSource"'),
      subject: (ask.trigger?.subject ?? false) || json.includes('"triggerSubject"'),
      amount: json.includes('"triggerAmount"'),
    };
  }

  // The steps: creature lists, choices, optionals, splits, `either` costs after the upfront ones.
  let eitherIndex = 0;
  const eitherOf = (costs: readonly AdversaryCost[] | undefined) => {
    for (const c of costs ?? []) {
      if (c.kind === "either") ask.eitherCosts.push({ index: eitherIndex++, options: c.options.map((o, index) => ({ index, ...costAsk(o) })) });
    }
  };
  eitherOf(use.costs);
  walkSteps(use.steps, (s) => {
    if (s.kind === "choose") ask.options.push({ id: s.id, label: s.label, count: s.count === undefined ? 1 : fixedOf(s.count), distinct: s.distinct === true, options: s.options.map((o) => ({ id: o.id, label: o.label })) });
    else if (s.kind === "optional") {
      const c = costAsk(s.costs ?? []);
      ask.optionals.push({ id: s.id, label: s.label, fear: c.fear, stress: c.stress });
      eitherOf(s.costs);
    } else if (s.kind === "pay") eitherOf(s.costs);
    else if (s.kind === "followUp") {
      ask.followUp ??= targetAsk(s.targets);
      if (s.roll?.kind === "adversaryAttack") ask.followUpAttack = true;
    } else if (s.kind === "spotlight" && s.who === "picked") ask.picked ??= { side: "ally", range: s.within ?? "unlimited", count: "one", max: 1, sight: false };
    if ("to" in s && "pick" in s && s.pick) {
      if (s.to === "picked") ask.picked ??= targetAsk(s.pick);
      else if (s.to === "allies" || s.to === "selfAndAllies") ask.allies ??= targetAsk(s.pick);
    } else if ("to" in s && (s.to === "allies" || s.to === "selfAndAllies")) ask.allies ??= { side: "ally", range: "unlimited", count: "any", max: null, sight: false };
    if ((s.kind === "damage" || s.kind === "clear") && s.distribution === "split") ask.splits.push({ what: s.kind, among: s.to, ...(s.kind === "clear" ? { track: s.track } : {}) });
    // Plan lanes-2 E7.4 (dcm-mvgc): a Hope gain "distributed among the PCs however they wish" (Stone of Omens, HF p.62),
    // Stress "distributed among allies as it chooses" (Mind Meld, HF p.74) and split HP are asked the same way.
    else if (s.kind === "hope" && s.change === "gain" && s.distribution === "split") ask.splits.push({ what: "hope", among: s.to });
    else if (s.kind === "markStress" && s.distribution === "split") ask.splits.push({ what: "stress", among: s.to });
    else if (s.kind === "markHp" && s.distribution === "split") ask.splits.push({ what: "hp", among: s.to });
  });

  // Situations the GM confirms: this use's, the passives' (they read the same list), and an attack's own triggers.
  const seen = new Set<string>();
  const addSituations = (texts: readonly string[], feature: string) => {
    for (const text of texts) {
      if (seen.has(text)) continue;
      seen.add(text);
      ask.situations.push({ text, feature });
    }
  };
  addSituations(situationsOfUse(use), effect.feature);
  for (const e of block.effects) {
    for (const u of e.uses) {
      const k = u.activation.kind;
      const t = k === "auto" || k === "reaction" ? u.activation.trigger.kind : null;
      if (k === "passive" || (ask.attack && (t === "onAttack" || t === "onHit"))) addSituations(situationsOfUse(u), e.feature);
    }
  }

  // Fear (Q19): the spotlight plus the upfront costs with the first option of each `either`.
  const feature = upfrontFear(use.costs, { self, tokens: instance.tokens ?? 0, tier: block.tier, gmFear: 0, rng: () => 1 });
  ask.fear = { total: spot.fear + feature, spotlight: spot.fear, feature, perTrigger: JSON.stringify(use.costs ?? []).includes('"triggerAmount"'), gmFear: state.fear, enough: spot.fear + feature <= state.fear };

  // Available now: requirements the server can check (situations are the GM's to confirm), the limit.
  const unmet = unmetAdversaryRequirements(use.requires, { ...adversaryState(instance), situations: situationsOfReqs(use.requires) });
  ask.unavailable.push(...unmet.map(requirementText));
  if (use.limit && !use.limit.perTarget) {
    const key = adversaryFeatureUseKey(block.adversaryId, effect.feature, use.id);
    const used = instanceUses(instance, encounter, state.sessionStartedAt).filter((u) => u.key === key).length;
    if (used >= (use.limit.times ?? 1)) ask.unavailable.push(`Used up this ${use.limit.period === "gmTurn" ? "GM turn" : use.limit.per === "scene" ? "scene" : use.limit.per === "session" ? "session" : "rest"}`);
  }
  ask.available = ask.unavailable.length === 0;

  if (ask.attack) {
    for (const t of triggeredUses(block.effects, { kind: "onAttack", stage: "beforeDamage", attack: "feature" }, adversaryState(instance))) {
      if (t.mode === "reaction") ask.reactions.push({ feature: t.effect.feature, useId: t.use.id });
    }
  }
  return ask;
}

// ---------------------------------------------------------------- lasting effects an adversary gives or carries (lanes-2, E7)

/** The prefix of the instance modifiers an adversary feature leaves (`adv:<adversaryId>/<feature>:<n>`). */
const ADVERSARY_INSTANCE_EFFECT = /^adv:([^/:]+)\/(.+):\d+$/;
/** A PC sheet effect an adversary feature left: `writeSheetChanges` keys it `card:<adversaryId>/<feature>:<n>`. */
const ADVERSARY_SHEET_EFFECT = /^card:([^/:]+)\/(.+):\d+$/;

const INSTANCE_UNTIL: Record<Duration, InstanceEffect["until"]> = {
  temporary: "temporary",
  rest: "temporary",
  longRest: "temporary",
  session: "temporary",
  scene: "scene",
  hit: "hit",
  nextRoll: "hit",
  manual: "temporary",
  permanent: "permanent",
};

/** The most modifiers kept on one instance (cardRows keeps the same cap; the oldest go first). */
const INSTANCE_EFFECTS_MAX = 20;

const fixedOr = (n: NumberSource | undefined, fallback: number) => (n === undefined ? fallback : n.kind === "fixed" ? n.value : fallback);

/** A vocabulary dice expression as the stat block prints it ("1d10+3 phy"). Numbers that aren't fixed read 1 die / +0. */
function printedDamage(d: Extract<ResolvedMod, { kind: "standardAttack" }>): string {
  const plus = fixedOr(d.damage.plus, 0);
  return `${fixedOr(d.damage.count, 1)}d${d.damage.sides}${plus > 0 ? `+${plus}` : plus < 0 ? `${plus}` : ""} ${d.type === "magic" ? "mag" : "phy"}`;
}

/** The fields of an instance modifier its mods give (shared by `effect` and condition modifiers). */
type ModFields = Omit<InstanceEffect, "id" | "source" | "label" | "until">;

/**
 * Lane E7 (rounds 2-3): what a list of resolved mods puts on an instance modifier: the Difficulty, attack, damage and
 * HP-marked deltas, Blighting Strike's half damage, Goad Them On's disadvantage, Evolution's new standard attack and
 * feature changes (dcm-gx3), and (round 3) `moveLimit` / `forcedMoveReduce` (dcm-3oe, dcm-wuu, dcm-1yo): a wind direction
 * is read from the use's option `choices[direction.choice]` (Hurricane: one of the eight map directions).
 */
export function instanceModFields(mods: readonly (ResolvedMod | Mod)[], choices?: Readonly<Record<string, readonly string[]>>): ModFields {
  const out: ModFields = {};
  const sum = (stat: string) => mods.reduce((s, m) => s + (m.kind === "stat" && m.stat === stat && typeof m.delta === "number" ? m.delta : 0), 0);
  for (const [stat, field] of [["difficulty", "difficulty"], ["attack", "attack"], ["damage", "damage"], ["hpMarked", "hpMarked"]] as const) {
    const delta = sum(stat);
    if (delta !== 0) out[field] = delta;
  }
  if (mods.some((m) => m.kind === "flag" && m.flag === "halfDamage")) out.halfDamage = true;
  if (mods.some((m) => m.kind === "disadvantage")) out.disadvantage = true;
  for (const m of mods) {
    if (m.kind === "standardAttack") out.standardAttack = { name: m.name.slice(0, 80), range: m.range, damage: printedDamage(m) };
    if (m.kind === "features") {
      if (m.remove && m.remove.length > 0) out.featuresRemoved = [...m.remove].slice(0, 20);
      if (m.add && m.add.length > 0) out.featuresAdded = [...m.add].slice(0, 20);
      if (m.removeOptions && m.removeOptions.length > 0) out.optionsRemoved = m.removeOptions.map((o) => ({ feature: o.feature.slice(0, 80), choose: o.choose.slice(0, 40), option: o.option.slice(0, 40) })).slice(0, 20);
    }
    if (m.kind === "forcedMoveReduce") out.forcedMoveReduce = (out.forcedMoveReduce ?? 0) + Math.max(0, Math.trunc(m.steps));
    if (m.kind === "moveLimit") {
      const direction = m.direction ? choices?.[m.direction.choice]?.[0] : undefined;
      out.moveLimit = { ...(m.maxRange ? { maxRange: m.maxRange } : {}), ...(direction ? { direction: direction.slice(0, 20) } : {}), ...(m.text ? { text: m.text.slice(0, 200) } : {}) };
    }
  }
  return out;
}

/** The next free id under `key` (`<key>:<n>`). */
function nextEffectId(existing: readonly InstanceEffect[], key: string): string {
  let n = 1;
  while (existing.some((e) => e.id === `${key}:${n}`) && n < 99) n++;
  return `${key}:${n}`;
}

/**
 * Lane E7, round 2 (dcm-gx3): the instance modifier an adversary feature's `effect` step on itself or an ally becomes
 * (`instanceModFields`). The id names the feature (`adv:<adversaryId>/<feature>:<n>`) so its riders can be read back from
 * the entry (`instanceBearerRiders`). Round 3: `choices` resolves a `moveLimit` wind direction; `endsOn` / `endFear` kept.
 */
export function adversaryInstanceEffect(
  existing: readonly InstanceEffect[],
  adversaryId: string,
  feature: string,
  step: Extract<PlanStep, { kind: "effect" }>,
  choices?: Readonly<Record<string, readonly string[]>>,
): InstanceEffect[] {
  const effect: InstanceEffect = { id: nextEffectId(existing, `adv:${adversaryId}/${feature}`), source: feature.slice(0, 80), label: step.label.slice(0, 120), until: INSTANCE_UNTIL[step.duration], ...instanceModFields(step.mods, choices) };
  if (step.endsOn && step.endsOn.length > 0) effect.endsOn = [...step.endsOn].slice(0, 10);
  if (step.endFear !== undefined) effect.endFear = step.endFear;
  // `replace` stacking (dcm-kkx): an older copy with this label goes first.
  const kept = step.stacking === "replace" ? existing.filter((e) => e.label !== effect.label) : existing;
  return [...kept, effect].slice(-INSTANCE_EFFECTS_MAX);
}

/** A condition plan step as `conditionInstanceEffect` reads it (the card runner's step, or E7's `conditionDetails`). */
export type ConditionFields = {
  condition: ConditionRef;
  mods?: readonly (ResolvedMod | Mod)[];
  endsOn?: readonly string[];
  endsOnCaster?: readonly string[];
  endsOnRoll?: RollEnd;
  escape?: Escape;
  recorded?: number;
  endFear?: number;
};

/** A condition's name as an instance stores it (a standard condition or the tag). */
const conditionName = (c: ConditionRef): string => (c.kind === "standard" ? c.condition : c.tag);

/**
 * Lane E7 round 3 (dcm-f70y, dcm-iedr, dcm-b77): the instance modifier a condition with entry fields becomes, so the
 * engine reads its mods (a tag's Difficulty change, a moveLimit) and its ends while the condition lasts. `key` names the
 * source (`adv:<adversaryId>/<feature>` or `card:<cardId>`); `casterId` is who gave it. Null when the condition carries
 * nothing beyond its name (the stored condition / tag is enough). Exported for the card runner (E4 writes a card's
 * conditions on instances through it).
 */
export function conditionInstanceEffect(existing: readonly InstanceEffect[], key: string, source: string, casterId: string, d: ConditionFields, choices?: Readonly<Record<string, readonly string[]>>): InstanceEffect[] | null {
  const fields = instanceModFields(d.mods ?? [], choices);
  const escape = d.escape
    ? {
        ...(d.escape.trait !== undefined ? { traits: [d.escape.trait].flat().map(String) } : {}),
        ...(d.escape.difficulty?.kind === "fixed" ? { difficulty: d.escape.difficulty.value } : {}),
        ...(d.escape.attack ? { attack: true } : {}),
      }
    : undefined;
  const endsOnRoll = d.endsOnRoll ? { roll: String(d.endsOnRoll.roll), ...(d.endsOnRoll.by ? { by: d.endsOnRoll.by } : {}), ...(d.endsOnRoll.result ? { result: d.endsOnRoll.result } : {}) } : undefined;
  const has = Object.keys(fields).length > 0 || (d.endsOn?.length ?? 0) > 0 || escape !== undefined || endsOnRoll !== undefined || (d.endsOnCaster?.length ?? 0) > 0 || d.recorded !== undefined || d.endFear !== undefined;
  if (!has) return null;
  const name = conditionName(d.condition);
  const effect: InstanceEffect = {
    id: nextEffectId(existing, key),
    source: source.slice(0, 80),
    label: name.slice(0, 120),
    until: "temporary",
    condition: name.slice(0, 80),
    casterId,
    ...fields,
    ...(d.endsOn && d.endsOn.length > 0 ? { endsOn: [...d.endsOn].slice(0, 10) } : {}),
    ...(d.endsOnCaster && d.endsOnCaster.length > 0 ? { endsOnCaster: [...d.endsOnCaster].slice(0, 10) } : {}),
    ...(endsOnRoll ? { endsOnRoll } : {}),
    ...(escape ? { escape } : {}),
    ...(d.recorded !== undefined ? { recorded: d.recorded } : {}),
    ...(d.endFear !== undefined ? { endFear: d.endFear } : {}),
  };
  // One modifier per condition and source: a second copy replaces the first.
  const kept = existing.filter((e) => !(e.condition === effect.condition && e.id.startsWith(`${key}:`)));
  return [...kept, effect].slice(-INSTANCE_EFFECTS_MAX);
}

/** Lane E7 round 3: modifiers that belong to a condition the instance no longer has go with it. */
export function withoutClearedConditions(effects: readonly InstanceEffect[], conditions: readonly string[], tags: readonly string[]): InstanceEffect[] {
  const held = new Set([...conditions, ...tags]);
  return effects.filter((e) => e.condition === undefined || held.has(e.condition));
}

// ---------------------------------------------------------------- plan lanes-2 E7.4 (dcm-thwj): instance condition ends

/**
 * The ends a stored condition modifier carries (`conditionInstanceEffect`), as the sheet ends read them; undefined for a
 * modifier tied to no condition or carrying no end. Stored names are `EndEvent` / `RollFilter` / `RollResult` strings.
 */
export function instanceEffectEnds(e: InstanceEffect): EffectEnds | undefined {
  if (e.condition === undefined) return undefined;
  const ends: EffectEnds = {
    ...(e.endsOn && e.endsOn.length > 0 ? { endsOn: e.endsOn as EndEvent[] } : {}),
    ...(e.endsOnCaster && e.endsOnCaster.length > 0 ? { endsOnCaster: e.endsOnCaster as EndEvent[] } : {}),
    ...(e.endsOnRoll
      ? { endsOnRoll: { roll: e.endsOnRoll.roll as RollEnd["roll"], ...(e.endsOnRoll.by ? { by: e.endsOnRoll.by } : {}), ...(e.endsOnRoll.result ? { result: e.endsOnRoll.result as RollResult } : {}) } }
      : {}),
  };
  return Object.keys(ends).length > 0 ? ends : undefined;
}

/** What an instance holds that a condition end changes. */
export type InstanceConditionState = { effects: readonly InstanceEffect[]; conditions: readonly string[]; tags: readonly string[] };

/**
 * The instance after `occ` (plan lanes-2 E7.4, dcm-thwj; dcm-iedr stored the fields). `role: "bearer"`: its own condition
 * modifiers whose `endsOn` / bearer `endsOnRoll` hold (it took damage, it rolled). `role: "caster"` with `casterId`: the
 * modifiers that creature gave it whose `endsOnCaster` / caster `endsOnRoll` hold ("until the caster takes Severe
 * damage"). Each ended modifier takes its condition or tag with it unless another modifier still holds it. `ended`: the
 * condition names that went. Pure; callers write and log it (undo puts the before-state back).
 */
export function endInstanceConditions(state: InstanceConditionState, occ: EndOccurrence, opts: { role: EndRole; casterId?: string }): InstanceConditionState & { ended: string[] } {
  const gone: InstanceEffect[] = [];
  for (const e of state.effects) {
    if (opts.role === "caster" && (e.casterId === undefined || e.casterId !== opts.casterId)) continue;
    const ends = instanceEffectEnds(e);
    if (ends !== undefined && endsOnOccurrence(ends, occ, opts.role)) gone.push(e);
  }
  if (gone.length === 0) return { ...state, ended: [] };
  const ids = new Set(gone.map((e) => e.id));
  const effects = state.effects.filter((e) => !ids.has(e.id));
  const stillHeld = new Set(effects.flatMap((e) => (e.condition === undefined ? [] : [e.condition])));
  const ended = [...new Set(gone.flatMap((e) => (e.condition === undefined ? [] : [e.condition])))].filter((c) => !stillHeld.has(c));
  const drop = new Set(ended);
  return { effects, conditions: state.conditions.filter((c) => !drop.has(c)), tags: state.tags.filter((t) => !drop.has(t)), ended };
}

/**
 * The made roll of an adversary's own action as an end reads it (its attack roll, or a feature's action roll): `success`
 * is the roll's result (an attack: it hit a target). An adversary rolls a d20, so no Duality Die applies.
 */
export function adversaryEndRoll(input: { attack: boolean; success: boolean }): EndRoll {
  return { kind: "action", ...(input.attack ? { attack: "other" as const } : {}), success: input.success };
}

/**
 * Lane E7 round 3 (dcm-3ag5, Transform, HF p.142-143): the `changeForm` modifier: the instance now uses the SRD stat
 * block `adversaryId` (its marked HP and Stress stay). Replaces an earlier form modifier.
 */
export function formInstanceEffect(existing: readonly InstanceEffect[], adversaryId: string, feature: string): InstanceEffect[] {
  const def = srdAdversary(adversaryId);
  const kept = existing.filter((e) => e.form === undefined);
  const effect: InstanceEffect = { id: nextEffectId(kept, `form:${feature}`.slice(0, 80)), source: feature.slice(0, 80), label: `Form: ${def?.name ?? adversaryId}`.slice(0, 120), until: "permanent", form: adversaryId };
  return [...kept, effect].slice(-INSTANCE_EFFECTS_MAX);
}

/** The SRD stat block an instance's latest `form` modifier names (Transform), or undefined. */
export function formOf(instance: Pick<Doc<"encounterAdversaries">, "effects">): AdversaryDef | undefined {
  const form = [...(instance.effects ?? [])].reverse().find((e) => e.form !== undefined)?.form;
  return form === undefined ? undefined : srdAdversary(form);
}

/**
 * Lane E7 round 3: the instance's numbers as the engine reads them: its stored stats, or under a `form` modifier the
 * form's stat block (Difficulty, thresholds, HP and Stress maximums; marks are kept).
 */
export function instanceStatsOf(instance: Pick<Doc<"encounterAdversaries">, "effects" | "stats">): Doc<"encounterAdversaries">["stats"] {
  const def = formOf(instance);
  if (def === undefined) return instance.stats;
  return { difficulty: def.difficulty, major: def.thresholds.major, severe: def.thresholds.severe, hpMax: def.hp, stressMax: def.stress ?? 0 };
}

/** The steps of the entry a lasting effect came from: an adversary feature (`<adversaryId>/<feature>`) or a card / PC feature. */
function entrySteps(source: { adversaryId: string; feature: string } | { sourceId: string }): readonly unknown[] {
  if ("adversaryId" in source) return (adversaryEffects(source.adversaryId).find((e) => e.feature === source.feature)?.uses ?? []).map((u) => u.steps);
  // E6 (dcm-i2tv): a lookup can return the whole entry; walk its upgrades' options too.
  const entry = srdUses(source.sourceId);
  if (entry === undefined) return [];
  if (Array.isArray(entry)) return entry.map((u) => u.steps);
  const whole = entry as { uses: readonly { steps: unknown }[]; upgrades?: readonly unknown[] };
  return [...whole.uses.map((u) => u.steps), ...(whole.upgrades ?? [])];
}

type LastingMods = { label: string; source: string; adversaryId?: string; mods: readonly Mod[] };

/** Every sheet effect's entry mods (dcm-xyw, dcm-yd5h): adversary features' tags and conditions, cards' effects. */
function sheetLasting(sheet: Pick<CharacterSheet, "effects">): LastingMods[] {
  const out: LastingMods[] = [];
  for (const e of sheet.effects) {
    const label = e.text.split("; ")[0] ?? "";
    const adv = ADVERSARY_SHEET_EFFECT.exec(e.id);
    if (adv) {
      out.push({ label, source: e.source, adversaryId: adv[1]!, mods: lastingModsOf(entrySteps({ adversaryId: adv[1]!, feature: adv[2]! }), label) });
      continue;
    }
    const src = effectSource(e);
    if (src) out.push({ label, source: e.source, mods: lastingModsOf(entrySteps({ sourceId: src.sourceId }), src.label) });
  }
  return out;
}

/**
 * Lane E7, round 2 (dcm-xyw, dcm-yd5h, dcm-51s, dcm-346): the `attackedRider`s an adversary's attack on this PC gets
 * from what the PC carries (Mark Target's mark, Chokehold's Vulnerable, Breaking Blow). `by`: `anyone` always; `caster`
 * when the rider came from this adversary's stat block; `others` when it didn't; `pcs` never (an adversary attacks).
 */
export function attackedRidersOn(sheet: Pick<CharacterSheet, "effects">, attackerAdversaryId: string): AttackedRider[] {
  const out: AttackedRider[] = [];
  for (const l of sheetLasting(sheet)) {
    const own = l.adversaryId === attackerAdversaryId;
    for (const m of l.mods) {
      if (m.kind !== "attackedRider") continue;
      const r = m.rider;
      if (r.by === "anyone" || (r.by === "caster" && own) || (r.by === "others" && !own)) out.push(r);
    }
  }
  return out;
}

/**
 * Lane E7, round 2 (dcm-mm0f, adversary half; dcm-f0m, dcm-bxp.99.19.3): the `bearerRider`s on what this instance
 * carries (a card's On Fire or Poisoned, an adversary feature's modifier) that fire on `on`. The steps are the entry's;
 * the server turns them into GM prompts.
 */
export function instanceBearerRiders(instance: Pick<Doc<"encounterAdversaries">, "effects" | "tags">, on: readonly BearerRider["on"][]): { label: string; source: string; rider: BearerRider }[] {
  const out: { label: string; source: string; rider: BearerRider }[] = [];
  const seen = new Set<string>();
  for (const e of instance.effects ?? []) {
    const adv = ADVERSARY_INSTANCE_EFFECT.exec(e.id);
    const src = adv ? null : instanceEffectSource(e);
    const steps = adv ? entrySteps({ adversaryId: adv[1]!, feature: adv[2]! }) : src ? entrySteps({ sourceId: src.sourceId }) : [];
    seen.add(e.label);
    for (const m of lastingModsOf(steps, e.label)) if (m.kind === "bearerRider" && on.includes(m.rider.on)) out.push({ label: e.label, source: e.source, rider: m.rider });
  }
  // A card's tag on an enemy (Cinder Grasp's On Fire) is stored as the tag alone: its riders come from the entry
  // that gives a tag of that name.
  for (const tag of instance.tags ?? []) {
    if (seen.has(tag)) continue;
    const found = tagEntry(tag);
    if (found) for (const m of found.mods) if (m.kind === "bearerRider" && on.includes(m.rider.on)) out.push({ label: tag, source: found.source, rider: m.rider });
  }
  return out;
}

let TAG_ENTRIES: Map<string, { source: string; mods: readonly Mod[] }> | null = null;

/** The first SRD entry (card, PC feature, adversary feature) that gives a tag of this name with mods, cached. */
function tagEntry(tag: string): { source: string; mods: readonly Mod[] } | undefined {
  if (TAG_ENTRIES === null) {
    const map = new Map<string, { source: string; mods: readonly Mod[] }>();
    const add = (source: string, uses: readonly { steps: readonly unknown[] }[]) => {
      for (const [name, step] of conditionStepsOf(uses.map((u) => u.steps))) {
        if (step.condition.kind === "tag" && step.mods && step.mods.length > 0 && !map.has(name)) map.set(name, { source, mods: step.mods });
      }
    };
    for (const e of allCardEffects().values()) add(e.cardId, e.uses);
    for (const e of allFeatureEffects().values()) add(e.featureId, e.uses);
    for (const list of allAdversaryEffects().values()) for (const e of list) add(e.feature, e.uses);
    TAG_ENTRIES = map;
  }
  return TAG_ENTRIES.get(tag);
}

/** Plan lanes-2 E7.4: what a bearer rider does to its own bearer, when the server can run every step of it. */
export type SelfRiderSteps = { damage: { count: number; sides: number; plus: number; type: "physical" | "magic"; direct: boolean }[]; stress: number; hp: number };

/**
 * Plan lanes-2 E7.4 (dcm-mm0f adversary half, dcm-0wj1, dcm-f0m, dcm-bxp.99.19.3, dcm-kti): a bearer rider whose steps
 * all land on the bearer itself with fixed numbers (Cinder Grasp's On Fire, CB p.328: "an extra 2d6 magic damage";
 * Poisoned, CB p.32-33: "1d10 direct physical damage each time they act"; a Stress per action): the server runs them.
 * Null when any step is something else (a choice, a roll, another creature, a non-fixed number): the GM keeps the prompt.
 * Costs on the rider (a Hope to act, Shadow Shackles) are the PC's and keep the prompt too.
 */
export function selfRiderSteps(rider: BearerRider): SelfRiderSteps | null {
  if ((rider.costs?.length ?? 0) > 0 || rider.roll !== undefined) return null;
  const out: SelfRiderSteps = { damage: [], stress: 0, hp: 0 };
  const fixed = (n: NumberSource | undefined, fallback: number) => (n === undefined ? fallback : n.kind === "fixed" ? n.value : null);
  for (const s of rider.steps) {
    if (!("to" in s) || s.to !== "self" || ("when" in s && s.when !== undefined)) return null;
    if (s.kind === "damage") {
      if (s.roll?.kind !== "dice" || (s.type !== "physical" && s.type !== "magic")) return null;
      const d = s.roll.dice as { count: NumberSource; sides?: number; plus?: NumberSource };
      const count = fixed(d.count, 1);
      const plus = fixed(d.plus, 0);
      if (count === null || plus === null || d.sides === undefined) return null;
      out.damage.push({ count, sides: d.sides, plus, type: s.type, direct: s.direct === true });
    } else if (s.kind === "markStress" || s.kind === "markHp") {
      const n = fixed(s.amount, 1);
      if (n === null || s.distribution === "split") return null;
      if (s.kind === "markStress") out.stress += n;
      else out.hp += n;
    } else return null;
  }
  return out.damage.length > 0 || out.stress > 0 || out.hp > 0 ? out : null;
}

/** A short line for a rider's steps (a GM prompt): the step kinds, with the dice of a damage step when they are fixed. */
export function riderStepsText(steps: readonly Step[]): string {
  return steps
    .map((s) => {
      if (s.kind === "damage" && s.roll && s.roll.kind === "dice") {
        const d = s.roll.dice as { count: NumberSource; sides?: number; plus?: NumberSource };
        const plus = fixedOr(d.plus, 0);
        return d.sides === undefined ? "damage" : `${fixedOr(d.count, 1)}d${d.sides}${plus ? `+${plus}` : ""} ${s.type ?? ""} damage`.replace(/\s+/g, " ").trim();
      }
      if (s.kind === "markHp" || s.kind === "markStress") return `mark ${"amount" in s ? fixedOr(s.amount as NumberSource | undefined, 1) : 1} ${s.kind === "markHp" ? "HP" : "Stress"}`;
      return s.kind;
    })
    .join(", ");
}

/**
 * Lane E7, round 2 (dcm-e16o, dcm-ttz, dcm-8rh): the creatures `creatureCount` counts, seen from `selfId`. With the live
 * map: every token there, with its squares to the adversary (`fromSelf`) and to the first target (`fromTarget`).
 * Without one (Q18): the party PCs and the encounter's undefeated instances, with no distances.
 */
export function mapCreatures(
  selfId: string,
  instances: readonly Pick<Doc<"encounterAdversaries">, "_id" | "defeated" | "source" | "label">[],
  party: readonly { character: { _id: string } }[],
  map: { tokens: readonly Doc<"combatTokens">[]; self: Doc<"combatTokens">; target?: Doc<"combatTokens"> } | null,
): MapCreature[] {
  const nameOf = (i: Pick<Doc<"encounterAdversaries">, "source" | "label">) => (i.source.kind === "srd" ? (srdAdversary(i.source.adversaryId)?.name ?? i.label) : i.label);
  if (map === null) {
    return [
      ...party.map((m): MapCreature => ({ id: m.character._id, side: "enemy", pc: true })),
      ...instances.filter((i) => !i.defeated).map((i): MapCreature => ({ id: i._id, side: i._id === selfId ? "self" : "ally", pc: false, name: nameOf(i) })),
    ];
  }
  const out: MapCreature[] = [];
  for (const t of map.tokens) {
    const distances = { fromSelf: tokenDistance(map.self, t), ...(map.target ? { fromTarget: tokenDistance(map.target, t) } : {}) };
    if (t.ref.kind === "pc") out.push({ id: t.ref.characterId, side: "enemy", pc: true, ...distances });
    else if (t.ref.kind === "adversary") {
      const id = t.ref.adversaryId;
      const inst = instances.find((i) => i._id === id);
      if (inst === undefined || inst.defeated) continue;
      out.push({ id, side: id === selfId ? "self" : "ally", pc: false, name: nameOf(inst), ...distances });
    }
  }
  return out;
}

/** Lane E7, round 2 (dcm-idz; user answer 2026-10-31): the tag a GM-controlled PC carries. */
export const GM_CONTROLLED = "GM-controlled";

/**
 * Lane E7, round 2 (dcm-idz): whether the GM controls this PC now (Enthralled, HF p.92; Weredrake Curse, HF p.143): an
 * effect labelled `GM-controlled`, or one whose entry carries `Mod gmControl`. `asAdversary`: the stat block the PC uses
 * meanwhile (the Weredrake's), when the entry names one. Null when not controlled.
 */
export function gmControlOf(sheet: Pick<CharacterSheet, "effects">): { asAdversary?: AdversaryDef } | null {
  let controlled = sheet.effects.some((e) => (e.text.split("; ")[0] ?? "") === GM_CONTROLLED);
  let asAdversary: AdversaryDef | undefined;
  for (const l of sheetLasting(sheet)) {
    for (const m of l.mods) {
      if (m.kind !== "gmControl") continue;
      controlled = true;
      const def = m.asAdversary === undefined ? undefined : (srdAdversary(m.asAdversary) ?? ADVERSARIES.find((a) => a.name === m.asAdversary));
      if (def) asAdversary = def;
    }
  }
  return controlled ? (asAdversary ? { asAdversary } : {}) : null;
}
