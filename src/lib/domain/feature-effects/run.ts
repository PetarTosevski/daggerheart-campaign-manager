// The feature runner (plan sheet-drawer, SD1). Pure: runs one use of a Hope, class, subclass, ancestry, community,
// Beastform, transformation or stance feature through the card runner (card-effects/run.ts), so the server's card path
// (SD3: buildRun / runCard / rows) executes features and cards alike.
//
// - Limits are stored in the sheet's `featureUses` under `feat:<featureId>` (`feat:<featureId>:<useId>` for a use other
//   than `main`, `:<targetId>` appended for a per-target limit), with `until` = the limit's period: rest, longRest,
//   session or scene (Q3; Q7: "once per scene" is a scene limit, CB p.107).
// - NV3: the upgrades that hold (`holdings`, owned.ts) are applied before the use runs.
// - NV2: with the actor's `sheet`, the use's `delegate` steps run their D5 features inside the plan (delegate.ts); a D5
//   once-per key already used reads as exhausted.
// - CB p.107, "Spending Resources": "Unless an effect states otherwise, you can't spend Hope or mark Stress multiple times
//   on the same feature to increase or repeat its effects on the same roll. … However, on an effect like the Guardian's
//   Hope Feature, which says 'Spend 3 Hope to clear 2 Armor Slots,' you can spend 6 Hope to clear 4 Armor Slots, because
//   this effect isn't applying its bonus to a specific roll—you're just activating the feature more than once." So
//   `times` repeats the costs and the steps of a use without a roll (and without a limit); a use with a roll refuses it.
//
// ```ts
// const held = owned(sheet, scope);
// const result = runFeature(FEATURE_EFFECTS.get("hope:guardian")!, undefined, { actor, gmFear, rng, times: 2, sheet, holdings: holdingsFor(sheet, held, "guardian") });
// if (result.ok) result.plan.limit;   // null; result.plan.actor.after.armor = before - 4
// ```

import {
  featureLimitUntil,
  keyAvailability,
  resolveCosts,
  unaffordable,
  type Availability,
} from "../card-effects/availability";
import { pickUse, run, type ActorState, type HeldDieState, type RunContext, type RunPlan, type RunRefusal } from "../card-effects/run";
import type { CardEffect, CardUse, Cost, HeldDieKind, NumberSource } from "../card-effects/types";
import { resolveNumber, type NumberEnv } from "../combat-actions/numbers";
import { derivedDefense, derivedThresholds } from "../characters/derived";
import { withEffects } from "../characters/effects";
import type { FeatureScope } from "../class-features/types";
import type { RollRecord } from "../duality";
import { rallyDieSides } from "../class-features/classes/bard";
import { unstoppableMax } from "../class-features/classes/guardian";
import { favorOf, patronDie } from "../class-features/classes/warlock";
import type { Registry } from "../class-features/index";
import type { OtherSheet } from "../class-features/types";
import type { CharacterSheet, FeatureUse } from "../../validation/characters";
import { createDelegator, delegatedExhaustion, heldDiceState } from "./delegate";
import { featureKey } from "./ids";
import type { FeatureEffect } from "./types";
import { applyUpgrades, upgradedDieSides, type Holdings } from "./upgrades";

/** The `featureUses` key of a feature's limit: `feat:<featureId>[:<useId>][:<targetId>]` (no `:main`). */
export function featureLimitKey(featureIdValue: string, useId?: string, targetId?: string): string {
  const base = featureKey(featureIdValue, useId === undefined || useId === "main" ? undefined : useId);
  return targetId ? `${base}:${targetId}` : base;
}

/** The runner's limit keys for one feature. */
export function featureLimitKeys(featureIdValue: string): NonNullable<RunContext["limitKeys"]> {
  return { key: (useId, targetId) => featureLimitKey(featureIdValue, useId, targetId), until: featureLimitUntil };
}

/** A feature entry as the card runner reads it. */
export function asCardEffect(effect: FeatureEffect): CardEffect {
  return { cardId: effect.featureId, uses: effect.uses };
}

export interface FeatureRunContext extends Omit<RunContext, "useId" | "limitKeys" | "delegate"> {
  /** The actor's sheet: needed to run `delegate` steps and to read D5's once-per keys. */
  sheet?: CharacterSheet;
  /** Other characters a delegated D5 feature reads (an ally, the party). */
  others?: readonly OtherSheet[];
  /** NV3: what the upgrades read (owned.ts `holdingsFor`); absent: no upgrade applies. */
  holdings?: Holdings;
  /** CB p.107: activate a non-roll feature this many times (default 1). */
  times?: number;
  /** The roll a delegated D5 feature acts on (Volatile Magic, Patron's Boon). */
  delegateRoll?: RollRecord;
  registry?: Registry;
}

