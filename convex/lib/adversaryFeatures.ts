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
import { adversaryFeatureId, adversaryFeatureUseKey, pickAdversaryUse, run, upfrontFear, type AdversaryPlan, type AdversaryRunContext, type InstanceModifiers, type StandardAttack } from "../../src/lib/domain/adversary-effects/run";
import type { AdversaryCost, AdversaryFeatureEffect, AdversaryFeatureUse, AdversaryRequirement, AdversaryStep } from "../../src/lib/domain/adversary-effects/types";
import { passiveSummary, spotlightCost, triggeredUses, unmetAdversaryRequirements, type AdversaryEvent, type AdversaryState, type PassiveSummary, type TriggeredUse } from "../../src/lib/domain/adversary-actions/index";
import { featureFearCost, hordeDamage, relentlessValue } from "../../src/lib/domain/adversaries/index";
import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import type { Gate, Limit, NumberSource, TargetSpec, TriggerTargets } from "../../src/lib/domain/card-effects/types";
import type { Combatant } from "../../src/lib/domain/combat-actions/index";
import { turnSpotlights } from "../../src/lib/domain/encounters/spotlight";
import { appError } from "../../src/lib/errors/app-error";
import { ADVERSARIES } from "../../src/lib/srd/adversaries";
import { adversaryEffects } from "../../src/lib/srd/adversary-effects/index";
import { alwaysOnResistance } from "../../src/lib/srd/adversary-resistance";
import type { AdversaryDef } from "../../src/lib/srd/types";
import type { CharacterSheet, FeatureUse } from "../../src/lib/validation/characters";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { assertRunning, loadEncounter, loadInstance, MAX_INSTANCES } from "./encounters";
import { campaignFearState } from "./fear";
import { rules } from "./rolls";
import type { AdversaryBefore } from "./validators/actionLog";
import type { HitRider } from "./validators/combatRequests";
import { MAX_INSTANCE_FEATURE_USES, type InstanceFeatureUse } from "./validators/encounters";

const SRD_BY_ID = new Map<string, AdversaryDef>(ADVERSARIES.map((a) => [a.id, a]));

// ---------------------------------------------------------------- the stat block

export type BlockFeature = { name: string; kind: "passive" | "action" | "reaction" | "evolution"; text: string; fearCost?: number };

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

