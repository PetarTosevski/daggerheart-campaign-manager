/**
 * The rows a domain card use writes (plan combat-actions, tracers CA4 / CA4b; docs/tasks/TASK-CA-CA4.md,
 * TASK-CA-CA4b.md): the encounter instances it changes (HP, Stress, defeated, conditions, tags and, since CA4b, the
 * card's modifiers in the instance's `effects`), the words of its actionLog rows, and the shapes a caller returns.
 *
 * U1: the public words and the returns hold Hit / Miss / Defeated, the player's own dice and card text; an enemy's HP,
 * Stress, thresholds, Difficulty and modifiers are only on the GM's row. U4: every changed instance's `adversaryBefore`
 * (with `effects` when the use changed them, CA4b's widened validator) goes on the GM row so undo puts it back.
 *
 * Plan sheet-drawer SD3: a feature use writes the same rows. Its modifiers on an instance are `feat:<featureId>:<n>`
 * (Hex's lower Difficulty and damage, Make a Scene's Distracted); a card's stay `card:<cardId>:<n>`.
 */
import { v, type Infer } from "convex/values";

import type { PlanStep, ResolvedMod, RunPlan } from "../../src/lib/domain/card-effects/run";
import type { CardUse, ConditionRef, Duration, EndEvent, NumberSource, RollEnd, Step, Upgrade } from "../../src/lib/domain/card-effects/types";
import { endEffects, endsOnOccurrence, gmFearToEnd, tokensGoneKeys, withoutLapsedUnstoppable, type EffectEnds, type EndOccurrence, type EndRole } from "../../src/lib/domain/characters/expiry";
import { tierForLevel } from "../../src/lib/domain/characters/index";
import { FEATURE_KEY_PREFIX } from "../../src/lib/domain/feature-effects/ids";
import type { RollRecord } from "../../src/lib/domain/duality";
import { SEVERITY_LABEL } from "../../src/lib/domain/encounters/damage";
import { owned } from "../../src/lib/domain/feature-effects/owned";
import { TRAIT_LABEL } from "../../src/lib/frames/extras/common";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import { getDomainCard } from "../../src/lib/srd/index";
import type { TraitId } from "../../src/lib/srd/types";
import type { CharacterSheet, Condition, Effect } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { activeAreasOnMap, areaSpecOf, endArea } from "../combatAreas";
import { logAction } from "./actionLog";
import { cardIdOfEffect, difficultyOf, effectKeyOf, effectOption, endRollOf, featureIdOfEffect, isFeatureUseId, lapsedConditions, tokenIdsOf, type BuiltRun, type Creatures, type EnemyCreature } from "./cardRunner";
import { readSheet, saveSheet } from "./characterSheet";
import { MAX_INSTANCES } from "./encounters";
import { bandsOnMap, openIncomingHit, partyMembers } from "./incomingHits";
import { ENCOUNTER_CONDITIONS, type EncounterCondition, type InstanceEffect } from "./validators/encounters";
import { rollValidator, type AdversaryBefore } from "./validators/actionLog";
import { rangeBandValidator } from "./validators/combatRequests";

// ---------------------------------------------------------------- what a caller returns

/** One target as the player learns it (U1). */
const cardTargetValidator = v.object({ tokenId: v.id("combatTokens"), hit: v.boolean(), defeated: v.boolean() });

/** Something left to the table: a manual step, a movement, a PC's reaction roll, damage to a PC, an outcome for another roll. */
export const cardPromptValidator = v.object({
  kind: v.union(v.literal("manual"), v.literal("move"), v.literal("pcSave"), v.literal("pcDamage"), v.literal("fold")),
  text: v.string(),
  tokenIds: v.array(v.id("combatTokens")),
});
export type CardPrompt = Infer<typeof cardPromptValidator>;

/** The Minions a player may pick after a card's damage (Q6, CB p.201): the same shape as the weapon attack's offer. */
const cardMinionOfferValidator = v.object({
  requestId: v.id("combatRequests"),
  extra: v.number(),
  candidates: v.array(v.object({ instanceId: v.id("encounterAdversaries"), tokenId: v.id("combatTokens"), name: v.string(), available: v.number() })),
});

/** `useCard` (and the GM's approval) resolved: the player's own dice and per-target hit / miss / defeated. Never a stat. */
export const resolvedCardValidator = v.object({
  status: v.literal("resolved"),
  entryId: v.id("actionLog"),
  cardId: v.string(),
  useId: v.string(),
  /** The card's own roll (null without one). A fixed Difficulty is the card's printed number, never an enemy's. */
  roll: v.union(v.null(), rollValidator),
  /** The damage rolls of the use (Q5: the player sees their own damage totals). */
  damage: v.array(rollValidator),
  success: v.boolean(),
  targets: v.array(cardTargetValidator),
  /** The GM's Fear change from this use (the roll with Fear, a card's Fear step). */
  fearDelta: v.number(),
  prompts: v.array(cardPromptValidator),
  minionOffer: v.union(v.null(), cardMinionOfferValidator),
});
export type ResolvedCard = Infer<typeof resolvedCardValidator>;

/** An out-of-range use waiting for the GM (Q1). */
export const pendingCardValidator = v.object({
  status: v.literal("pending"),
  requestId: v.id("combatRequests"),
  outOfRange: v.array(v.object({ tokenId: v.id("combatTokens"), band: rangeBandValidator })),
});

/**
 * A choice the card needs before it can run (a `choose` step or a damage / clear split); nothing was paid or written.
 * When the choice comes after the roll its dice are kept server-side (convex/lib/cardChoices.ts) and the next use of the
 * card resolves with them.
 */
export const needsChoiceValidator = v.object({
  status: v.literal("needsChoice"),
  asks: v.array(
    v.union(
      v.object({
        kind: v.literal("choose"),
        stepId: v.string(),
        label: v.string(),
        options: v.array(v.object({ id: v.string(), label: v.string() })),
        /** Plan lanes-2 E6 (dcm-sc54): the chooser of a `choose` step with `by` (the client answers `by:<stepId>:<chooserId>`). */
        chooserId: v.optional(v.id("combatTokens")),
      }),
      v.object({ kind: v.literal("split"), label: v.string(), tokenIds: v.array(v.id("combatTokens")) }),
      /** Plan lanes-2 E6 (dcm-sc54): the creatures of the next link of a repeating follow-up (the client answers `chain:<link>`). */
      v.object({ kind: v.literal("followUp"), label: v.string(), link: v.number(), tokenIds: v.array(v.id("combatTokens")) }),
    ),
  ),
});
export type ChoiceAsks = Infer<typeof needsChoiceValidator>["asks"];

// ---------------------------------------------------------------- encounter instances

const ENCOUNTER_SET = new Set<string>(ENCOUNTER_CONDITIONS);

type InstancePatch = { hp: number; stress: number; defeated: boolean; conditions: EncounterCondition[]; tags: string[]; effects?: InstanceEffect[] };

export type InstanceWrite = { creature: EnemyCreature; before: AdversaryBefore; patch: InstancePatch };

/** An instance as it was (U4). `withEffects`: the use changes its `effects`, so undo must put them back (CA4b). */
export function adversaryBefore(instance: Doc<"encounterAdversaries">, withEffects = false): AdversaryBefore {
  return {
    instanceId: instance._id,
    hp: instance.hp,
    stress: instance.stress,
    defeated: instance.defeated,
    ...(instance.minionCount !== undefined ? { minionCount: instance.minionCount } : {}),
    conditions: instance.conditions,
    tags: instance.tags,
    ...(withEffects ? { effects: instance.effects ?? [] } : {}),
  };
}

/** A card's duration on an instance: the GM clears it, its next attack, the scene's end, or for good. */
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

/** The most modifiers kept on one instance (the oldest go first). */
const INSTANCE_EFFECTS_MAX = 20;

/** The prefix of a use's instance modifiers: `card:<cardId>`, or `feat:<featureId>` for a feature (SD3). */
function instanceKey(id: string): string {
  return isFeatureUseId(id) ? `feat:${id}` : `card:${id}`;
}

/**
 * Whether an instance modifier belongs to this card or feature (`<prefix>:<n>`, or `<prefix>:<n>~<caster token id>`
 * for one that ends on its caster's events, lane E6).
 */
function ownsInstanceEffect(effectId: string, id: string): boolean {
  const prefix = `${instanceKey(id)}:`;
  return effectId.startsWith(prefix) && /^\d+(~.+)?$/.test(effectId.slice(prefix.length));
}

/** The next free `<prefix>:<n>` on an instance; `caster`: the `~<token id>` suffix of a caster-ended one (lane E6). */
function nextInstanceId(existing: readonly InstanceEffect[], cardId: string, caster?: string): string {
  let n = 1;
  const key = instanceKey(cardId);
  while (existing.some((e) => e.id === `${key}:${n}` || e.id.startsWith(`${key}:${n}~`)) && n < 99) n++;
  return `${key}:${n}${caster !== undefined ? `~${caster}` : ""}`;
}

/** Whether an entry step's ends read its caster (lane E6): its instance id then names the caster's token. */
function endsOnCaster(ends: EffectEnds | undefined): boolean {
  return ends !== undefined && ((ends.endsOnCaster ?? []).length > 0 || ends.endsOnRoll?.by === "caster");
}

/**
 * The instance modifier a card's `effect` step on an enemy becomes (CA0's `instanceEffectValidator`): Difficulty, attack,
 * damage and HP-marked deltas and Blighting Strike's half damage are numbers the engine reads; the rest is the label.
 */
function instanceEffect(existing: readonly InstanceEffect[], cardId: string, cardName: string, step: Extract<PlanStep, { kind: "effect" }>, caster?: string, lookup: SourceLookup = srdUses): InstanceEffect {
  const casterEnded = caster !== undefined && endsOnCaster(stepEnds(cardId, step.label, lookup)?.ends);
  const sum = (stat: string) => step.mods.reduce((s, m: ResolvedMod) => s + (m.kind === "stat" && m.stat === stat ? m.delta : 0), 0);
  const effect: InstanceEffect = { id: nextInstanceId(existing, cardId, casterEnded ? caster : undefined), source: cardName.slice(0, 80), label: step.label.slice(0, 120), until: INSTANCE_UNTIL[step.duration] };
  for (const [stat, field] of [["difficulty", "difficulty"], ["attack", "attack"], ["damage", "damage"], ["hpMarked", "hpMarked"]] as const) {
    const delta = sum(stat);
    if (delta !== 0) effect[field] = delta;
  }
  if (step.mods.some((m) => m.kind === "flag" && m.flag === "halfDamage")) effect.halfDamage = true;
  return effect;
}