export type FeatureRunResult =
  | {
      ok: true;
      plan: RunPlan;
      /** With `sheet`: the actor's sheet after the delegated D5 features (resources are the plan's). */
      sheet?: CharacterSheet;
      /** Other sheets the delegated D5 features changed. */
      others: OtherSheet[];
      /** Rolls the delegated D5 features made. */
      rolls: RollRecord[];
    }
  | RunRefusal;

const refuse = (reason: RunRefusal["reason"], detail: string): RunRefusal => ({ ok: false, reason, detail });

/** A use repeated `times` times: its costs and steps, in order (CB p.107). */
function repeated(use: CardUse, times: number): CardUse {
  if (times === 1) return use;
  const costs: Cost[] = [];
  const steps: CardUse["steps"][number][] = [];
  for (let i = 0; i < times; i++) {
    costs.push(...(use.costs ?? []));
    steps.push(...use.steps);
  }
  return { ...use, costs, steps };
}

/**
 * Runs one use of a feature. Refuses as `run` does, plus: `exhausted` when a delegated D5 feature's once-per key is
 * used, `choice` for a repeat (`times` > 1) of a use with a roll or a limit, or when a delegated D5 feature refuses.
 */
export function runFeature(effect: FeatureEffect, useId: string | undefined, context: FeatureRunContext): FeatureRunResult {
  const upgraded = context.holdings ? applyUpgrades(effect, context.holdings) : effect;
  const card = asCardEffect(upgraded);
  const use = pickUse(card, useId);
  if (!use) return refuse("noUse", `No use "${useId ?? ""}" on ${effect.featureId}.`);
  const { sheet, others, holdings, times = 1, delegateRoll, registry, ...rest } = context;

  if (sheet) {
    const d5 = delegatedExhaustion(sheet, use, registry);
    if (d5) return refuse("exhausted", d5.label);
  }
  if (!Number.isInteger(times) || times < 1) return refuse("choice", `Times: ${times}`);
  if (times > 1 && (use.roll || use.limit)) return refuse("choice", "This feature can't be repeated on the same roll (CB p.107).");

  const dieSides = holdings ? upgradedDieSides(effect, use.id, holdings) : undefined;
  const delegator = sheet
    ? createDelegator({ sheet, ...(others ? { others } : {}), rng: context.rng, ...(delegateRoll ? { roll: delegateRoll } : {}), ...(dieSides ? { dieSides } : {}), ...(registry ? { registry } : {}) })
    : undefined;
  const runnable: CardEffect = { ...card, uses: card.uses.map((u) => (u.id === use.id ? repeated(u, times) : u)) };
  const result = run(runnable, {
    ...rest,
    useId: use.id,
    limitKeys: featureLimitKeys(effect.featureId),
    ...(delegator ? { delegate: delegator.handler } : {}),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    plan: result.plan,
    ...(delegator ? { sheet: delegator.sheet() } : {}),
    others: delegator?.others() ?? [],
    rolls: delegator?.rolls() ?? [],
  };
}

/**
 * Whether a feature's use is ready or exhausted (Q3, Q7): its `feat:` limit, and the D5 once-per keys of the features it
 * delegates to (Rally, Unstoppable, Channel Raw Power, Commune). The drawer greys it with the reset label.
 */
export function featureAvailability(
  sheet: Pick<CharacterSheet, "classId" | "multiclass"> & { readonly featureUses: readonly FeatureUse[] },
  effect: FeatureEffect,
  useId?: string,
  options: { holdings?: Holdings; targetId?: string; registry?: Registry } = {},
): Availability {
  const upgraded = options.holdings ? applyUpgrades(effect, options.holdings) : effect;
  const use = pickUse(asCardEffect(upgraded), useId);
  if (!use) return { state: "ready" };
  const d5 = delegatedExhaustion(sheet, use, options.registry);
  if (d5) return { state: "exhausted", until: d5.until, label: d5.label };
  if (!use.limit) return { state: "ready" };
  return keyAvailability(sheet, featureLimitKey(effect.featureId, use.id, use.limit.perTarget ? options.targetId : undefined), use.limit);
}

/**
 * The resources a use's upfront costs are short of (empty = affordable), for the drawer's cost badge. Amounts that
 * depend on the move (Hope spent, targets) read as 0 here; `choices` are the player's numbers.
 */
export function featureCostShort(actor: ActorState, use: CardUse, choices: Readonly<Record<string, number>> = {}, flags?: readonly string[]): string[] {
  const env: NumberEnv = {
    traits: actor.traits,
    spellcast: actor.spellcast,
    proficiency: actor.proficiency,
    level: actor.level,
    tier: actor.tier,
    spent: {},
    choices,
    cardTokens: actor.cardTokens,
    gmFear: 0,
    self: { hp: actor.hp, stress: actor.stress, armor: actor.armor },
    markedThisMove: { self: {}, byTarget: {} },
    targetCount: { picked: 0, hit: 0, failedSave: 0 },
    loadoutDomains: actor.loadoutDomains,
    vaultDomains: actor.vaultDomains,
    ...(actor.dieSides ? { dieSides: actor.dieSides } : {}),
  };
  // Dice in a cost amount are not rolled for a badge: read them as their count.
  const noDice = () => 1;
  const costs = resolveCosts(use.costs ?? [], (c) => resolveNumber(c.amount, env, noDice));
  const held: Partial<Record<HeldDieKind, number>> = {};
  for (const d of actor.heldDice ?? []) held[d.kind] = (held[d.kind] ?? 0) + 1;
  return unaffordable(costs, {
    hope: actor.hope,
    stress: actor.stress,
    stressMax: actor.stressMax,
    hp: actor.hp,
    hpMax: actor.hpMax,
    armor: actor.armor,
    armorMax: actor.armorMax,
    cardTokens: actor.cardTokens,
    favor: actor.favor ?? 0,
    focus: actor.focus ?? 0,
    heldDice: held,
    // Plan lanes-2 E8.3 (dcm-hgvx): the payer's rules flags (Ravenous `cannotSpendHope`, HF p.94: "a PC can't spend Hope").
    ...(flags && flags.length > 0 ? { flags } : {}),
  });
}

/**
 * Plan lanes-2 E8.3 (dcm-hgvx, dcm-5kxg): the rules flags a list of lasting mods carries (`Mod` `flag`: `cannotSpendHope`,
 * `cannotClearHp`, `cannotClearStress`, ...), for `PayerState.flags` / `featureCostShort`.
 */
export function flagsOf(mods: readonly { kind: string; flag?: string }[]): string[] {
  return [...new Set(mods.flatMap((m) => (m.kind === "flag" && typeof m.flag === "string" ? [m.flag] : [])))];
}

/**
 * The SD1 fields of an `ActorState` read from the sheet (the server adds them to the card path's actor): Favor, Focus,
 * held dice, and the class dice sizes for `sidesOf` (Rally d6 / d8 from level 5, CB p.28; Prayer d4, CB p.44; Patron d6 /
 * d8, HF p.14; Slayer d6, CB p.48; the Combo die, HF p.10; the Unstoppable die, CB p.36).
 */
export function actorExtras(sheet: CharacterSheet): Pick<ActorState, "favor" | "focus" | "heldDice" | "dieSides"> {
  // Slayer Dice are a count of unrolled d6s (session-features); they spend as held dice of kind `slayer`.
  const slayer = sheet.sessionFeatures?.slayerDice ?? 0;
  const heldDice: HeldDieState[] = [...heldDiceState(sheet), ...Array.from({ length: slayer }, (_, i): HeldDieState => ({ id: `slayer-${i + 1}`, kind: "slayer", sides: 6 }))];
  // DA0 (SD4 follow-up): a warlock's unset Favor reads as 3, as D5's `favorOf` ("You start with 3 Favor.", HF p.14).
  const warlock = sheet.classId === "warlock" || sheet.multiclass?.classId === "warlock";
  const favor = sheet.classState.favor ?? (warlock ? favorOf(sheet) : undefined);
  return {
    ...(favor !== undefined ? { favor } : {}),
    ...(sheet.classState.martial ? { focus: sheet.classState.martial.focus } : {}),
    heldDice,
    dieSides: {
      rally: rallyDieSides(sheet.level),
      prayer: 4,
      patron: patronDie(sheet.level),
      slayer: 6,
      combo: sheet.classState.comboDie ?? 4,
      unstoppable: sheet.classState.unstoppable?.max ?? unstoppableMax(sheet.level),
    },
  };
}

// ---------------------------------------------------------------- plan lanes-2, E8: numbers the sheet holds

/** The derived stats a `stat` number source reads for the actor (`NumberSource stat`, `who: "self"`). */
export type SheetStat = Extract<NumberSource, { kind: "stat" }>["stat"];

/**
 * Plan lanes-2, E8 (dcm-me3, dcm-rm9, dcm-78x, dcm-v17, dcm-bxp.99.19.4): the numbers of the actor's own sheet that the
 * vocabulary's `tideTokens`, `classDie` and `stat` (`who: "self"`) sources read. The card runner's `NumberEnv` has the
 * fields (numbers.ts, E5) but `run()` doesn't copy them from the actor yet (dcm-rs1z, E3); `bindSheetNumbers` writes
 * them into the use as fixed numbers before it runs, so a feature reads them either way.
 * - Know the Tide (CB p.77): "spend any number of these tokens" -> `sessionFeatures.tideTokens`.
 * - Unstoppable (CB p.36): the die's current value -> `classState.unstoppable.value`; a held class die (Rally, Prayer,
 *   Patron, Combo) its rolled value, when it has one.
 * - Armored Shell (CB p.33: "reduce the incoming damage by your Armor Score"): Armor Score, Evasion and the thresholds
 *   after gear, effects and passives (characters/derived.ts; installed Ikonis augments are not read here).
 */
export interface SheetNumbers {
  tideTokens: number;
  classDice: Partial<Record<HeldDieKind | "unstoppable", number>>;
  stats: Record<SheetStat, number>;
}

export function sheetNumbers(sheet: CharacterSheet, scope?: FeatureScope): SheetNumbers {
  const classDice: SheetNumbers["classDice"] = {};
  const unstoppable = sheet.classState.unstoppable?.value;
  if (unstoppable !== undefined) classDice.unstoppable = unstoppable;
  for (const d of sheet.heldDice) if (d.value !== undefined && classDice[d.kind] === undefined) classDice[d.kind] = d.value;
  const defense = derivedDefense(withEffects(sheet), [], scope);
  const thresholds = derivedThresholds(sheet, scope);
  return {
    tideTokens: sheet.sessionFeatures?.tideTokens ?? 0,
    classDice,
    stats: { armorScore: defense.armorScore, evasion: defense.evasion, majorThreshold: thresholds.major, severeThreshold: thresholds.severe },
  };
}

/** The fixed number a sheet-held source reads, or undefined for any other value. */
function boundSource(value: Record<string, unknown>, numbers: SheetNumbers): NumberSource | undefined {
  const fixed = (n: number): NumberSource => ({ kind: "fixed", value: n });
  // A `Mod` of kind "stat" carries `delta` (never `who`); only the number source is bound.
  if ("delta" in value) return undefined;
  switch (value.kind) {
    case "tideTokens":
      return fixed(numbers.tideTokens);
    case "classDie":
      return typeof value.die === "string" ? fixed(numbers.classDice[value.die as HeldDieKind | "unstoppable"] ?? 0) : undefined;
    case "stat":
      return value.who === "self" && typeof value.stat === "string" && value.stat in numbers.stats ? fixed(numbers.stats[value.stat as SheetStat]) : undefined;
    default:
      return undefined;
  }
}

/**
 * `value` (a use, a step, any part of an entry) with every `tideTokens`, `classDie` and self `stat` number source
 * replaced by the sheet's number (`sheetNumbers`). Unchanged parts keep their identity, so a use without such a source
 * comes back as the same object.
 *
 * ```ts
 * bindSheetNumbers(knowTheTide, sheetNumbers(sheet));   // choice max {kind: "tideTokens"} -> {kind: "fixed", value: 3}
 * ```
 */
export function bindSheetNumbers<T>(value: T, numbers: SheetNumbers): T {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v: unknown) => {
      const b = bindSheetNumbers(v, numbers);
      if (b !== v) changed = true;
      return b;
    });
    return (changed ? out : value) as T;
  }
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const bound = boundSource(record, numbers);
  if (bound !== undefined) return bound as T;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    const b = bindSheetNumbers(v, numbers);
    if (b !== v) changed = true;
    out[k] = b;
  }
  return (changed ? out : value) as T;
}

