import type { CardUse, Step } from "@/lib/domain/card-effects/types";

import type { FormValues } from "./model";
import type { UseRequest } from "./use-card";

/**
 * Card-use helpers (plan combat-actions CA6, lanes-2 E3): what a card use asks beyond its form (a vault swap, the
 * trigger's damage type, listed numbers, a pick that must differ from another). The HUD's card picker (plan combat-hud
 * H3.2, `hud/pick-card`) asks them; the classic Use dialog went with the cut-over (H8.1).
 */

/**
 * Plan lanes-2 E3.3 (dcm-aw16 (1), dcm-u4pq): a vault card the dialog can swap in (Codex-Touched, CB p.333: "replace
 * this card with any card from your vault without paying its Recall Cost"). The Hand passes the vault cards at or under
 * the character's level; the server checks both again (`combatCards.useCard` refuses INVALID otherwise).
 */
export type VaultPick = { cardId: string; name: string; level: number };

/** E3.3: what the dialog sends: a use request plus the vault card a `swapWithVault` step brings in. */
export type DialogRequest = UseRequest & { swapWith?: string };

/** E3.3 (dcm-aw16 (1)): whether the use has a `loadout` `swapWithVault` step, at any depth. */
export function swapsWithVault(use: CardUse): boolean {
  return someStep(use.steps, (s) => s.kind === "loadout" && s.op === "swapWithVault");
}

/**
 * E3.3 (dcm-aw16 (2), dcm-86z): whether the use deals "the same damage" as its trigger (Encore, CB p.335: "you deal the
 * same damage to the target that your ally dealt"): the dialog then asks the type of that damage (`triggerDamageType`).
 */
export function asksTriggerDamageType(use: CardUse): boolean {
  return someStep(use.steps, (s) => s.kind === "damage" && s.roll.kind === "sameAsTrigger");
}

function someStep(steps: readonly Step[], test: (s: Step) => boolean): boolean {
  for (const step of steps) {
    if (test(step)) return true;
    const inner =
      step.kind === "choose"
        ? step.options.flatMap((o) => o.steps)
        : step.kind === "optional" || step.kind === "followUp"
          ? step.steps
          : step.kind === "save"
            ? [...step.onFail, ...step.onSuccess]
            : step.kind === "check"
              ? [...step.then, ...step.otherwise, ...(step.table ?? []).flatMap((r) => r.steps)]
              : [];
    if (inner.length > 0 && someStep(inner, test)) return true;
  }
  return false;
}

/** E3 (dcm-uyc): the values a `NumberChoice` lists, or null. */
export function listedValues(use: CardUse, id: string): readonly number[] | null {
  const values = use.choices?.find((c) => c.id === id)?.values;
  return values && values.length > 0 ? values : null;
}

/** E3 (dcm-uyc): a listed number starts at its first listed value at or above its minimum (the runner's default). */
export function withListedNumbers(use: CardUse, values: FormValues): FormValues {
  const numbers = { ...values.numbers };
  for (const c of use.choices ?? []) {
    const listed = listedValues(use, c.id);
    if (listed && !listed.includes(numbers[c.id] ?? c.min)) numbers[c.id] = listed.find((n) => n >= c.min) ?? listed[0]!;
  }
  return { ...values, numbers };
}

/** E3 (dcm-40m): the choose step (by id) whose pick this one must not repeat, at any depth of the use's steps. */
export function distinctFromOf(use: CardUse, stepId: string): string | undefined {
  const find = (steps: readonly Step[]): string | undefined => {
    for (const step of steps) {
      if (step.kind === "choose") {
        if (step.id === stepId) return step.distinctFrom;
        for (const o of step.options) {
          const inner = find(o.steps);
          if (inner) return inner;
        }
      } else if (step.kind === "optional" || step.kind === "followUp") {
        const inner = find(step.steps);
        if (inner) return inner;
      } else if (step.kind === "save") {
        const inner = find(step.onFail) ?? find(step.onSuccess);
        if (inner) return inner;
      } else if (step.kind === "check") {
        const inner = find(step.then) ?? find(step.otherwise);
        if (inner) return inner;
      }
    }
    return undefined;
  };
  return find(use.steps);
}