/**
 * Each enemy's `effects` after the plan's `effect` steps (an exclusive card's older ones removed first), by token id, and
 * the conditions / tags to drop because their marker ended (`drops`).
 *
 * Plan lanes-2 E6: an `endEffect` step on an enemy ends the modifiers and condition markers its card or feature made
 * (dcm-9z2z: Confusing Aura "this spell ends", CB p.329; `option` narrows to the step of that option); an `effect` step
 * with `stacking: "replace"` ends the older copy with its label from the same entry first, one with `refuse` is not added
 * when the instance already carries that label (Blight Seed, HF p.9: "This effect can't stack"; dcm-kkx).
 */
function effectsAfter(plan: RunPlan, creatures: Creatures, cardName: string, lookup: SourceLookup): { effects: Map<string, InstanceEffect[]>; drops: Map<string, Set<string>> } {
  const out = new Map<string, InstanceEffect[]>();
  const drops = new Map<string, Set<string>>();
  const caster = creatures.onMap ? (creatures.scene.attacker._id as string) : undefined;
  const listOf = (tokenId: string, c: EnemyCreature): InstanceEffect[] => {
    const prior = out.get(tokenId);
    if (prior !== undefined) return prior;
    const own = c.instance.effects ?? [];
    return plan.exclusive ? own.filter((e) => !ownsInstanceEffect(e.id, plan.cardId)) : [...own];
  };
  for (const step of plan.steps) {
    if (step.kind !== "effect" && step.kind !== "condition" && step.kind !== "endEffect") continue;
    const c = creatures.get(step.targetId);
    if (!c || c.kind !== "enemy") continue;
    if (step.kind === "endEffect") {
      const list = listOf(step.targetId, c);
      const kept = list.filter((e) => !instanceMadeBy(e, step.of, step.option, lookup));
      if (kept.length === list.length) continue;
      const dropped = drops.get(step.targetId) ?? new Set<string>();
      for (const e of list) if (!kept.includes(e) && stepEnds(step.of, e.label, lookup)?.kind === "condition") dropped.add(e.label);
      drops.set(step.targetId, dropped);
      out.set(step.targetId, kept);
      continue;
    }
    // Lane E6: a condition that ends on an event leaves a marker modifier (its name as the label) so the end can find it.
    const marker = step.kind === "condition" ? conditionMarker(plan.cardId, cardName, step, caster, lookup) : null;
    if (step.kind === "condition" && marker === null) continue;
    let list = listOf(step.targetId, c);
    if (step.kind === "effect" && step.stacking !== undefined && step.stacking !== "stack") {
      const label = step.label.slice(0, 120);
      const copy = (e: InstanceEffect) => ownsInstanceEffect(e.id, plan.cardId) && e.label === label;
      if (step.stacking === "refuse" && list.some(copy)) continue;
      if (step.stacking === "replace") list = list.filter((e) => !copy(e));
    }
    const next = step.kind === "effect" ? instanceEffect(list, plan.cardId, cardName, step, caster, lookup) : marker!(list);
    out.set(step.targetId, [...list, next].slice(-INSTANCE_EFFECTS_MAX));
  }
  return { effects: out, drops };
}

/** Whether an instance modifier came from `of` (a card or feature id), narrowed to the step of `option` when set. */
function instanceMadeBy(effect: InstanceEffect, of: string, option: string | undefined, lookup: SourceLookup): boolean {
  if (!ownsInstanceEffect(effect.id, of)) return false;
  return option === undefined || stepEnds(of, effect.label, lookup)?.option === option;
}

/**
 * The instance rows a plan changes. A Minion group is one instance whose HP are its Minions: a hit Minion marks one HP,
 * `defeat` without an amount takes the whole group, with an amount that many (CB p.201). A card's `effect` on an enemy
 * lands in the instance's `effects` (CA4b).
 */
export function instanceWrites(plan: RunPlan, creatures: Creatures, cardName: string, lookup: SourceLookup = srdUses): InstanceWrite[] {
  const { effects, drops } = effectsAfter(plan, creatures, cardName, lookup);
  const writes: InstanceWrite[] = [];
  const withEffects = (c: EnemyCreature, patch: Omit<InstancePatch, "effects">): InstanceWrite => {
    const next = effects.get(c.tokenId);
    // Plan lanes-2 E6 (dcm-9z2z): a condition whose marker an `endEffect` step ended goes with it.
    const dropped = drops.get(c.tokenId);
    const kept = dropped === undefined ? patch : { ...patch, conditions: patch.conditions.filter((x) => !dropped.has(x)), tags: patch.tags.filter((t) => !dropped.has(t)) };
    return { creature: c, before: adversaryBefore(c.instance, next !== undefined), patch: next !== undefined ? { ...kept, effects: next } : kept };
  };
  for (const changed of plan.creatures) {
    const c = creatures.get(changed.id);
    if (!c || c.kind !== "enemy") continue;
    const inst = c.instance;
    const after = changed.after;
    let hp = after.hp;
    if (c.minion) {
      const defeats = plan.steps.filter((s): s is Extract<PlanStep, { kind: "defeat" }> => s.kind === "defeat" && s.targetId === changed.id);
      const whole = defeats.some((d) => d.amount === undefined);
      const counted = defeats.reduce((n, d) => n + (d.amount ?? 0), 0);
      hp = whole ? inst.stats.hpMax : Math.min(inst.stats.hpMax, inst.hp + (after.hp > 0 ? 1 : 0) + counted);
    }
    hp = Math.max(0, Math.min(inst.stats.hpMax, hp));
    const conditions = after.conditions.filter((x): x is EncounterCondition => ENCOUNTER_SET.has(x));
    writes.push(
      withEffects(c, {
        hp,
        stress: Math.max(0, Math.min(inst.stats.stressMax, after.stress)),
        defeated: inst.defeated || hp >= inst.stats.hpMax,
        conditions: [...new Set(conditions)],
        tags: [...new Set(after.tags ?? [])].slice(0, 20),
      }),
    );
  }
  const unchanged = (c: EnemyCreature, hp = c.instance.hp): Omit<InstancePatch, "effects"> => ({ hp, stress: c.instance.stress, defeated: c.instance.defeated || hp >= c.instance.stats.hpMax, conditions: c.instance.conditions, tags: c.instance.tags });
  // A Minion group hit by `defeat` with an amount is not in `plan.creatures` (the runner doesn't change it).
  for (const step of plan.steps) {
    if (step.kind !== "defeat" || step.amount === undefined || writes.some((w) => w.creature.tokenId === step.targetId)) continue;
    const c = creatures.get(step.targetId);
    if (!c || c.kind !== "enemy") continue;
    writes.push(withEffects(c, unchanged(c, Math.min(c.instance.stats.hpMax, c.instance.hp + step.amount))));
  }
  // An enemy that only gained a modifier (Glyph of Nightfall).
  for (const tokenId of effects.keys()) {
    const c = creatures.get(tokenId);
    if (!c || c.kind !== "enemy" || writes.some((w) => w.creature.tokenId === c.tokenId)) continue;
    writes.push(withEffects(c, unchanged(c)));
  }
  return writes.map((w) => endedByDamage(plan, w, lookup));
}

const SEVERITY_RANK = { none: 0, minor: 1, major: 2, severe: 3 } as const;

/**
 * Lane E6 (dcm-utu): the plan's damage to an enemy ends the modifiers and conditions it already had that end on it
 * (Slumber, CB p.332: "Asleep until they take damage"; Jump Scare, HF p.181: "Vulnerable until they mark 1 or more Hit
 * Points"). What the same use gives is not ended by its own damage.
 */
function endedByDamage(plan: RunPlan, w: InstanceWrite, lookup: SourceLookup): InstanceWrite {
  const hits = plan.steps.flatMap((s) => (s.kind === "damage" && s.result.targetId === (w.creature.tokenId as string) ? [s.result] : []));
  const inst = w.creature.instance;
  const earlier = new Set((inst.effects ?? []).map((e) => e.id));
  if (hits.length === 0 || earlier.size === 0) return w;
  const severity = hits
    .map((h) => (h.severity === "defeat" ? "minor" : h.severity))
    .reduce<keyof typeof SEVERITY_RANK>((a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a), "none");
  const hpMarked = Math.max(0, w.patch.hp - inst.hp);
  const occ: EndOccurrence = { kind: "damageTaken", severity, hpMarked, lastHp: hpMarked > 0 && w.patch.hp >= inst.stats.hpMax };
  const out = endInstanceEffects({ effects: w.patch.effects ?? inst.effects ?? [], conditions: w.patch.conditions, tags: w.patch.tags }, occ, { only: (e) => earlier.has(e.id), lookup });
  if (out.patch === null) return w;
  return { creature: w.creature, before: adversaryBefore(inst, true), patch: { ...w.patch, ...out.patch } };
}

/** Writes the instances (U4: the GM row's `adversaryBefore` lets undo put them back). */
export async function writeInstances(ctx: MutationCtx, writes: readonly InstanceWrite[]): Promise<void> {
  const now = Date.now();
  for (const w of writes) await ctx.db.patch("encounterAdversaries", w.creature.instance._id, { ...w.patch, updatedAt: now });
}

// ---------------------------------------------------------------- the rows' words

const SHORT_TYPE = { physical: "phy", magic: "mag", both: "phy/mag" } as const;

export function rollWord(roll: RollRecord): string {
  if (roll.outcome === "critical") return "critical";
  if (roll.outcome === "none") return "";
  return roll.outcome === "successHope" || roll.outcome === "failHope" ? "with Hope" : "with Fear";
}

function diceList(roll: RollRecord): string {
  return roll.dice.filter((d) => !d.dropped).map((d) => d.value).join(", ");
}

