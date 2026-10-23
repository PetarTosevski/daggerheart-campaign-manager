// Upgrades (plan sheet-drawer, SD1; vocabulary NV3 in card-effects/types.ts). Pure.
//
// A later subclass card, a level or another feature changes an earlier feature's numbers: "Your Rally Die increases to a
// d10" (Epic Poetry, CB p.29), "uses d8s instead of d6s" (Backstab, HF p.8), "twice per long rest" (Virtuoso, CB p.28).
// An entry lists them in `FeatureEffect.upgrades`; `applyUpgrades` patches the uses with every upgrade that holds, in list
// order (a later patch of the same field wins: Rally d8 at level 5, then d10 with Epic Poetry), before the use runs.
//
// ```ts
// const holdings = holdingsFor(sheet, owned(sheet, scope));     // owned.ts
// const effect = applyUpgrades(FEATURE_EFFECTS.get("class:bard:rally")!, holdings);
// activeUpgrades(effect, holdings).map((u) => u.note);          // ["level 5", "Epic Poetry"] for the drawer's badge
// ```

import type { CardUse, ChooseOption, DieSides, Step, TargetSpec, Upgrade, UpgradePatch, UpgradeWhen } from "../card-effects/types";
import type { FeatureEffect, SubclassCard } from "./types";

/** What upgrades read: the rank of the subclass card the feature belongs to, the features the sheet holds, the level. */
export interface Holdings {
  /** The rank the sheet holds of the feature's own subclass (the primary subclass's `subclassRank`; a multiclass holds only its foundation). */
  rank: SubclassCard;
  featureIds: ReadonlySet<string>;
  level: number;
}

const RANK_ORDER: readonly SubclassCard[] = ["foundation", "specialization", "mastery"];

/** Whether an upgrade's `when` holds: the rank (or a higher one), the feature, or the level (or a higher one). */
export function upgradeHolds(when: UpgradeWhen, holdings: Holdings): boolean {
  switch (when.kind) {
    case "rank":
      return RANK_ORDER.indexOf(holdings.rank) >= RANK_ORDER.indexOf(when.rank);
    case "feature":
      return holdings.featureIds.has(when.featureId);
    case "level":
      return holdings.level >= when.atLeast;
  }
}

/** The upgrades of an entry that hold, in list order (the drawer's badges). */
export function activeUpgrades(effect: FeatureEffect, holdings: Holdings): Upgrade[] {
  return (effect.upgrades ?? []).filter((u) => upgradeHolds(u.when, holdings));
}

/** The die size of every dice expression in a value (DiceExpr `sides`, a `check`'s dice, a `tokens` step's `die`). */
function withDieSides<T>(value: T, sides: DieSides): T {
  if (Array.isArray(value)) return value.map((v: unknown) => withDieSides(v, sides)) as T;
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = withDieSides(v, sides);
  const isDice = "count" in out && typeof out.sides === "number";
  if (isDice) out.sides = sides;
  if (out.kind === "tokens" && typeof out.die === "number") out.die = sides;
  if (out.kind === "help" && typeof out.die === "number") out.die = sides;
  return out as T;
}

/** The dice count of the use's damage dice and of its `add` damage changes ("2d10" instead of "1d10", Fueled by Fear). */
function withDiceCount(steps: readonly Step[], count: NonNullable<UpgradePatch["diceCount"]>): Step[] {
  return steps.map((step): Step => {
    switch (step.kind) {
      case "damage":
        return step.roll.kind === "dice" ? { ...step, roll: { ...step.roll, dice: { ...step.roll.dice, count } } } : step;
      case "modifyDamage": {
        const ch = step.change;
        if (ch.kind === "add" && ch.amount.kind === "dice") return { ...step, change: { ...ch, amount: { ...ch.amount, dice: { ...ch.amount.dice, count } } } };
        return step;
      }
      case "optional":
        return { ...step, steps: withDiceCount(step.steps, count) };
      case "choose":
        return { ...step, options: step.options.map((o) => ({ ...o, steps: withDiceCount(o.steps, count) })) };
      case "save":
        return { ...step, onFail: withDiceCount(step.onFail, count), onSuccess: withDiceCount(step.onSuccess, count) };
      case "check":
        return { ...step, then: withDiceCount(step.then, count), otherwise: withDiceCount(step.otherwise, count) };
      case "followUp":
        return { ...step, steps: withDiceCount(step.steps, count) };
      default:
        return step;
    }
  });
}

/** The `choose` step `chooseId` (anywhere in the use) with more options (Venomancer's poisons, HF p.9). */
function withOptions(steps: readonly Step[], chooseId: string, extra: readonly ChooseOption[]): Step[] {
  return steps.map((step): Step => {
    switch (step.kind) {
      case "choose": {
        const options = step.options.map((o) => ({ ...o, steps: withOptions(o.steps, chooseId, extra) }));
        return step.id === chooseId ? { ...step, options: [...options, ...extra] } : { ...step, options };
      }
      case "optional":
        return { ...step, steps: withOptions(step.steps, chooseId, extra) };
      case "save":
        return { ...step, onFail: withOptions(step.onFail, chooseId, extra), onSuccess: withOptions(step.onSuccess, chooseId, extra) };
      case "check":
        return { ...step, then: withOptions(step.then, chooseId, extra), otherwise: withOptions(step.otherwise, chooseId, extra) };
      case "followUp":
        return { ...step, steps: withOptions(step.steps, chooseId, extra) };
      default:
        return step;
    }
  });
}

/** One use with one patch applied; `patch` replaces only what it names (NV3). */
export function patchUse(use: CardUse, patch: UpgradePatch): CardUse {
  let next: CardUse = use;
  if (patch.limitTimes !== undefined && next.limit) next = { ...next, limit: { ...next.limit, times: patch.limitTimes } };
  if (patch.dieSides !== undefined) next = withDieSides(next, patch.dieSides);
  if (patch.diceCount !== undefined) next = { ...next, steps: withDiceCount(next.steps, patch.diceCount) };
  if (patch.range !== undefined && next.targets && next.targets.side !== "trigger") {
    next = { ...next, targets: { ...(next.targets as TargetSpec), range: patch.range } };
  }
  if (patch.extraSteps) next = { ...next, steps: [...next.steps, ...patch.extraSteps] };
  if (patch.chooseId !== undefined && patch.extraOptions) next = { ...next, steps: withOptions(next.steps, patch.chooseId, patch.extraOptions) };
  return next;
}

/** The entry with every upgrade that holds applied to its uses, in list order. */
export function applyUpgrades(effect: FeatureEffect, holdings: Holdings): FeatureEffect {
  const active = activeUpgrades(effect, holdings);
  if (active.length === 0) return effect;
  const uses = effect.uses.map((use) => active.filter((u) => u.useId === undefined || u.useId === use.id).reduce((u, up) => patchUse(u, up.patch), use));
  return { ...effect, uses };
}

/** The die size the holding upgrades give a use, if any (the held dice a delegated D5 feature creates, Rally's d10). */
export function upgradedDieSides(effect: FeatureEffect, useId: string, holdings: Holdings): DieSides | undefined {
  let sides: DieSides | undefined;
  for (const u of activeUpgrades(effect, holdings)) if ((u.useId === undefined || u.useId === useId) && u.patch.dieSides !== undefined) sides = u.patch.dieSides;
  return sides;
}
