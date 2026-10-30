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
import type { CardUse, ConditionRef, Duration, Step } from "../../src/lib/domain/card-effects/types";
import { endEffects, endsOnOccurrence, withoutLapsedUnstoppable, type EffectEnds, type EndOccurrence, type EndRole } from "../../src/lib/domain/characters/expiry";
import type { RollRecord } from "../../src/lib/domain/duality";
import { SEVERITY_LABEL } from "../../src/lib/domain/encounters/damage";
import { owned } from "../../src/lib/domain/feature-effects/owned";
import { TRAIT_LABEL } from "../../src/lib/frames/extras/common";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { TraitId } from "../../src/lib/srd/types";
import type { CharacterSheet, Condition, Effect } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { cardIdOfEffect, difficultyOf, featureIdOfEffect, isFeatureUseId, tokenIdsOf, type BuiltRun, type Creatures, type EnemyCreature } from "./cardRunner";
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
      v.object({ kind: v.literal("choose"), stepId: v.string(), label: v.string(), options: v.array(v.object({ id: v.string(), label: v.string() })) }),
      v.object({ kind: v.literal("split"), label: v.string(), tokenIds: v.array(v.id("combatTokens")) }),
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

/** Each enemy's `effects` after the plan's `effect` steps (an exclusive card's older ones removed first), by token id. */
function effectsAfter(plan: RunPlan, creatures: Creatures, cardName: string, lookup: SourceLookup): Map<string, InstanceEffect[]> {
  const out = new Map<string, InstanceEffect[]>();
  const caster = creatures.onMap ? (creatures.scene.attacker._id as string) : undefined;
  for (const step of plan.steps) {
    if (step.kind !== "effect" && step.kind !== "condition") continue;
    const c = creatures.get(step.targetId);
    if (!c || c.kind !== "enemy") continue;
    // Lane E6: a condition that ends on an event leaves a marker modifier (its name as the label) so the end can find it.
    const marker = step.kind === "condition" ? conditionMarker(plan.cardId, cardName, step, caster, lookup) : null;
    if (step.kind === "condition" && marker === null) continue;
    let list = out.get(step.targetId);
    if (list === undefined) {
      const own = c.instance.effects ?? [];
      list = plan.exclusive ? own.filter((e) => !ownsInstanceEffect(e.id, plan.cardId)) : [...own];
    }
    const next = step.kind === "effect" ? instanceEffect(list, plan.cardId, cardName, step, caster, lookup) : marker!(list);
    out.set(step.targetId, [...list, next].slice(-INSTANCE_EFFECTS_MAX));
  }
  return out;
}

/**
 * The instance rows a plan changes. A Minion group is one instance whose HP are its Minions: a hit Minion marks one HP,
 * `defeat` without an amount takes the whole group, with an amount that many (CB p.201). A card's `effect` on an enemy
 * lands in the instance's `effects` (CA4b).
 */
export function instanceWrites(plan: RunPlan, creatures: Creatures, cardName: string, lookup: SourceLookup = srdUses): InstanceWrite[] {
  const effects = effectsAfter(plan, creatures, cardName, lookup);
  const writes: InstanceWrite[] = [];
  const withEffects = (c: EnemyCreature, patch: Omit<InstancePatch, "effects">): InstanceWrite => {
    const next = effects.get(c.tokenId);
    return { creature: c, before: adversaryBefore(c.instance, next !== undefined), patch: next !== undefined ? { ...patch, effects: next } : patch };
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

/** The uses of a card or feature entry by id (tests pass fixture entries). */
export type SourceLookup = (sourceId: string) => readonly CardUse[] | undefined;

/** The SRD entries: a card's or a feature's uses. */
export const srdUses: SourceLookup = (sourceId) => cardEffect(sourceId)?.uses ?? featureEffect(sourceId)?.uses;

/** An entry's lasting step (an `effect`, or a `condition` by its name) with its ends and its flags. */
export type EndStep = { kind: "effect" | "condition"; label: string; ends: EffectEnds; flags: readonly string[] };

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
  };
  return step.kind === "effect" ? { kind: "effect", label: step.label, ends, flags } : { kind: "condition", label: conditionName(step.condition), ends, flags };
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
      const out = endInstanceEffects(instance, occ, { role: "caster", casterTokenId, ...(lookup ? { lookup } : {}) });
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