// ---------------------------------------------------------------- plan lanes-2, E8: a pick made when the card is chosen

/**
 * dcm-40mj (Vitality, CB p.330: "When you choose this card, permanently gain two of the following benefits ... Then place
 * this card in your vault permanently"): the entry's use set off by its choosing (`auto` on `whenYouChooseThisCard`), or
 * undefined. The level-up / card acquisition flow runs it once, when the card is taken (`runOnChoose`).
 */
export function onChooseUse(effect: Pick<CardEffect, "uses">): CardUse | undefined {
  return effect.uses.find((u) => u.activation.kind === "auto" && u.activation.trigger.kind === "whenYouChooseThisCard");
}

/**
 * Runs the `whenYouChooseThisCard` use of a card or feature entry once (no limit: it happens when the card is chosen,
 * never again). The plan's steps are the permanent picks (`effect` steps with `hpMax` / `stressMax` / threshold mods,
 * `toVault`), which the caller writes to the sheet. Null when the entry has no such use; a refusal as `run` gives it
 * (an option not picked yet: `choice`).
 */
export function runOnChoose(effect: CardEffect, context: Omit<RunContext, "useId">): { ok: true; plan: RunPlan } | RunRefusal | null {
  const use = onChooseUse(effect);
  if (use === undefined) return null;
  const { limit: _limit, ...once } = use;
  void _limit;
  const result = run({ ...effect, uses: [{ ...once, activation: { kind: "action" } }] }, { ...context, useId: use.id });
  return result.ok ? { ok: true, plan: result.plan } : result;
}