/** The instance's stat block, or null when its source is gone. The instance's own resistance wins (CA2, Q8). */
export async function blockOf(ctx: QueryCtx, instance: Doc<"encounterAdversaries">): Promise<Block | null> {
  const own = instance.resistance;
  const fromInstance = own === undefined ? undefined : own.conditional === undefined || instance.resistanceActive === true ? { physical: own.physical, magic: own.magic } : { physical: "none" as const, magic: "none" as const };
  if (instance.source.kind === "srd") {
    const def = SRD_BY_ID.get(instance.source.adversaryId);
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
  return {
    id: instance._id,
    side: "adversary",
    difficulty: instance.stats.difficulty + (instance.effects ?? []).reduce((s, e) => s + (e.difficulty ?? 0), 0),
    thresholds: { major: instance.stats.major, severe: instance.stats.severe },
    hp: instance.hp,
    hpMax: instance.stats.hpMax,
    stress: instance.stress,
    stressMax: instance.stats.stressMax,
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
  let best: { length: number; per: Limit["per"] } | null = null;
  const consider = (prefix: string, per: Limit["per"]) => {
    if ((key === prefix || key.startsWith(`${prefix}:`)) && (best === null || prefix.length > best.length)) best = { length: prefix.length, per };
  };
  for (const e of block.effects) {
    for (const u of e.uses) {
      if (u.limit) consider(adversaryFeatureUseKey(block.adversaryId, e.feature, u.id), u.limit.per);
      for (const step of limitedSteps(u.steps)) consider(`card:${adversaryFeatureId(block.adversaryId, e.feature)}:${u.id}:${step.id}`, step.limit.per);
    }
  }
  return (best as { per: Limit["per"] } | null)?.per ?? null;
}

/**
 * Whether a stored use still counts (AA2b, AA2c): recorded in this run of the encounter (per-scene limits reset when
 * it ends), or a session limit recorded in the live session (user answer 2026-10-22: "'once per session' adversary
 * features last the whole session (reset at session end)"). `session` is `campaignState.sessionStartedAt`.
 */
export function useCounts(u: InstanceFeatureUse, scene: number, session: number | undefined): boolean {
  return u.scene === scene || (u.session !== undefined && u.session === session);
}

/**
 * The instance's limited feature uses that still count (AA2b; "Once per scene", TASK-CA-AA1 Q4): the entries recorded
 * in this run of the encounter, and (AA2c) session-limited ones of the live session (`session`, optional: without it
 * only the scene's count).
 */
export function instanceUses(instance: Doc<"encounterAdversaries">, encounter: Doc<"encounters">, session?: number): FeatureUse[] {
  const scene = sceneOf(encounter);
  return (instance.featureUses ?? []).filter((u) => useCounts(u, scene, session)).map((u) => ({ key: u.key, until: u.until }));
}

/**
 * The instance's stored uses after an action recorded `added` (AA2c): the ones that still count, then the new ones with
 * this scene and, for a session limit while a session is live, the session (it then outlasts the encounter). Without a
 * live session a session limit is kept for the scene only. At most MAX_INSTANCE_FEATURE_USES (oldest dropped).
 */
export function storedUses(instance: Doc<"encounterAdversaries">, encounter: Doc<"encounters">, block: Block, added: readonly FeatureUse[], session: number | undefined): InstanceFeatureUse[] {
  const scene = sceneOf(encounter);
  const kept = (instance.featureUses ?? []).filter((u) => useCounts(u, scene, session));
  // A sheet's `featureUses` gained `scene` (sheet-drawer SD0); an instance's scene limit is `session` stamped with `scene`.
  const fresh = added.map((u) => ({ key: u.key, until: u.until === "scene" ? ("session" as const) : u.until, scene, ...(session !== undefined && limitPerOf(block, u.key) === "session" ? { session } : {}) }));
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
  if (result.code) throw appError(result.code, result.detail);
  throw appError(result.reason === "targets" ? "COMBAT_TARGET_INVALID" : "INVALID", result.detail);
}

export type Loaded = { instance: Doc<"encounterAdversaries">; encounter: Doc<"encounters">; block: Block; others: Doc<"encounterAdversaries">[] };

/** The acting instance of a running encounter, its stat block and the encounter's instances; refusals as `useFeature`. */
export async function loadActor(ctx: QueryCtx, campaign: Doc<"campaigns">, instanceId: string): Promise<Loaded> {
  const instance = await loadInstance(ctx, campaign._id, instanceId);
  const encounter = await loadEncounter(ctx, campaign._id, instance.encounterId);
  assertRunning(encounter);
  if (instance.defeated) throw appError("ADVERSARY_FEATURE_UNAVAILABLE", "A defeated adversary can't act.");
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
export type TargetAsk = { side: string; range: string; count: "one" | "upTo" | "all" | "any"; max: number | null; sight: boolean };

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
  splits: { what: "damage" | "clear"; among: string; track?: string }[];
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

const fixedOf = (n: NumberSource | undefined): number | null => (n?.kind === "fixed" ? n.value : null);

function targetAsk(spec: TargetSpec): TargetAsk {
  const c = spec.count;
  const max = c.kind === "one" ? 1 : c.kind === "upTo" ? fixedOf(c.n) : c.kind === "any" ? fixedOf(c.max) : null;
  return { side: spec.side, range: spec.range, count: c.kind, max, sight: spec.sight === true };
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
    if (used >= (use.limit.times ?? 1)) ask.unavailable.push(`Used up this ${use.limit.per === "scene" ? "scene" : use.limit.per === "session" ? "session" : "rest"}`);
  }
  ask.available = ask.unavailable.length === 0;

  if (ask.attack) {
    for (const t of triggeredUses(block.effects, { kind: "onAttack", stage: "beforeDamage", attack: "feature" }, adversaryState(instance))) {
      if (t.mode === "reaction") ask.reactions.push({ feature: t.effect.feature, useId: t.use.id });
    }
  }
  return ask;
}
