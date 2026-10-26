/**
 * Features used on the Combat Map (plan sheet-drawer, tracer SD3; docs/tasks/TASK-SD-SD3.md): the steps behind
 * `combatFeatures.useFeature` and the GM's feature sanction. A Hope, class, subclass, ancestry, community, Beastform,
 * transformation or stance feature runs through the card path (convex/lib/cardRunner.ts: `buildRun`, `runCard`,
 * `actorSheetAfter`, `writeSheetChanges`; convex/lib/cardRows.ts: instance writes and row words), with a `UsePick` whose
 * runner is SD1's `runFeature` (upgrades, D5 delegation, `feat:` limits, repeat activation).
 *
 * Rules and answers (printed pages; quotes in the task doc):
 * - Ownership (CB p.110-111, p.71; Q10, Q11, Q5): `owned()` decides; FEATURE_NOT_OWNED otherwise.
 * - Passive uses and out-of-combat / narrative features have no Use (FEATURE_NOT_COMBAT, SD0 classification, Q15).
 * - Limits (CB p.101; Q3, Q4, Q7) are `featureUses` keys `feat:<featureId>[:<useId>][:<target>]`; a per-target key past
 *   the 80-character cap names the target by a short hash (`:~<hash>`).
 * - CB p.107 Spending Resources: a non-roll feature may be activated `times` times (choice `{id: "times"}`); a feature
 *   with a roll or a limit refuses it (INVALID).
 * - Q13: a situation the engine can't read needs the player's confirmation (choice `situations`).
 * - NV2: D5 features keep their record: the delegated D5 feature's `classState`, held dice and other sheets (Rally Dice,
 *   Life Support) are written in the same mutation as the map steps.
 * - U1 / U4: rows as cards (public: roll, own damage, Hit / Miss / Defeated; GM: the full resolution with
 *   `adversaryBefore`); one actionLog group, which `actionLog.undo` reverts.
 */
import { v, type Infer } from "convex/values";

import { pickUse, type ActorState, type RunContext, type RunPlan, type RunRefusal } from "../../src/lib/domain/card-effects/run";
import type { TargetSpec } from "../../src/lib/domain/card-effects/types";
import { delegatedKeys } from "../../src/lib/domain/feature-effects/delegate";
import { owned, activeBeastformId, holdingsFor, type OwnedFeature } from "../../src/lib/domain/feature-effects/owned";
import { actorExtras, asCardEffect, runFeature } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { applyUpgrades } from "../../src/lib/domain/feature-effects/upgrades";
import type { OtherSheet } from "../../src/lib/domain/class-features/types";
import { countsAsActionRoll } from "../../src/lib/domain/countdowns/advanced";
import { appError } from "../../src/lib/errors/app-error";
import { resolveOptions } from "../../src/lib/frames/options";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { tickArmedCountdowns } from "../countdownRolls";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction, newGroupId } from "./actionLog";
import { dropDice, type CardChoice, type CardRoll, type DiceSlot } from "./cardChoices";
import { cardPromptValidator, damageRolls, gmLines, instanceWrites, openCardHits, promptsOf, publicTargets, rollText, writeInstances } from "./cardRows";
import { actorSheetAfter, effectOption, featureIdOfEffect, writeSheetChanges, type BuiltRun, type Delegated, type UsePick } from "./cardRunner";
import { partyOf, saveSheet } from "./characterSheet";
import type { AttackScene } from "./combatActions";
import { campaignFearState, gainFear, spendFear } from "./fear";
import { changed } from "./rolls";
import { rollValidator } from "./validators/actionLog";

// ---------------------------------------------------------------- what a caller returns

/** `useFeature` (and the GM's approval) resolved: the player's own dice, hit / miss / defeated, the D5 feed lines (U1). */
export const resolvedFeatureValidator = v.object({
  status: v.literal("resolved"),
  entryId: v.id("actionLog"),
  featureId: v.string(),
  useId: v.string(),
  roll: v.union(v.null(), rollValidator),
  damage: v.array(rollValidator),
  success: v.boolean(),
  targets: v.array(v.object({ tokenId: v.id("combatTokens"), hit: v.boolean(), defeated: v.boolean() })),
  fearDelta: v.number(),
  prompts: v.array(cardPromptValidator),
  /** What the use did besides its roll: the delegated D5 features' lines, Favor / Focus, Help dice, areas. */
  notes: v.array(v.string()),
});
export type ResolvedFeature = Infer<typeof resolvedFeatureValidator>;

// ---------------------------------------------------------------- ownership and the pick