/** "Spellcast 15 with Hope", "Agility 12 with Fear (vs 13)". The card's printed Difficulty only (never an enemy's). */
export function rollText(use: CardUse, roll: RollRecord, trait: TraitId | undefined): string {
  const spec = use.roll;
  let label = "Roll";
  if (spec?.kind === "spellcast" || (spec?.kind === "reaction" && spec.trait === "spellcast")) label = "Spellcast";
  else if (spec?.kind === "reaction" && spec.trait !== "spellcast") label = TRAIT_LABEL[spec.trait];
  else if (spec?.kind === "trait") label = TRAIT_LABEL[typeof spec.trait === "string" ? spec.trait : trait && spec.trait.includes(trait) ? trait : spec.trait[0]!];
  else if (spec?.kind === "attack") label = "Attack";
  const versus = roll.difficulty !== undefined ? ` vs ${roll.difficulty}` : "";
  return `${label} ${roll.total}${versus} ${rollWord(roll)}`.trim();
}

/** The public words per target (U1): Hit, Miss or Defeated, and nothing numeric. */
export function publicTargets(plan: RunPlan, built: BuiltRun, writes: readonly InstanceWrite[]): { parts: string[]; outcomes: Infer<typeof cardTargetValidator>[] } {
  const parts: string[] = [];
  const outcomes: Infer<typeof cardTargetValidator>[] = [];
  for (const t of built.targets) {
    if (t.kind === "self") continue;
    const id = t.tokenId as string;
    const hit = plan.hits.find((h) => h.id === id)?.hit ?? false;
    const write = writes.find((w) => w.creature.tokenId === t.tokenId);
    const defeated = t.kind === "enemy" ? (write?.patch.defeated ?? t.instance.defeated) : false;
    const name = t.kind === "enemy" ? t.instance.label : t.sheet.name;
    outcomes.push({ tokenId: t.tokenId, hit, defeated });
    parts.push(`${name}: ${defeated ? "Defeated" : hit ? "Hit" : "Miss"}`);
  }
  return { parts, outcomes };
}

/** The GM's words: damage → severity → HP per enemy, marks, conditions, modifiers, saves, misses against the Difficulty. */
export function gmLines(plan: RunPlan, built: BuiltRun, writes: readonly InstanceWrite[]): string[] {
  const lines: string[] = [];
  const name = (id: string) => {
    if (id === built.context.actor.id) return "self";
    const c = built.creatures.get(id);
    return c === undefined ? "?" : c.kind === "enemy" ? c.instance.label : c.kind === "pc" ? c.sheet.name : "self";
  };
  const total = plan.roll?.record.total;
  for (const h of plan.hits) {
    const c = built.creatures.get(h.id);
    if (!h.hit && c?.kind === "enemy" && total !== undefined) lines.push(`${c.instance.label}: miss (${total} vs Difficulty ${difficultyOf(c.instance)})`);
  }
  for (const step of plan.steps) {
    if (step.kind === "damage") {
      const r = step.result;
      lines.push(`${name(r.targetId)}: ${r.incoming}${r.resisted !== "none" ? ` (${r.resisted}: ${r.taken})` : ""} → ${SEVERITY_LABEL[r.severity]} → ${r.hpMarked} HP`);
    } else if (step.kind === "mark") lines.push(`${name(step.targetId)}: marks ${step.amount} ${step.track}${step.overflow ? " (full: 1 HP)" : ""}`);
    else if (step.kind === "save") lines.push(`${name(step.targetId)}: reaction ${step.record.total} vs ${step.difficulty} → ${step.success ? "succeeds" : "fails"}`);
    else if (step.kind === "condition") lines.push(`${name(step.targetId)}: ${step.condition.kind === "standard" ? step.condition.condition : step.condition.tag}`);
    else if (step.kind === "defeat") lines.push(`${name(step.targetId)}: defeated${step.amount !== undefined ? ` (${step.amount})` : ""}`);
    else if (step.kind === "effect" && built.creatures.get(step.targetId)?.kind === "enemy") lines.push(`${name(step.targetId)}: ${step.label} (on the instance)`);
  }
  for (const id of plan.excluded) lines.push(`${name(id)}: not affected (the card's filter)`);
  for (const w of writes) lines.push(`${w.creature.instance.label} now ${w.patch.hp}/${w.creature.instance.stats.hpMax} HP, ${w.patch.stress}/${w.creature.instance.stats.stressMax} Stress${w.patch.defeated ? ", defeated" : ""}`);
  return lines;
}

/** The damage rolls of the plan, for the player and the public row (Q5). */
export function damageRolls(plan: RunPlan): { roll: RollRecord; text: string }[] {
  return plan.steps.flatMap((s) => (s.kind === "damageRoll" ? [{ roll: s.record, text: `${s.record.total} ${SHORT_TYPE[s.type]}${diceList(s.record) ? ` (${diceList(s.record)})` : ""}` }] : []));
}

