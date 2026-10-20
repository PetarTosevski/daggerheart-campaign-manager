// The hooks every D5 caller uses (contract in types.ts). Pure: bundled into Convex.
//
// Each hook looks up the sheet's class, and its multiclass class (CB 110-111:
// class features only, never the second Hope feature), in the registry and
// combines their answers. A class without a module answers with the no-op
// default: no options, no overrides, no prompts, the sheet unchanged.
//
// Held dice any class can spend (a Rally Die) are offered for every sheet by
// `rollOptions` (held-dice.ts), once, whatever the class and multiclass.
// `rollOptions`, `weaponOverrides` and `afterDualityRoll` take the campaign's
// `FeatureScope`: a Hope & Fear class's module answers only with `hopeAndFear`.
// The session features (src/lib/domain/session-features) add the Waxing Moon damage
// option to `rollOptions` and the Slayer choice prompt to `afterDualityRoll`.
//
// ```ts
// // T1 dice box / rolls.ts
// const scope = featureScope(campaign.frameId, campaign.options);
// const options = rollOptions(sheet, "damage", undefined, scope);
// const override = weaponOverrides(sheet, undefined, scope)[0];
// const prompts = afterDualityRoll(sheet, { hope, fear, roll }, undefined, scope);
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
// Tests pass their own registry as the third argument.

import type { CharacterSheet } from "../../validation/characters";
import { slayerStorePrompt, waxingMoonOption } from "../session-features/dice-hooks";
import { heldDiceOptions } from "./held-dice";
import { CLASS_FEATURES, classFeaturesAvailable, type Registry } from "./index";
import type { ClassFeatures, DualityRollResult, FeatureMeta, FeatureScope, HookRollKind, Rng, RollOption, RollPrompt, WeaponOverride, WeaponSheet } from "./types";

type Classed = Pick<CharacterSheet, "classId" | "multiclass">;

/** No campaign known: every class module answers. */
const EVERYTHING: FeatureScope = { hopeAndFear: true, ikonis: false };

/** The sheet's class module, then its multiclass module (when different); missing ones are skipped. */
function modulesFor(sheet: Classed, registry: Registry): ClassFeatures[] {
  const ids = [sheet.classId, sheet.multiclass?.classId].filter((id, i, all): id is string => id !== undefined && all.indexOf(id) === i);
  return ids.flatMap((id) => {
    const features = registry[id];
    return features ? [features] : [];
  });
}

/** The modules the campaign allows (Hope & Fear classes only with the option). */
function scopedModules(sheet: Classed, registry: Registry, scope: FeatureScope): ClassFeatures[] {
  return modulesFor(sheet, registry).filter((m) => classFeaturesAvailable(m.classId, scope.hopeAndFear));
}

/**
 * The class modules' options for this roll, then the session features' (Waxing Moon +2 on damage rolls for a
 * Lunar Phases holder with a Waxing die, HF 17; only in a `hopeAndFear` scope), then the held Rally Dice (any class).
 */
export function rollOptions(sheet: CharacterSheet, kind: HookRollKind, registry: Registry = CLASS_FEATURES, scope: FeatureScope = EVERYTHING): RollOption[] {
  return [
    ...scopedModules(sheet, registry, scope).flatMap((m) => m.rollOptions?.(sheet, kind, scope) ?? []),
    ...waxingMoonOption(sheet, kind, scope),
    ...heldDiceOptions(sheet),
  ];
}

export function weaponOverrides(sheet: WeaponSheet, registry: Registry = CLASS_FEATURES, scope: FeatureScope = EVERYTHING): WeaponOverride[] {
  return scopedModules(sheet, registry, scope).flatMap((m) => m.weaponOverrides?.(sheet) ?? []);
}

/**
 * The class modules' prompts, then the Slayer choice (session-features U2: "Take the Hope or store a Slayer Die?"
 * after an action roll with Hope while the pool is below Proficiency; `sheet` is the sheet after the roll's gains).
 */
export function afterDualityRoll(sheet: CharacterSheet, result: DualityRollResult, registry: Registry = CLASS_FEATURES, scope: FeatureScope = EVERYTHING): RollPrompt[] {
  return [...scopedModules(sheet, registry, scope).flatMap((m) => m.afterDualityRoll?.(sheet, result) ?? []), ...slayerStorePrompt(sheet, result)];
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

/** Class actions of the class and the multiclass; one shared by both (the Rally Die spend) is listed once. */
export function classActions(sheet: Classed, registry: Registry = CLASS_FEATURES): FeatureMeta[] {
  return modulesFor(sheet, registry)
    .flatMap((m) => m.classActions ?? [])
    .filter((f, i, all) => all.findIndex((g) => g.key === f.key) === i);
}

/** The Hope feature or class action with this key that the sheet may use, or undefined. */
export function findFeature(sheet: Classed, key: string, registry: Registry = CLASS_FEATURES): FeatureMeta | undefined {
  const hope = hopeFeature(sheet, registry);
  if (hope?.key === key) return hope;
  return classActions(sheet, registry).find((f) => f.key === key);
}

/** The Evasion bonus of the active weapon override (Brawler's Strike +1), the largest when several apply (HF 10). */
export function overrideEvasion(sheet: WeaponSheet, registry: Registry = CLASS_FEATURES): number {
  return Math.max(0, ...weaponOverrides(sheet, registry).map((o) => o.evasionBonus ?? 0));
}