/** The features the sheet holds in this campaign (the Hope & Fear option decides H&F content). */
export function ownedHere(sheet: CharacterSheet, campaign: Pick<Doc<"campaigns">, "frameId" | "options">): OwnedFeature[] {
  return owned(sheet, { hopeAndFear: resolveOptions(campaign.frameId, campaign.options).hopeAndFear });
}

/** The runner's refusals as the drawer's codes (SD0's FEATURE_* codes). */
export function featureRefusal(r: RunRefusal) {
  switch (r.reason) {
    case "exhausted":
      return appError("FEATURE_EXHAUSTED", r.detail);
    case "cost":
      return appError("FEATURE_COST_UNPAID", `Short of: ${r.detail}.`);
    case "targets":
      return appError("COMBAT_TARGET_INVALID", r.detail);
    case "requirement":
      return appError("INVALID", `The feature's condition isn't met (${r.detail}).`);
    case "noUse":
    case "choice":
      return appError("INVALID", r.detail);
  }
}

/** The most times one call activates a non-roll feature (CB p.107; Frontline Tank twice is 6 Hope). */
export const MAX_TIMES = 10;

/** The SD3-only choice ids, taken out before the card path parses the rest (`parseChoices`). */
export function splitFeatureChoices(list: readonly CardChoice[]): { rest: CardChoice[]; times: number; dieIndexes?: number[] } {
  let times = 1;
  let dieIndexes: number[] | undefined;
  const rest: CardChoice[] = [];
  for (const c of list) {
    if (c.id === "times") {
      if (typeof c.value !== "number" || !Number.isInteger(c.value) || c.value < 1 || c.value > MAX_TIMES) throw appError("INVALID", `Times is 1 to ${MAX_TIMES}.`);
      times = c.value;
    } else if (c.id === "dieIndexes") {
      const list = Array.isArray(c.value) ? c.value : [];
      const n = list.map(Number);
      if (!Array.isArray(c.value) || n.some((x) => !Number.isInteger(x) || x < 0 || x > 20)) throw appError("INVALID", "dieIndexes needs die positions.");
      dieIndexes = n;
    } else rest.push(c);
  }
  return { rest, times, ...(dieIndexes ? { dieIndexes } : {}) };
}

/** Whether a use needs the live map: its targets are enemies, any creature, a point or an object (FEATURE_NEEDS_MAP). */
export function needsMap(effect: FeatureEffect, useId: string | undefined): boolean {
  const use = pickUse(asCardEffect(effect), useId);
  const spec = use?.targets && use.targets.side !== "trigger" ? (use.targets as TargetSpec) : undefined;
  return spec !== undefined && (spec.side === "enemy" || spec.side === "any" || spec.side === "point" || spec.side === "object");
}

/** FNV-1a (32 bit) in base 36, for a per-target key past the cap. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The most characters of a `featureUses` key (featureUseSchema). */
export const USE_KEY_MAX = 80;

/**
 * A per-target limit key that fits the sheet's 80 characters (SD1 open point 4): `feat:<featureId>[:<useId>]:<target>`
 * with a target id that makes it longer names the target as `~<hash>`.
 */
export function storedLimitKey(key: string, targetIds: readonly string[]): string {
  if (key.length <= USE_KEY_MAX) return key;
  const target = targetIds.find((id) => key.endsWith(`:${id}`));
  return target === undefined ? key : `${key.slice(0, key.length - target.length)}~${hashOf(target)}`;
}

/** The stored (short) per-target keys read back as the runner writes them, for the targets of this use. */
export function expandedLimitKey(key: string, targetIds: readonly string[]): string {
  const m = /^(.*:)~([a-z0-9]+)$/.exec(key);
  if (!m) return key;
  const target = targetIds.find((id) => hashOf(id) === m[2]);
  return target === undefined ? key : `${m[1]}${target}`;
}

/** The facts NV7 requirements read from the sheet (Q16 Flying, Q10 Beastform, Q5 stance, feature effects, conditions). */
export function factsOf(sheet: CharacterSheet, rollUsedExperience: boolean): NonNullable<ActorState["facts"]> {
  return {
    conditions: sheet.conditions,
    tags: sheet.effects.map((e) => e.text.split("; ")[0] ?? ""),
    flying: sheet.effects.some((e) => e.id === FLYING_EFFECT_ID),
    featureEffects: sheet.effects.flatMap((e) => {
      const featureId = featureIdOfEffect(e);
      const option = effectOption(e);
      return featureId === null ? [] : [{ featureId, ...(option !== undefined ? { option } : {}) }];
    }),
    beastformId: activeBeastformId(sheet),
    activeStance: sheet.classState.martial?.active ?? null,
    rollUsedExperience,
  };
}

