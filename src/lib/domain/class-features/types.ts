// The class-feature hook contract (D5 T0). Pure types: bundled into Convex.
//
// One `ClassFeatures` module per class lives in `classes/<classId>.ts` (T8a, T8b,
// T8c) and is listed in the registry (`index.ts`, T8a). Nobody calls a module
// directly: dice (T1), rests (T3), sessions (T5) and the features dispatcher
// (T8a) go through `hooks.ts`, which falls back to no-op defaults for a class
// without a module and also runs the multiclass's class features (CB 110-111,
// never its Hope feature). Every hook is pure: it gets a sheet and returns
// data or a new sheet; the Convex caller saves it and writes the actionLog row.
//
// ```ts
// // classes/warrior.ts (T8a/T8b)
// export const warrior: ClassFeatures = {
//   classId: "warrior",
//   hopeFeature: { key: "noMercy", name: "No Mercy", cost: { hope: 3 }, automation: "auto", target: "self",
//     use: ({ sheet }) => ({ sheet: { ...sheet, effects: [...sheet.effects, { id: "no-mercy", source: "No Mercy",
//       text: "+1 to attack rolls until your next rest.", until: "rest", mods: { attack: 1 } }] },
//       summary: "used No Mercy" }) },
//   rollOptions: (sheet, kind) => (kind === "damage" ? [{ key: "combatTraining", label: "Combat Training",
//     effect: { kind: "modifier", value: sheet.level }, auto: true }] : []),
// };
// ```

import type { RollKind, RollRecord } from "../duality";
import type { CharacterSheet } from "../../validation/characters";

/** A fair die roll (server: convex/lib/dice.ts `rollDie`; tests: a fixed sequence). */
export type Rng = (sides: number) => number;

/** Rolls the hooks see: a Duality action or reaction roll, or a damage roll. */
export type HookRollKind = Exclude<RollKind, "free">;

/** What an option or feature costs; the caller checks and pays it. */
export type FeatureCost = {
  hope?: number;
  stress?: number;
  /** Spends this held die (`sheet.heldDice[].id`), e.g. a Rally Die. */
  heldDieId?: string;
  /** Marks this use (`sheet.featureUses`), e.g. once per long rest. */
  use?: { key: string; until: "rest" | "longRest" | "session" };
};

/** What choosing a roll option adds to the roll. */
export type RollOptionEffect =
  | { kind: "modifier"; value: number }
  | { kind: "dice"; count: number; sides: number }
  | { kind: "heldDie"; heldDieId: string }
  | { kind: "advantage" };

/**
 * A choice the dice box offers for a roll (Rally Die, Sneak Attack, Unstoppable,
 * Combat Training). `auto: true` options apply without a click.
 */
export type RollOption = {
  key: string;
  label: string;
  effect: RollOptionEffect;
  cost?: FeatureCost;
  auto?: boolean;
};

/**
 * Replaces the weapon damage formula (Brawler's Strike, Beastform, the Ikonis).
 * `dice` are rolled and summed with `flat`; a critical uses `critBase` instead
 * of the dice's maximum when set (Brawler: 14 × Proficiency, settled rule).
 */
export type WeaponOverride = {
  key: string;
  label: string;
  dice: { count: number; sides: number }[];
  flat: number;
  critBase?: number;
  /** Evasion while this replaces the weapon (Brawler without a weapon: +1). */
  evasionBonus?: number;
};

/** A finished Duality roll as `afterDualityRoll` sees it. */
export type DualityRollResult = { hope: number; fear: number; roll: RollRecord };

/** A question shown after a roll (Strange Patterns: "+1 Hope or clear 1 Stress?"). The answer goes to the feature with `params.choice`. */
export type RollPrompt = {
  key: string;
  /** The `FeatureMeta.key` that handles the answer. */
  featureKey: string;
  text: string;
  choices: { key: string; label: string }[];
};

/** `auto`: the app changes state; `assist`: it pays the cost and shows a reminder; `text`: shown only. */
export type Automation = "auto" | "assist" | "text";

/** Who a feature acts on: the user, one ally, every active non-away PC, or nobody (narrative). */
export type FeatureTarget = "self" | "ally" | "party" | "none";

/** Typed parameters `classFeatures.use` passes through (T8a). */
export type FeatureParams = { targetId?: string; choice?: string; dieIndexes?: number[]; amount?: number };

/** Another character a feature reads or writes, by its plain id string. */
export type OtherSheet = { characterId: string; sheet: CharacterSheet };

export type FeatureUseInput = {
  /** The user's sheet, cost already paid. */
  sheet: CharacterSheet;
  params: FeatureParams;
  rng: Rng;
  /** `target: "ally"`: the chosen ally; `"party"`: every other active non-away PC. */
  others: OtherSheet[];
  /** The roll the feature acts on, when it needs one (Volatile Magic, Patron's Boon, Witch's Charm), loaded by the dispatcher. */
  roll?: RollRecord;
};

export type FeatureUseResult = {
  sheet: CharacterSheet;
  /** Only the other sheets that changed; each gets its own actionLog row in the same group. */
  others?: OtherSheet[];
  /** GM Fear to gain (positive) through gainFear, recorded as the row's `fearDelta`. */
  fearDelta?: number;
  /** A new or rerolled roll to log. */
  roll?: RollRecord;
  /** The feed line, after the character's name ("used Rogue's Dodge"). */
  summary: string;
};

/** A Hope feature or class action: metadata the UI renders generically, plus `use` for automated ones. */
export type FeatureMeta = {
  key: string;
  name: string;
  /** Short rules reminder shown on the button. */
  text?: string;
  cost?: FeatureCost;
  automation: Automation;
  target: FeatureTarget;
  /** Applies the feature; absent for `text` features. Throw a `RuleError` for an expected refusal. */
  use?: (input: FeatureUseInput) => FeatureUseResult;
};

/** Everything a class adds. Every member is optional; `hooks.ts` supplies the no-op default. */
export type ClassFeatures = {
  classId: string;
  /** The class's Hope feature (3 Hope, CB 27). Never gained through multiclass. */
  hopeFeature?: FeatureMeta;
  classActions?: readonly FeatureMeta[];
  /** Options the dice box offers for a roll of this kind. */
  rollOptions?: (sheet: CharacterSheet, kind: HookRollKind) => RollOption[];
  weaponOverrides?: (sheet: CharacterSheet) => WeaponOverride[];
  afterDualityRoll?: (sheet: CharacterSheet, result: DualityRollResult) => RollPrompt[];
  /** After `expire(sheet, shortRest|longRest)`: class resets on a rest. */
  onRest?: (sheet: CharacterSheet, kind: "short" | "long") => CharacterSheet;
  /** Session start (Prayer Dice). */
  onSessionStart?: (sheet: CharacterSheet, rng: Rng) => CharacterSheet;
  /** Session end, after `expire(sheet, "session")`. */
  onSessionEnd?: (sheet: CharacterSheet) => CharacterSheet;
};
