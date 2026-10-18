// The hooks every D5 caller uses (contract in types.ts). Pure: bundled into Convex.
//
// Each hook looks up the sheet's class, and its multiclass class (CB 110-111:
// class features only, never the second Hope feature), in the registry and
// combines their answers. A class without a module answers with the no-op
// default: no options, no overrides, no prompts, the sheet unchanged.
//
// ```ts
// // T1 dice box / rolls.ts
// const options = rollOptions(sheet, "damage");
// const override = weaponOverrides(sheet)[0];
// const prompts = afterDualityRoll(sheet, { hope, fear, roll });
// // T3 rests.finish, after expire(sheet, "longRest")
// sheet = onRest(sheet, "long");
// // T5 sessions.start / sessions.end
// sheet = onSessionStart(sheet, rollDie);
// sheet = onSessionEnd(expire(sheet, "session"));
// // T8a features panel / classFeatures.use
// const hope = hopeFeature(sheet);            // undefined → nothing to show
// const actions = classActions(sheet);
// const feature = findFeature(sheet, "noMercy");
// ```
// Tests pass their own registry as the last argument.

import type { CharacterSheet } from "../../validation/characters";
import { CLASS_FEATURES, type Registry } from "./index";
import type { ClassFeatures, DualityRollResult, FeatureMeta, HookRollKind, Rng, RollOption, RollPrompt, WeaponOverride } from "./types";

type Classed = Pick<CharacterSheet, "classId" | "multiclass">;

/** The sheet's class module, then its multiclass module (when different); missing ones are skipped. */
function modulesFor(sheet: Classed, registry: Registry): ClassFeatures[] {
  const ids = [sheet.classId, sheet.multiclass?.classId].filter((id, i, all): id is string => id !== undefined && all.indexOf(id) === i);
  return ids.flatMap((id) => {
    const features = registry[id];
    return features ? [features] : [];
  });
}

export function rollOptions(sheet: CharacterSheet, kind: HookRollKind, registry: Registry = CLASS_FEATURES): RollOption[] {
  return modulesFor(sheet, registry).flatMap((m) => m.rollOptions?.(sheet, kind) ?? []);
}

export function weaponOverrides(sheet: CharacterSheet, registry: Registry = CLASS_FEATURES): WeaponOverride[] {
  return modulesFor(sheet, registry).flatMap((m) => m.weaponOverrides?.(sheet) ?? []);
}

export function afterDualityRoll(sheet: CharacterSheet, result: DualityRollResult, registry: Registry = CLASS_FEATURES): RollPrompt[] {
  return modulesFor(sheet, registry).flatMap((m) => m.afterDualityRoll?.(sheet, result) ?? []);
}

export function onRest(sheet: CharacterSheet, kind: "short" | "long", registry: Registry = CLASS_FEATURES): CharacterSheet {
  return modulesFor(sheet, registry).reduce((s, m) => m.onRest?.(s, kind) ?? s, sheet);
}

export function onSessionStart(sheet: CharacterSheet, rng: Rng, registry: Registry = CLASS_FEATURES): CharacterSheet {
  return modulesFor(sheet, registry).reduce((s, m) => m.onSessionStart?.(s, rng) ?? s, sheet);
}

export function onSessionEnd(sheet: CharacterSheet, registry: Registry = CLASS_FEATURES): CharacterSheet {
  return modulesFor(sheet, registry).reduce((s, m) => m.onSessionEnd?.(s) ?? s, sheet);
}

/** The primary class's Hope feature (multiclass never grants one), or undefined. */
export function hopeFeature(sheet: Classed, registry: Registry = CLASS_FEATURES): FeatureMeta | undefined {
  return registry[sheet.classId]?.hopeFeature;
}

/** Class actions of the class and the multiclass. */
export function classActions(sheet: Classed, registry: Registry = CLASS_FEATURES): FeatureMeta[] {
  return modulesFor(sheet, registry).flatMap((m) => m.classActions ?? []);
}

/** The Hope feature or class action with this key that the sheet may use, or undefined. */
export function findFeature(sheet: Classed, key: string, registry: Registry = CLASS_FEATURES): FeatureMeta | undefined {
  const hope = hopeFeature(sheet, registry);
  if (hope?.key === key) return hope;
  return classActions(sheet, registry).find((f) => f.key === key);
}