/** What the table still does by hand (manual steps, moves, PC reaction rolls, damage to PCs, outcomes for other rolls). */
export function promptsOf(plan: RunPlan, built: BuiltRun): CardPrompt[] {
  const name = (id: string) => {
    if (id === built.context.actor.id) return "You";
    const c = built.creatures.get(id);
    return c?.kind === "pc" ? c.sheet.name : c?.kind === "enemy" ? c.instance.label : "?";
  };
  const out: CardPrompt[] = [];
  for (const s of plan.steps) {
    if (s.kind === "prompt" && (s.prompt === "manual" || s.prompt === "move" || s.prompt === "pcSave")) {
      out.push({ kind: s.prompt, text: s.prompt === "pcSave" ? `${s.targetIds.map(name).join(", ")}: make a reaction roll` : s.text, tokenIds: tokenIdsOf(built, s.targetIds) });
    } else if (s.kind === "pcDamage") {
      out.push({ kind: "pcDamage", text: `${name(s.targetId)} takes ${s.amount} ${s.type === "both" ? "physical and magic" : s.type} damage${s.direct ? " (direct)" : ""}: mark it on the sheet`, tokenIds: tokenIdsOf(built, [s.targetId]) });
    } else if (s.kind === "fold") {
      const amount = s.amount === undefined ? "" : ` (${s.amount})`;
      out.push({ kind: "fold", text: `${s.step.note ?? s.step.kind}${amount}`, tokenIds: tokenIdsOf(built, s.targetIds) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- card damage to another PC (AA2b)

/**
 * Card damage to another PC opens the same incoming hit as an adversary attack (user answer 2026-10-22, bead
 * dcm-bxp.99.22: "a card that damages an ally (e.g. Fireball's blast) gives that ally the same incoming-hit prompt (armor
 * choice, ally reactions)"). One row per PC the plan's `pcDamage` steps name (their damage totalled, R2), with a PC
 * `attacker`, in the card use's actionLog group so the use's undo declines or reverts it. Returns the map tokens whose
 * damage became a hit (their `pcDamage` prompts are dropped by the caller).
 */
export async function openCardHits(
  ctx: MutationCtx,
  input: { plan: RunPlan; built: BuiltRun; campaignId: Id<"campaigns">; groupId: string; actorId: Id<"users">; attacker: { characterId: Id<"characters">; label: string; cardId: string; feature: string } },
): Promise<Set<string>> {
  const { plan, built } = input;
  const totals = new Map<string, { amount: number; type: "physical" | "magic" | "both"; direct: boolean }>();
  for (const s of plan.steps) {
    if (s.kind !== "pcDamage") continue;
    const prior = totals.get(s.targetId);
    totals.set(s.targetId, prior ? { amount: prior.amount + s.amount, type: prior.type === s.type ? prior.type : "both", direct: prior.direct || s.direct } : { amount: s.amount, type: s.type, direct: s.direct });
  }
  const handled = new Set<string>();
  if (totals.size === 0) return handled;
  const encounter = await ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", input.campaignId).eq("status", "running"))
    .first();
  const mapId = built.creatures.scene.map._id;
  const bands = await bandsOnMap(ctx, mapId);
  for (const [targetId, hit] of totals) {
    const c = built.creatures.get(targetId);
    if (c?.kind !== "pc" || hit.amount <= 0) continue;
    await openIncomingHit(ctx, {
      campaignId: input.campaignId,
      ...(encounter ? { encounterId: encounter._id } : {}),
      mapId,
      createdBy: input.actorId,
      groupId: input.groupId,
      attacker: { kind: "pc", characterId: input.attacker.characterId, label: input.attacker.label, cardId: input.attacker.cardId, feature: input.attacker.feature },
      targetCharacterId: c.character._id,
      targetTokenId: c.tokenId,
      hit: { amount: hit.amount, type: hit.type, direct: hit.direct, forcedArmor: 0, critical: plan.roll?.critical ?? false },
      party: await partyMembers(ctx, input.campaignId),
      bands,
    });
    handled.add(c.tokenId);
  }
  return handled;
}

// ---------------------------------------------------------------- effect endings (plan lanes, tracer E6)
//
// docs/tasks/TASK-LN-E6.md. The pure engine is `endEffects` (src/lib/domain/characters/expiry.ts); this section finds an
// effect's ends in its entry and applies them to sheets and encounter instances. Nothing about the ends is stored: a
// sheet effect `card:<cardId>:<n>` / `feat:<hash>:<n>` and an instance effect `card:<cardId>:<n>` / `feat:<featureId>:<n>`
// name their entry, and the effect's label (the sheet text's first part) names the step. A condition on an enemy that
// ends on an event gets a marker modifier with the condition's name as its label (`effectsAfter`), and one that ends on
// its caster's events carries the caster's token: `<prefix>:<n>~<token id>`.
//
// The callers fire the events where they happen (follow-up beads per lane): a resolved hit (`damageTaken`), a roll
// (`roll`), damage dealt, a GM Fear spend, a defeat. Each one saves what it gets back in its own undo group.

/** A card or feature entry: its uses and the upgrades that add options (Reliable Backup's, CB p.43). */
export type SourceEntry = { uses: readonly CardUse[]; upgrades?: readonly Upgrade[] };

/** The uses of a card or feature entry by id, or the whole entry (tests pass fixture entries). */
export type SourceLookup = (sourceId: string) => readonly CardUse[] | SourceEntry | undefined;

/**
 * The SRD entries: a card's or a feature's whole entry. Plan lanes-2 E6 (dcm-i2tv): the upgrades too, so an effect step
 * an upgrade adds (Reliable Backup's "shield" and "backup" options to Contacts Everywhere) has its ends on the server.
 */
export const srdUses: SourceLookup = (sourceId) => cardEffect(sourceId) ?? featureEffect(sourceId);

/**
 * An entry's lasting step (an `effect`, or a `condition` by its name) with its ends and its flags; `option`: the option
 * an effect step stands for (NV7), which an `endEffect` step's `option` narrows to.
 */
export type EndStep = { kind: "effect" | "condition"; label: string; ends: EffectEnds; flags: readonly string[]; option?: string };

type LastingStep = Extract<Step, { kind: "effect" }> | Extract<Step, { kind: "condition" }>;

function conditionName(condition: ConditionRef): string {
  return condition.kind === "standard" ? condition.condition : condition.tag;
}

function toEndStep(step: LastingStep): EndStep {
  const flags = (step.mods ?? []).flatMap((m) => (m.kind === "flag" ? [m.flag as string] : []));
  const ends: EffectEnds = {
    duration: step.duration,
    ...(step.endsOn ? { endsOn: step.endsOn } : {}),
    ...(step.endsOnRoll ? { endsOnRoll: step.endsOnRoll } : {}),
    ...(step.endsOnCaster ? { endsOnCaster: step.endsOnCaster } : {}),
    ...(step.kind === "effect" && step.maintain ? { maintain: step.maintain } : {}),
    ...(step.endFear ? { endFear: step.endFear } : {}),
    ...(step.kind === "effect" && step.sharedGrant ? { sharedGrant: true } : {}),
  };
  return step.kind === "effect"
    ? { kind: "effect", label: step.label, ends, flags, ...(step.option !== undefined ? { option: step.option } : {}) }
    : { kind: "condition", label: conditionName(step.condition), ends, flags };
}

/** Every `effect` and `condition` step anywhere in the uses (options, saves, checks, follow-ups, table rows). */
function lastingSteps(value: unknown, out: EndStep[]): EndStep[] {
  if (Array.isArray(value)) {
    for (const v of value) lastingSteps(v, out);
  } else if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ((o.kind === "effect" || o.kind === "condition") && "duration" in o) out.push(toEndStep(o as unknown as LastingStep));
    for (const v of Object.values(o)) lastingSteps(v, out);
  }
  return out;
}

const SRD_STEPS = new Map<string, EndStep[]>();

/** The lasting step of an entry with this label (the first one), or undefined. */
export function stepEnds(sourceId: string, label: string, lookup: SourceLookup = srdUses): EndStep | undefined {
  let steps = lookup === srdUses ? SRD_STEPS.get(sourceId) : undefined;
  if (steps === undefined) {
    steps = lastingSteps(lookup(sourceId) ?? [], []);
    if (lookup === srdUses) SRD_STEPS.set(sourceId, steps);
  }
  const short = label.slice(0, 120);
  return steps.find((s) => s.label === label || s.label.slice(0, 120) === short);
}

/**
 * D5 class actions write their own sheet effects (no `card:` / `feat:` id). Marked for Death (HF p.8): D5's effect is the
 * assassin's record of the tag the feature entry puts on the target.
 */
const D5_EFFECTS: Readonly<Record<string, { sourceId: string; label: string }>> = {
  "marked-for-death": { sourceId: "class:assassin:marked-for-death", label: "Marked for Death" },
};

/** The entry and step a sheet effect came from, or null (a hand-written effect, a marker). */
export function effectSource(effect: Pick<Effect, "id" | "text">): { sourceId: string; label: string } | null {
  const alias = D5_EFFECTS[effect.id];
  if (alias) return alias;
  const sourceId = cardIdOfEffect(effect as Effect) ?? featureIdOfEffect(effect);
  return sourceId === null ? null : { sourceId, label: effect.text.split("; ")[0] ?? "" };
}

/** A sheet effect's ends from its entry (the `EndsOf` the pure engine takes). */
export function effectEndsOf(effect: Effect, lookup: SourceLookup = srdUses): EffectEnds | undefined {
  const source = effectSource(effect);
  return source === null ? undefined : stepEnds(source.sourceId, source.label, lookup)?.ends;
}

const INSTANCE_ID = /^(card|feat):(.+):(\d+)(?:~(.+))?$/;

/** The entry an instance modifier came from and its caster's token (a caster-ended one), or null. */
export function instanceEffectSource(effect: Pick<InstanceEffect, "id" | "label">): { sourceId: string; label: string; caster?: string } | null {
  const m = INSTANCE_ID.exec(effect.id);
  if (!m) return null;
  return { sourceId: m[2]!, label: effect.label, ...(m[4] !== undefined ? { caster: m[4] } : {}) };
}

/** Whether these ends hold an event besides the stance drop (which `stanceDrop.ts` ends through its own markers). */
function hasEventEnds(ends: EffectEnds): boolean {
  return (ends.endsOn ?? []).some((e) => e !== "stanceDrops") || ends.endsOnRoll !== undefined || (ends.endsOnCaster ?? []).length > 0;
}

/** The marker an event-ended condition on an enemy leaves (`effectsAfter`), or null for a condition without such ends. */
function conditionMarker(cardId: string, cardName: string, step: Extract<PlanStep, { kind: "condition" }>, caster: string | undefined, lookup: SourceLookup): ((existing: readonly InstanceEffect[]) => InstanceEffect) | null {
  const name = conditionName(step.condition);
  const found = stepEnds(cardId, name, lookup)?.ends ?? { duration: step.duration };
  const endsOn = [...new Set([...(found.endsOn ?? []), ...(step.endsOn ?? [])])];
  const ends: EffectEnds = { ...found, ...(endsOn.length > 0 ? { endsOn } : {}) };
  if (!hasEventEnds(ends)) return null;
  return (existing) => ({ id: nextInstanceId(existing, cardId, endsOnCaster(ends) ? caster : undefined), source: cardName.slice(0, 80), label: name.slice(0, 120), until: INSTANCE_UNTIL[step.duration] });
}

type InstanceState = Pick<Doc<"encounterAdversaries">, "effects" | "conditions" | "tags">;

/**
 * The instance after `occ`: the modifiers it ends gone, and with a condition's marker the condition (standard) or tag
 * too. `role: "caster"` with `casterTokenId`: only the modifiers that caster made. `patch` is null when nothing ends.
 */
export function endInstanceEffects(
  instance: InstanceState,
  occ: EndOccurrence,
  opts: { role?: EndRole; casterTokenId?: string; only?: (effect: InstanceEffect) => boolean; lookup?: SourceLookup } = {},
): { patch: { effects: InstanceEffect[]; conditions: EncounterCondition[]; tags: string[] } | null; ended: InstanceEffect[] } {
  const role = opts.role ?? "bearer";
  const ended: InstanceEffect[] = [];
  let conditions = instance.conditions;
  let tags = instance.tags ?? [];
  const effects = (instance.effects ?? []).filter((e) => {
    if (opts.only && !opts.only(e)) return true;
    const source = instanceEffectSource(e);
    if (source === null || (role === "caster" && (source.caster === undefined || source.caster !== opts.casterTokenId))) return true;
    const step = stepEnds(source.sourceId, source.label, opts.lookup);
    if (step === undefined || !endsOnOccurrence(step.ends, occ, role)) return true;
    ended.push(e);
    if (step.kind === "condition") {
      if (ENCOUNTER_SET.has(step.label)) conditions = conditions.filter((c) => c !== step.label);
      else tags = tags.filter((t) => t !== step.label);
    }
    return false;
  });
  return ended.length === 0 ? { patch: null, ended } : { patch: { effects, conditions, tags }, ended };
}

/** The feed line of an ended modifier or condition. */
function endedLine(name: string, label: string, source: string): string {
  return `${name}: ${label} ends (${source})`;
}

/**
 * Bearer side on one instance (Slumber, CB p.332: "Asleep until they take damage"; Midnight Vine, HF p.9: "until it marks
 * a Stress"): patches it and returns the instance before (for the caller's GM row `adversaryBefore`) and the GM lines.
 */
export async function endOnInstance(ctx: MutationCtx, instance: Doc<"encounterAdversaries">, occ: EndOccurrence, lookup?: SourceLookup): Promise<{ before: AdversaryBefore | null; lines: string[] }> {
  const out = endInstanceEffects(instance, occ, lookup ? { lookup } : {});
  if (out.patch === null) return { before: null, lines: [] };
  await ctx.db.patch("encounterAdversaries", instance._id, { ...out.patch, updatedAt: Date.now() });
  return { before: adversaryBefore(instance, true), lines: out.ended.map((e) => endedLine(instance.label, e.label, e.source)) };
}

/**
 * Caster side on the running encounters' instances (Timejammer, CB p.334: "It resumes the next time you make an action
 * roll that targets another creature"): every modifier and condition the caster's token made that `occ` ends.
 */
export async function endForCasterOnInstances(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  casterTokenId: string,
  occ: EndOccurrence,
  lookup?: SourceLookup,
  /** Plan lanes-2 E6: leave this card's or feature's own modifiers ("cast another spell": not the one just cast). */
  except?: string,
): Promise<{ before: AdversaryBefore[]; lines: string[] }> {
  const before: AdversaryBefore[] = [];
  const lines: string[] = [];
  const encounters = await ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId).eq("status", "running"))
    .take(4);
  const suffix = `~${casterTokenId}`;
  for (const encounter of encounters) {
    const instances = await ctx.db
      .query("encounterAdversaries")
      .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
      .take(MAX_INSTANCES);
    for (const instance of instances) {
      if (instance.campaignId !== campaignId || !(instance.effects ?? []).some((e) => e.id.endsWith(suffix))) continue;
      const out = endInstanceEffects(instance, occ, { role: "caster", casterTokenId, ...(lookup ? { lookup } : {}), ...(except !== undefined ? { only: (e) => instanceEffectSource(e)?.sourceId !== except } : {}) });
      if (out.patch === null) continue;
      before.push(adversaryBefore(instance, true));
      await ctx.db.patch("encounterAdversaries", instance._id, { ...out.patch, updatedAt: Date.now() });
      lines.push(...out.ended.map((e) => endedLine(instance.label, e.label, e.source)));
    }
  }
  return { before, lines };
}

/** Bearer side on a PC sheet (`endEffects` with the entries' ends) plus the feed lines. */
export function endOnSheet(
  sheet: CharacterSheet,
  occ: EndOccurrence,
  opts: { role?: EndRole; only?: (effect: Effect) => boolean; maintained?: ReadonlySet<string>; lookup?: SourceLookup } = {},
): { sheet: CharacterSheet; ended: Effect[]; maintainable: Effect[]; lines: string[] } {
  const out = endEffects(sheet, occ, (e) => effectEndsOf(e, opts.lookup), {
    ...(opts.role ? { role: opts.role } : {}),
    ...(opts.only ? { only: opts.only } : {}),
    ...(opts.maintained ? { maintained: opts.maintained } : {}),
  });
  const lines = out.ended.map((e) => endedLine(sheet.name, e.text.split("; ")[0] ?? e.source, e.source));
  return { ...out, lines };
}

/** Whether a PC holds a card (in the loadout) or a feature (owned) by id: who can have made an effect from it. */
export function holdsSource(sheet: CharacterSheet, sourceId: string): boolean {
  if (sheet.domainCards.loadout.includes(sourceId)) return true;
  return isFeatureUseId(sourceId) && owned(sheet).some((f) => f.featureId === sourceId);
}

/**
 * Caster side on the party's sheets (Eye of the Storm on an ally, HF p.23: "until you take Severe damage"). A sheet
 * effect does not name who made it, so the caster is the one party member holding its card or feature; when two hold it
 * the effect is left for the GM to end by hand (Q3 in the task). Returns the sheets that changed.
 */
export function endForCasterOnSheets<K>(
  caster: CharacterSheet,
  party: readonly { key: K; sheet: CharacterSheet }[],
  occ: EndOccurrence,
  lookup?: SourceLookup,
): { key: K; sheet: CharacterSheet; ended: Effect[]; lines: string[] }[] {
  const mine = (e: Effect) => {
    const source = effectSource(e);
    return source !== null && holdsSource(caster, source.sourceId) && party.filter((p) => holdsSource(p.sheet, source.sourceId)).length <= 1;
  };
  const out: { key: K; sheet: CharacterSheet; ended: Effect[]; lines: string[] }[] = [];
  for (const p of party) {
    const ended = endOnSheet(p.sheet, occ, { role: "caster", only: mine, ...(lookup ? { lookup } : {}) });
    if (ended.ended.length > 0) out.push({ key: p.key, sheet: ended.sheet, ended: ended.ended, lines: ended.lines });
  }
  return out;
}

/**
 * `targetDefeated` (Marked for Death, HF p.8: "the current adversary Marked for Death is defeated"): a PC's effects whose
 * step names a tag the defeated instance carries end. The sheet does not record which creature an effect is about; the
 * tag on the instance is the link.
 */
export function endOnDefeat(sheet: CharacterSheet, defeated: Pick<Doc<"encounterAdversaries">, "tags">, lookup?: SourceLookup): ReturnType<typeof endOnSheet> {
  const tags = new Set(defeated.tags ?? []);
  return endOnSheet(sheet, { kind: "event", event: "targetDefeated" }, { only: (e) => tags.has(effectSource(e)?.label ?? ""), ...(lookup ? { lookup } : {}) });
}

/**
 * `gmSpendsFear` (Slumber, CB p.332: "or the GM spends a Fear"; Marked for Death: "the GM spends a number of Fear equal
 * to your tier to clear it"): the sheet without that one effect when its entry lets a Fear spend end it, or null. The
 * caller spends the Fear (how many is Q2 in the task) and logs both in one undo group.
 */
export function endByGmFear(sheet: CharacterSheet, effectId: string, lookup?: SourceLookup): CharacterSheet | null {
  const out = endOnSheet(sheet, { kind: "event", event: "gmSpendsFear" }, { only: (e) => e.id === effectId, ...(lookup ? { lookup } : {}) });
  return out.ended.length > 0 ? out.sheet : null;
}

/** The same on an instance's modifier or condition marker: its patch, or null when a Fear spend does not end it. */
export function endInstanceByGmFear(instance: InstanceState, effectId: string, lookup?: SourceLookup): ReturnType<typeof endInstanceEffects>["patch"] {
  return endInstanceEffects(instance, { kind: "event", event: "gmSpendsFear" }, { only: (e) => e.id === effectId, ...(lookup ? { lookup } : {}) }).patch;
}

/** Conditions a PC's effects forbid (Unstoppable, CB p.36: "You can't be Restrained or Vulnerable"; dcm-v17). */
export function refusedConditions(sheet: Pick<CharacterSheet, "effects">, lookup?: SourceLookup): ReadonlySet<Condition> {
  const out = new Set<Condition>();
  for (const e of sheet.effects) {
    const source = effectSource(e);
    const flags = source === null ? [] : (stepEnds(source.sourceId, source.label, lookup)?.flags ?? []);
    if (flags.includes("cannotBeRestrained")) out.add("restrained");
    if (flags.includes("cannotBeVulnerable")) out.add("vulnerable");
  }
  return out;
}

/** The Guardian's Unstoppable feature (src/lib/srd/feature-effects/guardian-warrior.ts). */
const UNSTOPPABLE = "class:guardian:unstoppable";

/** dcm-v17: the sheet without the Unstoppable effect once D5 has removed the die (call after any D5 Unstoppable action). */
export function afterUnstoppable(sheet: CharacterSheet): CharacterSheet {
  return withoutLapsedUnstoppable(sheet, (e) => featureIdOfEffect(e) === UNSTOPPABLE);
}

// ---------------------------------------------------------------- plan lanes-2, tracer E6 (docs/tasks/TASK-LN2-E6.md)
//
// The endings the SRD data already writes: a plan's `endEffect` and `stacking: "replace"` steps on PC sheets
// (`planEndsOnSheet`; instances: `instanceWrites`) and on the caster's map areas (`endPlanAreas`), the end of a card's or
// feature's tokens (`tokensGone`: `endOnTokensGone`, `endTokensGone`), a spell cast (`castsSpell`: `endOnSpellCast`),
// a granted benefit (`benefitGranted`), shared grants (`endSharedGrants`), areas ended by their caster's events
// (`endCasterAreas`), and the Fear a GM spend costs (`gmFearForEffect`, `gmFearForInstanceEffect`).

type PartySheet<K> = { key: K; sheet: CharacterSheet };
type SheetEnd<K> = { key: K; sheet: CharacterSheet; ended: Effect[]; lines: string[] };

/** Whether a sheet effect came from `of` (a card or feature id, a D5 alias), narrowed to the step of `option` when set. */
function sheetMadeBy(effect: Effect, of: string, option: string | undefined, lookup: SourceLookup): boolean {
  const source = effectSource(effect);
  if (source === null || source.sourceId !== of) return false;
  return option === undefined || (effectOption(effect) ?? stepEnds(of, source.label, lookup)?.option) === option;
}

/** A sheet without these effects, and without a condition whose last source marker was among them (C2's markers). */
function withoutEffects(sheet: CharacterSheet, gone: ReadonlySet<string>): CharacterSheet {
  if (gone.size === 0) return sheet;
  return lapsedConditions(sheet, { ...sheet, effects: sheet.effects.filter((e) => !gone.has(e.id)) }).sheet;
}

/**
 * dcm-9z2z / dcm-8x8 / dcm-5fc / dcm-kkx: a PC's sheet after the plan's `endEffect` steps on them (the effects and
 * condition markers the named card or feature made, narrowed to `option`; Confusing Aura, CB p.329: "this spell ends";
 * Howling Rampage, HF p.40: "drop out of Wolf Form") and its `effect` steps with `stacking: "replace"` (only the newest
 * copy of that label from `cardId` stays). Call it on the sheet `writeSheetChanges` returned (the new copy is the last
 * one). The same sheet when nothing ends.
 */
export function planEndsOnSheet(sheet: CharacterSheet, steps: readonly PlanStep[], who: string, cardId: string, lookup: SourceLookup = srdUses): { sheet: CharacterSheet; ended: Effect[]; lines: string[] } {
  const ends = steps.filter((s): s is Extract<PlanStep, { kind: "endEffect" }> => s.kind === "endEffect" && s.targetId === who);
  const replaced = new Set(steps.flatMap((s) => (s.kind === "effect" && s.targetId === who && s.stacking === "replace" ? [s.label] : [])));
  if (ends.length === 0 && replaced.size === 0) return { sheet, ended: [], lines: [] };
  const newest = new Map<string, string>();
  for (const e of sheet.effects) {
    const source = effectSource(e);
    if (source !== null && source.sourceId === cardId && replaced.has(source.label)) newest.set(source.label, e.id);
  }
  const ended = sheet.effects.filter((e) => {
    if (ends.some((x) => sheetMadeBy(e, x.of, x.option, lookup))) return true;
    const source = effectSource(e);
    return source !== null && source.sourceId === cardId && replaced.has(source.label) && newest.get(source.label) !== e.id;
  });
  if (ended.length === 0) return { sheet, ended, lines: [] };
  return { sheet: withoutEffects(sheet, new Set(ended.map((e) => e.id))), ended, lines: ended.map((e) => endedLine(sheet.name, e.text.split("; ")[0] ?? e.source, e.source)) };
}

/**
 * dcm-9z2z (areas): the caster's live areas an `endEffect` step on the caster ends (the area of the named card or feature;
 * Circle of Power, Wild Fortress's dome). Returns the ended areas' labels for the feed.
 */
export async function endPlanAreas(ctx: MutationCtx, input: { mapId: Id<"combatMaps">; characterId: Id<"characters">; actorId: string; steps: readonly PlanStep[] }): Promise<string[]> {
  const ends = input.steps.filter((s): s is Extract<PlanStep, { kind: "endEffect" }> => s.kind === "endEffect" && s.targetId === input.actorId);
  if (ends.length === 0) return [];
  const out: string[] = [];
  for (const area of await activeAreasOnMap(ctx, input.mapId)) {
    if (area.characterId !== input.characterId || !ends.some((x) => x.of === area.featureId)) continue;
    await endArea(ctx, area);
    out.push(area.label);
  }
  return out;
}

/** The card or feature id of a `cardTokens` key (`feat:<featureId>` for a feature, the card id for a card). */
export function tokenKeySource(key: string): string {
  return key.startsWith(FEATURE_KEY_PREFIX) ? key.slice(FEATURE_KEY_PREFIX.length) : key;
}

/** The party member's effects from `sourceIds` the caster made (their own; on another PC only when no other member holds the source, Q3). */
function castersEffect<K>(caster: CharacterSheet, member: CharacterSheet, party: readonly PartySheet<K>[], sourceIds: ReadonlySet<string>): (e: Effect) => boolean {
  return (e) => {
    const source = effectSource(e);
    if (source === null || !sourceIds.has(source.sourceId)) return false;
    if (member === caster) return true;
    return holdsSource(caster, source.sourceId) && party.filter((p) => holdsSource(p.sheet, source.sourceId)).length <= 1;
  };
}

/**
 * dcm-erhv: `tokensGone` on sheets. The effects of these cards or features that end when their tokens are gone (Flight's
 * Flying on the caster, CB p.328; Invisibility's Invisible on the ally the caster picked, CB p.334), on the caster and on
 * the party (an ally's only when the caster is the one member holding the card, as `endForCasterOnSheets`). `party` may
 * hold the caster (by the same sheet object, or not at all). Returns the sheets that changed.
 */
export function endOnTokensGone<K>(caster: PartySheet<K>, party: readonly PartySheet<K>[], sourceIds: readonly string[], lookup?: SourceLookup): SheetEnd<K>[] {
  if (sourceIds.length === 0) return [];
  const ids = new Set(sourceIds);
  const members = [caster, ...party.filter((p) => p.key !== caster.key)];
  const out: SheetEnd<K>[] = [];
  for (const p of members) {
    const only = castersEffect(caster.sheet, p.sheet, members, ids);
    const ended = endOnSheet(p.sheet, { kind: "event", event: "tokensGone" }, { only, ...(lookup ? { lookup } : {}) });
    if (ended.ended.length > 0) out.push({ key: p.key, sheet: withoutEffects(p.sheet, new Set(ended.ended.map((e) => e.id))), ended: ended.ended, lines: ended.lines });
  }
  return out;
}

/** Writes changed sheets after a use: each is saved, then logged in the use's group (`before`: the sheet as it was). */
async function saveEnded(ctx: MutationCtx, campaignId: Id<"campaigns">, groupId: string, actorId: Id<"users">, rows: readonly { characterId: Id<"characters">; before: CharacterSheet; after: CharacterSheet; lines: string[] }[]): Promise<void> {
  for (const r of rows) {
    await saveSheet(ctx, r.characterId, r.after);
    await logAction(ctx, { campaignId, characterId: r.characterId, actorId, kind: "combat", visibility: "public", summary: r.lines.join("; ").slice(0, 1000), groupId, before: r.before, undoable: true });
  }
}

/** The live areas a character drew in a campaign (any map). */
async function areasOfCharacter(ctx: MutationCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">): Promise<Doc<"combatAreas">[]> {
  const rows = await ctx.db
    .query("combatAreas")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CAMPAIGN_AREAS);
  return rows.filter((a) => a.status === "active" && a.characterId === characterId);
}

/** The most area rows read for one campaign (live ones plus ended ones the cron has not swept yet). */
const MAX_CAMPAIGN_AREAS = 400;

/**
 * dcm-erhv / dcm-u2wx (2): after a use's sheet is saved, the tokens it left at 0 end what ends with them: the caster's
 * and the party's `tokensGone` effects (`endOnTokensGone`) and the caster's live areas whose spec ends on `tokensGone`
 * (Circle of Power, HF p.16: "This spell lasts until the last token is removed"). Every changed sheet is saved and logged
 * in `groupId` (undo puts it back with the use). `before` / `after`: the caster's sheet before the use and as saved.
 */
export async function endTokensGone(
  ctx: MutationCtx,
  input: { campaignId: Id<"campaigns">; characterId: Id<"characters">; before: CharacterSheet; after: CharacterSheet; groupId: string; actorId: Id<"users">; lookup?: SourceLookup },
): Promise<{ lines: string[] }> {
  const sources = tokensGoneKeys(input.before, input.after).map(tokenKeySource);
  if (sources.length === 0) return { lines: [] };
  const party = (await partyMembers(ctx, input.campaignId)).filter((m) => m.character._id !== input.characterId).map((m) => ({ key: m.character._id, sheet: m.sheet }));
  const changed = endOnTokensGone({ key: input.characterId, sheet: input.after }, party, sources, input.lookup);
  const lines: string[] = [];
  const rows = changed.map((c) => {
    lines.push(...c.lines);
    const before = c.key === input.characterId ? input.after : party.find((p) => p.key === c.key)!.sheet;
    return { characterId: c.key, before, after: c.sheet, lines: c.lines };
  });
  await saveEnded(ctx, input.campaignId, input.groupId, input.actorId, rows);
  for (const area of await areasOfCharacter(ctx, input.campaignId, input.characterId)) {
    if (!sources.includes(area.featureId)) continue;
    const spec = areaSpecOf(area.featureId, area.useId, area.label);
    if (!(spec?.endsOn ?? []).includes("tokensGone")) continue;
    await endArea(ctx, area);
    lines.push(`${area.label} ends (its last token is gone)`);
  }
  return { lines };
}

/**
 * dcm-rx1k / dcm-o44e: the caster's live areas whose spec ends on the caster's event (`AreaSpec.endsOnCaster`; Hush, CB
 * p.336: "or you take Major damage"; Veil of Night, CB p.336: "until you cast another spell"). `except`: leave the
 * areas of this card or feature (the spell just cast). Returns the ended areas' labels.
 */
export async function endCasterAreas(ctx: MutationCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">, occ: EndOccurrence, except?: string): Promise<string[]> {
  const out: string[] = [];
  for (const area of await areasOfCharacter(ctx, campaignId, characterId)) {
    if (area.featureId === except) continue;
    const spec = areaSpecOf(area.featureId, area.useId, area.label);
    if (spec?.endsOnCaster === undefined || !endsOnOccurrence({ duration: spec.duration, endsOnCaster: spec.endsOnCaster }, occ, "caster")) continue;
    await endArea(ctx, area);
    out.push(area.label);
  }
  return out;
}

/** Whether a card is a spell (CB p.101: a domain card's type), whose cast ends `castsSpell` effects. */
export function isSpell(cardId: string): boolean {
  return getDomainCard(cardId)?.type === "spell";
}

/**
 * dcm-o44e (`castsSpell`): the caster cast a spell (`castCardId`). Ends the caster's own effects that end when they cast
 * another spell (`endsOn`; Through Your Eyes, CB p.335: "until you cast another spell") and the effects the caster made on
 * party members that end on the caster's cast (`endsOnCaster`), but none of the spell just cast. Not a spell: nothing.
 */
export function endOnSpellCast<K>(caster: PartySheet<K>, party: readonly PartySheet<K>[], castCardId: string, lookup?: SourceLookup): SheetEnd<K>[] {
  if (!isSpell(castCardId) && lookup === undefined) return [];
  const occ: EndOccurrence = { kind: "event", event: "castsSpell" };
  const other = (e: Effect) => effectSource(e)?.sourceId !== castCardId;
  const members = [caster, ...party.filter((p) => p.key !== caster.key)];
  const out: SheetEnd<K>[] = [];
  for (const p of members) {
    const own = p.key === caster.key ? endOnSheet(p.sheet, occ, { only: other, ...(lookup ? { lookup } : {}) }) : null;
    const base = own?.sheet ?? p.sheet;
    const made = (e: Effect) => {
      const source = effectSource(e);
      return other(e) && source !== null && holdsSource(caster.sheet, source.sourceId) && members.filter((m) => holdsSource(m.sheet, source.sourceId)).length <= 1;
    };
    const theirs = endOnSheet(base, occ, { role: "caster", only: made, ...(lookup ? { lookup } : {}) });
    const ended = [...(own?.ended ?? []), ...theirs.ended];
    if (ended.length > 0) out.push({ key: p.key, sheet: withoutEffects(p.sheet, new Set(ended.map((e) => e.id))), ended, lines: [...(own?.lines ?? []), ...theirs.lines] });
  }
  return out;
}

/**
 * dcm-o44e on the server: after a spell card's use, end what the cast ends on the party's sheets (`endOnSpellCast`), on
 * the instances the caster's token marked (`endsOnCaster` / `castsSpell`), and the caster's areas (`endCasterAreas`).
 * Sheets are saved and logged in `groupId`; the instances' `before` go on the caller's GM row (or a GM row here when
 * `logInstances`). `sheet`: the caster's sheet as saved by the use.
 */
export async function endSpellCast(
  ctx: MutationCtx,
  input: { campaignId: Id<"campaigns">; characterId: Id<"characters">; sheet: CharacterSheet; castCardId: string; casterTokenId?: string; groupId: string; actorId: Id<"users">; lookup?: SourceLookup },
): Promise<{ lines: string[] }> {
  if (!isSpell(input.castCardId) && input.lookup === undefined) return { lines: [] };
  const party = (await partyMembers(ctx, input.campaignId)).filter((m) => m.character._id !== input.characterId).map((m) => ({ key: m.character._id, sheet: m.sheet }));
  const changed = endOnSpellCast({ key: input.characterId, sheet: input.sheet }, party, input.castCardId, input.lookup);
  const lines: string[] = [];
  await saveEnded(
    ctx,
    input.campaignId,
    input.groupId,
    input.actorId,
    changed.map((c) => {
      lines.push(...c.lines);
      return { characterId: c.key, before: c.key === input.characterId ? input.sheet : party.find((p) => p.key === c.key)!.sheet, after: c.sheet, lines: c.lines };
    }),
  );
  const occ: EndOccurrence = { kind: "event", event: "castsSpell" };
  if (input.casterTokenId !== undefined) {
    const inst = await endForCasterOnInstances(ctx, input.campaignId, input.casterTokenId, occ, input.lookup, input.castCardId);
    if (inst.before.length > 0) {
      await logAction(ctx, { campaignId: input.campaignId, actorId: input.actorId, kind: "combat", visibility: "gm", summary: inst.lines.join("; ").slice(0, 1000), groupId: input.groupId, adversaryBefore: inst.before, undoable: true });
    }
  }
  for (const label of await endCasterAreas(ctx, input.campaignId, input.characterId, occ, input.castCardId)) lines.push(`${label} ends (another spell was cast)`);
  return { lines };
}

/**
 * dcm-rao5 (`sharedGrant`): the copies of a shared grant on the other party sheets end with the one that ended
 * (Bird's-Eye View, CB p.33: "The first time a character makes a roll to act on this information, they gain advantage";
 * every recipient of the use carries a copy, and the first roll by any of them spends it). `ended`: what ended on one
 * sheet (`endOnSheet(...).ended`). Returns the other sheets that changed.
 */
export function endSharedGrants<K>(ended: readonly Effect[], party: readonly PartySheet<K>[], lookup?: SourceLookup): SheetEnd<K>[] {
  const shared = new Set<string>();
  for (const e of ended) {
    const source = effectSource(e);
    if (source !== null && stepEnds(source.sourceId, source.label, lookup)?.ends.sharedGrant === true) shared.add(`${source.sourceId}\u0000${source.label}`);
  }
  if (shared.size === 0) return [];
  const gone = new Set(ended.map((e) => e.id));
  const out: SheetEnd<K>[] = [];
  for (const p of party) {
    const copies = p.sheet.effects.filter((e) => {
      const source = effectSource(e);
      return !gone.has(e.id) && source !== null && shared.has(`${source.sourceId}\u0000${source.label}`);
    });
    if (copies.length === 0) continue;
    out.push({ key: p.key, sheet: withoutEffects(p.sheet, new Set(copies.map((e) => e.id))), ended: copies, lines: copies.map((e) => endedLine(p.sheet.name, e.text.split("; ")[0] ?? e.source, e.source)) });
  }
  return out;
}

/**
 * dcm-5yew (`benefitGranted`): the effect that granted its benefit once ends when its entry says so (a Forest Sprite's
 * help, CB p.339: "A sprite vanishes after granting a benefit"). The caller names the effect whose benefit a roll used.
 */
export function endGrantedBenefit(sheet: CharacterSheet, effectId: string, lookup?: SourceLookup): ReturnType<typeof endOnSheet> {
  return endOnSheet(sheet, { kind: "event", event: "benefitGranted" }, { only: (e) => e.id === effectId, ...(lookup ? { lookup } : {}) });
}

/**
 * dcm-8bv / dcm-kmr: the Fear the GM spends to end a PC's effect (`endFear`; Marked for Death, HF p.8: "a number of Fear
 * equal to your tier", the sheet's tier), or null when a Fear spend does not end it.
 */
export function gmFearForEffect(sheet: Pick<CharacterSheet, "effects" | "level">, effectId: string, lookup?: SourceLookup): number | null {
  const effect = sheet.effects.find((e) => e.id === effectId);
  return effect === undefined ? null : gmFearToEnd(effectEndsOf(effect, lookup), tierForLevel(sheet.level));
}

/** The same for an instance modifier or condition marker (Slumber, CB p.332: "the GM spends a Fear"); `tier`: the caster's. */
export function gmFearForInstanceEffect(effect: Pick<InstanceEffect, "id" | "label">, tier: 1 | 2 | 3 | 4, lookup?: SourceLookup): number | null {
  const source = instanceEffectSource(effect);
  return source === null ? null : gmFearToEnd(stepEnds(source.sourceId, source.label, lookup)?.ends, tier);
}

/**
 * dcm-9z2z / dcm-erhv / dcm-u2wx (2): what a resolved use ends, after its writes (call it once the use is saved; the
 * feature path does, `convex/combatFeatures.ts`; the card paths are the follow-up in the task doc). The plan's
 * `endEffect` and `stacking: "replace"` steps on the actor's and the touched PCs' sheets (`planEndsOnSheet`), the caster's
 * areas an `endEffect` names (`endPlanAreas`), and what the use's spent tokens end (`endTokensGone`). Every changed sheet
 * is saved and logged in `groupId` with its `before`, so undo puts it back with the use. `before`: the actor's sheet
 * before the use. Returns the feed lines.
 */
export async function applyUseEnds(
  ctx: MutationCtx,
  input: { campaignId: Id<"campaigns">; character: Doc<"characters">; before: CharacterSheet; built: BuiltRun; plan: RunPlan; groupId: string; actorId: Id<"users">; lookup?: SourceLookup },
): Promise<{ lines: string[] }> {
  const { plan, built } = input;
  const lookup = input.lookup ?? srdUses;
  const actorTokenId = built.context.actor.id;
  const pcs = new Map<string, Id<"characters">>([[actorTokenId, input.character._id]]);
  for (const c of built.creatures.all) if (c.kind === "pc") pcs.set(c.tokenId, c.character._id);
  const lines: string[] = [];
  const rows: { characterId: Id<"characters">; before: CharacterSheet; after: CharacterSheet; lines: string[] }[] = [];
  let actorNow: CharacterSheet | null = null;
  for (const [tokenId, characterId] of pcs) {
    const row = await ctx.db.get("characters", characterId);
    if (row === null || row.campaignId !== input.campaignId) continue;
    const sheet = readSheet(row.sheet);
    const out = planEndsOnSheet(sheet, plan.steps, tokenId, plan.cardId, lookup);
    if (characterId === input.character._id) actorNow = out.sheet;
    if (out.ended.length === 0) continue;
    rows.push({ characterId, before: sheet, after: out.sheet, lines: out.lines });
    lines.push(...out.lines);
  }
  await saveEnded(ctx, input.campaignId, input.groupId, input.actorId, rows);
  if (built.creatures.onMap) {
    for (const label of await endPlanAreas(ctx, { mapId: built.creatures.scene.map._id, characterId: input.character._id, actorId: actorTokenId, steps: plan.steps })) lines.push(`${label} ends`);
  }
  if (actorNow !== null) {
    const gone = await endTokensGone(ctx, { campaignId: input.campaignId, characterId: input.character._id, before: input.before, after: actorNow, groupId: input.groupId, actorId: input.actorId, lookup });
    lines.push(...gone.lines);
  }
  return { lines };
}

// ---------------------------------------------------------------- plan lanes-2 wave 9, tracer E6.3 (docs/tasks/TASK-LN3-E6.md)
//
// dcm-46q4 / dcm-iedr (E6 half): a condition an adversary gives a PC that ends on the adversary's damage (`endsOnCaster`:
// Envelop, "until the Shark takes Severe damage"; Hold Them Down / Encumber / Smothering Grapple: "Major damage or more")
// or on the bearer's roll (`endsOnRoll`: Slowed, Rattled, HF p.69: "until they roll with Hope"). The PC's sheet stores
// the condition as a bare name (or, for a tag, an effect of the adversary's feature), so the plan's `conditionDetails`
// (AdversaryPlan, E7) are stored as a marker effect beside it: id `ac:<n>`; its text says it in words and ends with
// `; condition: <name>; ends: <json>` (schema version, the caster instance, the feature, `endsOnCaster`, `endsOnRoll`,
// `endFear`). No stored shape changes: markers are ordinary `effects` entries (rule 7 needs no widening).
//
// - `withAdversaryConditionMarkers`: the sheet with the markers of the details aimed at this PC (the adversary path calls
//   it after `writeSheetChanges`; caller follow-up in the task doc);
// - `endAdversaryConditions`: the sheet after an occurrence: the caster side (`role: "caster"`, the caster instance's
//   damage) or the bearer side (the PC's own roll); the condition goes with its marker unless another marker holds it;
// - `endAdversaryConditionsForCaster`: the caster side over the whole party, saved and logged in the caller's undo group;
// - `endAdversaryConditionsOnRoll`: the bearer side for a made roll (pure; the roll path saves it).

const AC_PREFIX = "ac:";
const AC_TAIL = /; condition: ([^;]+); ends: (\{.*\})$/;

/** A condition detail the adversary plan lists (`AdversaryPlan.conditionDetails`, src/lib/domain/adversary-effects/run.ts). */
export type AdversaryConditionDetailLike = {
  targetId: string;
  condition: ConditionRef;
  endsOnCaster?: readonly EndEvent[];
  endsOnRoll?: RollEnd;
  endFear?: NumberSource;
};

/** What a marker records: the caster instance, the feature (`<adversaryId>/<feature>`, the tag effect's card id) and the ends. */
export type AdversaryMarker = { id: string; casterId: string; cardId: string; condition: string; tag: boolean; ends: EffectEnds; source: string };

type MarkerJson = { v: 1; by: string; src: string; tag?: 1; c?: readonly EndEvent[]; r?: RollEnd; f?: NumberSource };

/** The marker of an adversary-given condition on a sheet, or null for any other effect. */
export function adversaryMarkerOf(effect: Pick<Effect, "id" | "text" | "source">): AdversaryMarker | null {
  if (!effect.id.startsWith(AC_PREFIX)) return null;
  const m = AC_TAIL.exec(effect.text);
  if (!m) return null;
  let j: MarkerJson;
  try {
    j = JSON.parse(m[2]!) as MarkerJson;
  } catch {
    return null;
  }
  if (j.v !== 1 || typeof j.by !== "string" || typeof j.src !== "string") return null;
  const ends: EffectEnds = {
    duration: "manual",
    ...(j.c ? { endsOnCaster: j.c } : {}),
    ...(j.r ? { endsOnRoll: j.r } : {}),
    // Its entry names a Fear cost: the GM's spend ends it too (`fearEndsOnSheet`).
    ...(j.f ? { endFear: j.f, endsOn: ["gmSpendsFear" as const] } : {}),
  };
  return { id: effect.id, casterId: j.by, cardId: j.src, condition: m[1]!, tag: j.tag === 1, ends, source: effect.source };
}

/** The words of an end event on the caster ("takes Severe damage"). */
function casterEventWords(e: EndEvent): string {
  if (e === "takeSevere") return "takes Severe damage";
  if (e === "majorDamage") return "takes Major damage or more";
  if (e === "markHp") return "marks a Hit Point";
  return e;
}

/** The marker effect of one detail, or null when the detail has no end the server runs (`endsOnCaster`, `endsOnRoll`). */
export function adversaryConditionMarker(
  existing: readonly Pick<Effect, "id">[],
  input: { casterId: string; casterName: string; cardId: string; featureName: string; detail: AdversaryConditionDetailLike },
): Effect | null {
  const { detail } = input;
  const casterEnds = detail.endsOnCaster ?? [];
  if (casterEnds.length === 0 && detail.endsOnRoll === undefined) return null;
  const tag = detail.condition.kind !== "standard";
  const name = conditionName(detail.condition);
  const json: MarkerJson = {
    v: 1,
    by: input.casterId,
    src: input.cardId,
    ...(tag ? { tag: 1 as const } : {}),
    ...(casterEnds.length > 0 ? { c: casterEnds } : {}),
    ...(detail.endsOnRoll ? { r: detail.endsOnRoll } : {}),
    ...(detail.endFear ? { f: detail.endFear } : {}),
  };
  const roll = detail.endsOnRoll;
  const words = [
    ...casterEnds.map((e) => `${input.casterName} ${casterEventWords(e)}`),
    ...(roll ? [`${roll.by === "caster" ? input.casterName : "they"} roll${roll.result === "withHope" ? " with Hope" : roll.result && roll.result !== "any" ? ` (${roll.result})` : ""}`] : []),
  ];
  const tail = `; condition: ${name}; ends: ${JSON.stringify(json)}`;
  const head = `${name.charAt(0).toUpperCase()}${name.slice(1)} until ${words.join(" or ")}`;
  let n = 1;
  while (n < 99 && existing.some((e) => e.id === `${AC_PREFIX}${n}`)) n++;
  return { id: `${AC_PREFIX}${n}`, source: input.featureName.slice(0, 80), text: `${head.slice(0, Math.max(0, 300 - tail.length))}${tail}`, until: "manual" };
}

/**
 * The sheet with a marker for each detail aimed at `pcId` (replacing an older marker of the same caster and condition).
 * Call after the condition itself is written (`writeSheetChanges`). The sheet holds at most 20 effects: the oldest goes.
 */
export function withAdversaryConditionMarkers(
  sheet: CharacterSheet,
  pcId: string,
  input: { casterId: string; casterName: string; adversaryId: string; feature: string; details: readonly AdversaryConditionDetailLike[] },
): CharacterSheet {
  const cardId = `${input.adversaryId}/${input.feature}`;
  let effects = sheet.effects;
  for (const detail of input.details) {
    if (detail.targetId !== pcId) continue;
    const name = conditionName(detail.condition);
    const kept = effects.filter((e) => {
      const m = adversaryMarkerOf(e);
      return m === null || m.casterId !== input.casterId || m.condition !== name;
    });
    const marker = adversaryConditionMarker(kept, { casterId: input.casterId, casterName: input.casterName, cardId, featureName: input.feature, detail });
    if (marker !== null) effects = [...kept, marker].slice(-20);
  }
  return effects === sheet.effects ? sheet : { ...sheet, effects };
}

/** The tag effect `writeSheetChanges` wrote for an adversary's tag condition (`<effectKeyOf(cardId)>:<n>`, label first). */
function isTagEffect(e: Effect, cardId: string, tag: string): boolean {
  return e.id.startsWith(`${effectKeyOf(cardId)}:`) && (e.text.split("; ")[0] ?? "") === tag;
}

/**
 * The sheet after `occ`. `role: "caster"` with `casterId`: the markers that caster instance made whose `endsOnCaster`
 * holds (its damage). `role: "bearer"`: the markers whose `endsOnRoll` (or `gmSpendsFear`) holds. Each ended marker takes
 * its condition with it (a standard condition unless another marker still holds it; a tag: its effect).
 */
export function endAdversaryConditions(
  sheet: CharacterSheet,
  occ: EndOccurrence,
  opts: { role: EndRole; casterId?: string; only?: (marker: AdversaryMarker) => boolean },
): { sheet: CharacterSheet; ended: AdversaryMarker[]; lines: string[] } {
  const ended: AdversaryMarker[] = [];
  for (const e of sheet.effects) {
    const m = adversaryMarkerOf(e);
    if (m === null || (opts.only && !opts.only(m))) continue;
    if (opts.role === "caster" && m.casterId !== opts.casterId) continue;
    if (endsOnOccurrence(m.ends, occ, opts.role)) ended.push(m);
  }
  if (ended.length === 0) return { sheet, ended, lines: [] };
  const gone = new Set(ended.map((m) => m.id));
  let effects = sheet.effects.filter((e) => !gone.has(e.id));
  let conditions = sheet.conditions;
  for (const m of ended) {
    if (m.tag) {
      effects = effects.filter((e) => !isTagEffect(e, m.cardId, m.condition));
      continue;
    }
    if (!effects.some((e) => adversaryMarkerOf(e)?.condition === m.condition)) conditions = conditions.filter((c) => c !== m.condition);
  }
  const after = lapsedConditions(sheet, { ...sheet, effects, conditions }).sheet;
  return { sheet: after, ended, lines: ended.map((m) => endedLine(sheet.name, `${m.condition.charAt(0).toUpperCase()}${m.condition.slice(1)}`, m.source)) };
}

/**
 * The caster side over the party: the adversary instance `casterId` took damage (`occ`, a `damageTaken`) and every PC
 * condition it gave that ends on that ends. Each changed sheet is saved and logged in `groupId` with its `before`, so undo
 * puts it back with the hit. Callers: where a PC's attack or card damages an instance (follow-up in the task doc).
 */
export async function endAdversaryConditionsForCaster(
  ctx: MutationCtx,
  input: { campaignId: Id<"campaigns">; casterId: string; occ: EndOccurrence; groupId: string; actorId: Id<"users"> },
): Promise<{ lines: string[] }> {
  const rows: { characterId: Id<"characters">; before: CharacterSheet; after: CharacterSheet; lines: string[] }[] = [];
  for (const { character, sheet } of await partyMembers(ctx, input.campaignId)) {
    if (!sheet.effects.some((e) => adversaryMarkerOf(e)?.casterId === input.casterId)) continue;
    const out = endAdversaryConditions(sheet, input.occ, { role: "caster", casterId: input.casterId });
    if (out.ended.length > 0) rows.push({ characterId: character._id, before: sheet, after: out.sheet, lines: out.lines });
  }
  await saveEnded(ctx, input.campaignId, input.groupId, input.actorId, rows);
  return { lines: rows.flatMap((r) => r.lines) };
}

/** The bearer side for a PC's own made roll (Slowed, Rattled: "until they roll with Hope"); pure, the roll path saves it. */
export function endAdversaryConditionsOnRoll(
  sheet: CharacterSheet,
  record: Pick<RollRecord, "kind" | "outcome">,
  attack?: "weapon" | "spell" | "other",
): { sheet: CharacterSheet; ended: AdversaryMarker[]; lines: string[] } {
  const roll = endRollOf(record, attack);
  if (roll === null) return { sheet, ended: [], lines: [] };
  return endAdversaryConditions(sheet, { kind: "roll", roll }, { role: "bearer" });
}

// ---------------------------------------------------------------- the GM's Fear spend (dcm-kmr, dcm-6y00 (1))

/** A Fear-endable effect or condition marker on a PC sheet or an instance, with its cost (the GM's list and button). */
export type FearEnd = { effectId: string; label: string; source: string; fear: number };

/** The sheet effects a GM Fear spend ends, with their cost (the sheet's tier for `byTier`; adversary markers with `endFear`). */
export function fearEndsOnSheet(sheet: CharacterSheet, lookup?: SourceLookup): FearEnd[] {
  const out: FearEnd[] = [];
  for (const e of sheet.effects) {
    const marker = adversaryMarkerOf(e);
    const fear = marker !== null ? gmFearToEnd(marker.ends, tierForLevel(sheet.level)) : gmFearForEffect(sheet, e.id, lookup);
    if (fear === null) continue;
    out.push({ effectId: e.id, label: marker?.condition ?? e.text.split("; ")[0] ?? e.source, source: e.source, fear });
  }
  return out;
}

/** The instance modifiers and condition markers a GM Fear spend ends; `tierOf`: the caster's tier by token (default the caller's). */
export function fearEndsOnInstance(instance: InstanceState, tierOf: (casterTokenId: string | undefined) => 1 | 2 | 3 | 4, lookup?: SourceLookup): FearEnd[] {
  const out: FearEnd[] = [];
  for (const e of instance.effects ?? []) {
    const fear = gmFearForInstanceEffect(e, tierOf(instanceEffectSource(e)?.caster), lookup);
    if (fear !== null) out.push({ effectId: e.id, label: e.label, source: e.source, fear });
  }
  return out;
}

/** `endByGmFear` with the adversary-given markers too (their `endFear`) and the feed lines; null when a Fear spend does not end it. */
export function endSheetEffectByGmFear(sheet: CharacterSheet, effectId: string, lookup?: SourceLookup): { sheet: CharacterSheet; lines: string[] } | null {
  const effect = sheet.effects.find((e) => e.id === effectId);
  if (effect === undefined) return null;
  if (adversaryMarkerOf(effect) !== null) {
    const out = endAdversaryConditions(sheet, { kind: "event", event: "gmSpendsFear" }, { role: "bearer", only: (m) => m.id === effectId });
    return out.ended.length > 0 ? { sheet: out.sheet, lines: out.lines } : null;
  }
  const out = endOnSheet(sheet, { kind: "event", event: "gmSpendsFear" }, { only: (e) => e.id === effectId, ...(lookup ? { lookup } : {}) });
  if (out.ended.length === 0) return null;
  return { sheet: withoutEffects(sheet, new Set([effectId])), lines: out.lines };
}

/** The instance after a GM Fear spend on one modifier or condition marker, with the feed lines; null when it does not end. */
export function endInstanceEffectByGmFear(instance: InstanceState & { label: string }, effectId: string, lookup?: SourceLookup): { patch: NonNullable<ReturnType<typeof endInstanceEffects>["patch"]>; lines: string[] } | null {
  const out = endInstanceEffects(instance, { kind: "event", event: "gmSpendsFear" }, { only: (e) => e.id === effectId, ...(lookup ? { lookup } : {}) });
  return out.patch === null ? null : { patch: out.patch, lines: out.ended.map((e) => endedLine(instance.label, e.label, e.source)) };
}