/** The sheet effect the Flying toggle writes (Q16): "a sheet effect until turned off". */
export const FLYING_EFFECT_ID = "flying";

/** One other party member a delegated D5 feature may read, keyed by its map token when it has one (the runner's id). */
export type PartyMember = { key: string; character: Doc<"characters">; sheet: CharacterSheet };

/**
 * The campaign's other active characters, for a use that delegates to a D5 feature (Rally reaches the party, Life
 * Support the picked ally). Keyed by their PC token on the map (the runner's creature ids), else their character id.
 */
export async function partyFor(ctx: QueryCtx, campaignId: Id<"campaigns">, self: Id<"characters">, scene: AttackScene | null, readSheetOf: (c: Doc<"characters">) => CharacterSheet): Promise<PartyMember[]> {
  const tokens = new Map<string, string>();
  for (const t of scene?.scene.tokens ?? []) if (t.ref.kind === "pc") tokens.set(t.ref.characterId, t._id);
  const out: PartyMember[] = [];
  for (const c of await partyOf(ctx, campaignId)) {
    if (c._id === self || c.status !== "active") continue;
    out.push({ key: tokens.get(c._id) ?? c._id, character: c, sheet: readSheetOf(c) });
  }
  return out;
}

export type FeaturePick = UsePick & { featureId: string; feature: OwnedFeature; party: PartyMember[]; times: number };

/**
 * The feature and use asked for, ready for the card path. FEATURE_NOT_OWNED for a feature the sheet doesn't hold;
 * FEATURE_NOT_COMBAT for an out-of-combat or narrative feature, one without an effect entry yet, or a passive use.
 */
export function pickFeature(input: {
  sheet: CharacterSheet;
  campaign: Pick<Doc<"campaigns">, "frameId" | "options">;
  featureId: string;
  useId: string | undefined;
  times: number;
  dieIndexes?: number[];
  rollUsedExperience: boolean;
  party: PartyMember[];
}): FeaturePick {
  const { sheet, featureId } = input;
  const held = ownedHere(sheet, input.campaign);
  const feature = held.find((f) => f.featureId === featureId);
  if (feature === undefined) throw appError("FEATURE_NOT_OWNED");
  if (feature.usage === "outOfCombat" || feature.usage === "narrative") throw appError("FEATURE_NOT_COMBAT");
  const entry = featureEffect(featureId);
  if (entry === undefined) throw appError("FEATURE_NOT_COMBAT", `${feature.name} isn't automated on the map yet.`);
  const holdings = holdingsFor(sheet, held, entry.owner);
  const upgraded = applyUpgrades(entry, holdings);
  const use = pickUse(asCardEffect(upgraded), input.useId);
  if (use === undefined) throw appError("INVALID", `${feature.name} has no "${input.useId ?? ""}".`);
  if (use.activation.kind === "passive") throw appError("FEATURE_NOT_COMBAT", `${use.name} is always on.`);
  const delegates = delegatedKeys(use).length > 0;
  const others: OtherSheet[] = delegates ? input.party.map((m) => ({ characterId: m.key, sheet: m.sheet })) : [];
  const facts = factsOf(sheet, input.rollUsedExperience);

  const runner = (context: RunContext) => {
    const { useId: _useId, limitKeys: _limitKeys, delegate: _delegate, ...rest } = context;
    void _useId;
    void _limitKeys;
    void _delegate;
    const targetIds = (context.targets ?? []).map((t) => t.id);
    const actor = { ...rest.actor, featureUses: rest.actor.featureUses.map((u) => ({ ...u, key: expandedLimitKey(u.key, targetIds) })) };
    const result = runFeature(entry, use.id, {
      ...rest,
      actor,
      sheet,
      others,
      holdings,
      times: input.times,
      ...(input.dieIndexes ? { dieIndexes: input.dieIndexes } : {}),
    });
    if (!result.ok) return result;
    const short = (key: string) => storedLimitKey(key, targetIds);
    const plan: RunPlan = {
      ...result.plan,
      actor: { ...result.plan.actor, featureUses: result.plan.actor.featureUses.map((u) => ({ ...u, key: short(u.key) })) },
      limit: result.plan.limit ? { ...result.plan.limit, key: short(result.plan.limit.key) } : null,
    };
    const delegated: Delegated = { ...(result.sheet ? { sheet: result.sheet } : {}), others: result.others, rolls: result.rolls };
    return { ok: true as const, plan, delegated };
  };

  return {
    effect: asCardEffect(upgraded),
    use,
    name: feature.name,
    limitKey: `feat:${featureId}`,
    featureId,
    feature,
    party: input.party,
    times: input.times,
    run: runner,
    refusal: featureRefusal,
    actor: (base) => ({ ...base, ...actorExtras(sheet), facts }),
  };
}

// ---------------------------------------------------------------- resolving

export type FeatureUseRequest = {
  campaign: Doc<"campaigns">;
  character: Doc<"characters">;
  sheet: CharacterSheet;
  scene: AttackScene | null;
  pick: FeaturePick;
  targetTokenIds: readonly string[];
  choices: readonly CardChoice[];
  roll: CardRoll;
};

/** Where a feature use's dice wait for its choice (convex/lib/cardChoices.ts kept dice). */
export const featureSlot = (req: FeatureUseRequest): DiceSlot => ({ campaignId: req.campaign._id, characterId: req.character._id, cardId: req.pick.featureId, useId: req.pick.use.id });

/** Applies the GM's Fear change of a use; returns what changed. */
async function applyFear(ctx: MutationCtx, campaignId: Id<"campaigns">, delta: number): Promise<number> {
  if (delta > 0) return (await gainFear(ctx, campaignId, delta)).gained;
  if (delta < 0) {
    const state = await campaignFearState(ctx, campaignId);
    const lost = Math.min(state.fear, -delta);
    if (lost > 0) await spendFear(ctx, campaignId, lost, "feature");
    return -lost;
  }
  return 0;
}

/**
 * The D5 feed line with the die the held dice really got (SD1 follow-up: Rally through `runFeature` takes Epic Poetry's
 * d10, CB p.29, while D5's own line names d6 / d8).
 */
export function delegateLine(summary: string, before: CharacterSheet, after: CharacterSheet | undefined): string {
  if (after === undefined) return summary;
  const old = new Set(before.heldDice.map((d) => d.id));
  const fresh = after.heldDice.find((d) => !old.has(d.id));
  return fresh ? summary.replace(/\(d\d+\)/, `(d${fresh.sides})`) : summary;
}

/** The words of a feature's own plan steps the card rows don't say: D5 lines, Favor / Focus, Help dice, areas. */
function notesOf(plan: RunPlan, built: BuiltRun, before: CharacterSheet, delegated: Delegated | undefined): string[] {
  const name = (id: string) => {
    if (id === built.context.actor.id) return "you";
    const c = built.creatures.get(id);
    return c?.kind === "pc" ? c.sheet.name : c?.kind === "enemy" ? c.instance.label : "an ally";
  };
  const out: string[] = [];
  for (const s of plan.steps) {
    if (s.kind === "delegate" && s.summary) out.push(delegateLine(s.summary, before, delegated?.sheet));
    else if (s.kind === "resource") out.push(`${s.resource === "favor" ? "Favor" : "Focus"} ${s.before} → ${s.after}`);
    else if (s.kind === "help") out.push(`${name(s.targetId)}: a d${s.die} Help die${s.free ? " (no Hope)" : ""}`);
    else if (s.kind === "area") out.push(`an area (${s.area.radius}) to place on the map`);
  }
  return out;
}

/**
 * Writes the plan in one mutation (U4) and logs one actionLog group: the public row (the roll, the damage dice and total,
 * Hit / Miss / Defeated per target, the D5 lines, the actor's `before`), a row per other character whose sheet changed
 * (an ally the use touched, a D5 feature's other sheets), a public row per manual step, and the GM row (damage, severity,
 * HP, saves, `adversaryBefore`).
 */
export async function resolveFeatureUse(ctx: MutationCtx, req: FeatureUseRequest, built: BuiltRun, outcome: { plan: RunPlan; delegated?: Delegated }, actorId: Id<"users">): Promise<ResolvedFeature> {
  const { campaign, character, sheet, pick } = req;
  const { plan, delegated } = outcome;
  const actorToken = built.context.actor.id;
  // The D5 features' sheet (classState, held dice, effects) when they ran; resources come from the plan either way.
  const start = delegated?.sheet ?? built.paidSheet;
  const next = actorSheetAfter(start, plan, actorToken, pick.name);
  let prompts = promptsOf(plan, built);
  const notes = notesOf(plan, built, sheet, delegated);

  // Other characters: a D5 feature's other sheets (by the runner's key), then the plan's ally steps and tracks.
  const others = new Map<string, { character: Doc<"characters">; before: CharacterSheet; after: CharacterSheet }>();
  for (const o of delegated?.others ?? []) {
    const m = pick.party.find((p) => p.key === o.characterId);
    if (m) others.set(m.character._id, { character: m.character, before: m.sheet, after: o.sheet });
  }
  for (const c of built.creatures.all) {
    if (c.kind !== "pc" || c.character._id === character._id) continue;
    const prior = others.get(c.character._id);
    const base = prior?.after ?? c.sheet;
    const changedTo = plan.creatures.find((x) => x.id === c.tokenId)?.after;
    let after = writeSheetChanges(base, plan.steps, c.tokenId, plan.cardId, pick.name, plan.exclusive, false);
    if (changedTo) after = { ...after, hp: Math.min(c.sheet.hpMax, changedTo.hp), stress: Math.min(c.sheet.stressMax, changedTo.stress), armorMarked: Math.max(0, changedTo.armor ?? base.armorMarked) };
    others.set(c.character._id, { character: c.character, before: prior?.before ?? c.sheet, after });
  }

  const writes = instanceWrites(plan, built.creatures, pick.name);
  await writeInstances(ctx, writes);
  const fearDelta = await applyFear(ctx, campaign._id, plan.gmFearDelta);
  const sheetChanged = changed(sheet, next);
  if (sheetChanged) await saveSheet(ctx, character._id, next);
  const allyRows = [...others.values()].filter((o) => changed(o.before, o.after));
  for (const a of allyRows) await saveSheet(ctx, a.character._id, a.after);

  const groupId = newGroupId();
  const damage = damageRolls(plan);
  const { parts, outcomes } = publicTargets(plan, built, writes);
  const useName = pick.use.name !== pick.name ? ` (${pick.use.name})` : "";
  const times = pick.times;
  const rollPart = plan.roll ? `: ${rollText(pick.use, plan.roll.record, req.roll.trait)}` : "";
  const damagePart = damage.length > 0 ? `; ${plan.roll?.critical ? "critical " : ""}damage ${damage.map((d) => d.text).join(" + ")}` : "";
  const targetPart = parts.length > 0 ? ` → ${parts.join(", ")}` : "";
  const notePart = notes.length > 0 ? ` (${notes.join("; ")})` : "";
  const d5Roll = delegated?.rolls[0];
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId,
    kind: "combat",
    visibility: "public",
    summary: `${sheet.name} uses ${pick.name}${useName}${times > 1 ? ` ×${times}` : ""}${rollPart}${damagePart}${targetPart}${notePart}`.slice(0, 1000),
    ...(plan.roll ? { roll: plan.roll.record } : d5Roll ? { roll: d5Roll } : {}),
    groupId,
    ...(sheetChanged ? { before: sheet } : {}),
    ...(fearDelta !== 0 ? { fearDelta } : {}),
    undoable: true,
  });
  for (const a of allyRows) {
    await logAction(ctx, { campaignId: campaign._id, characterId: a.character._id, actorId, kind: "combat", visibility: "public", summary: `${a.before.name}: ${pick.name} from ${sheet.name}`, groupId, before: a.before, undoable: true });
  }
  for (const p of prompts.filter((x) => x.kind === "manual")) {
    await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId, kind: "feature", visibility: "public", summary: `${sheet.name} used ${pick.name}: ${p.text}`, groupId, undoable: true });
  }
  const lines = gmLines(plan, built, writes);
  if (lines.length > 0 || writes.length > 0) {
    await logAction(ctx, {
      campaignId: campaign._id,
      actorId,
      kind: "combat",
      visibility: "gm",
      summary: `${sheet.name} · ${pick.name} → ${lines.join("; ")}`,
      ...(damage[0] ? { roll: damage[0].roll } : {}),
      groupId,
      ...(writes.length > 0 ? { adversaryBefore: writes.map((w) => w.before) } : {}),
      undoable: true,
    });
  }
  if (plan.roll && countsAsActionRoll(plan.roll.record, { logKind: "roll", undone: false })) {
    await tickArmedCountdowns(ctx, { campaignId: campaign._id, entryId, outcome: plan.roll.record.outcome, actorId });
  }
  if (built.creatures.onMap) {
    const hitTokens = await openCardHits(ctx, { plan, built, campaignId: campaign._id, groupId, actorId, attacker: { characterId: character._id, label: sheet.name, cardId: plan.cardId, feature: pick.name } });
    prompts = prompts.filter((p) => !(p.kind === "pcDamage" && p.tokenIds.every((t) => hitTokens.has(t))));
  }
  await dropDice(ctx, featureSlot(req));
  return {
    status: "resolved",
    entryId,
    featureId: pick.featureId,
    useId: plan.useId,
    roll: plan.roll?.record ?? d5Roll ?? null,
    damage: damage.map((d) => d.roll),
    success: plan.success,
    targets: outcomes,
    fearDelta,
    prompts,
    notes,
  };
}
