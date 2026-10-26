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
//     effect: { kind: "modifier", value: sheet.level }, auto: true, physicalOnly: true }] : []),
// };
// ```

import type { RollKind, RollRecord } from "../duality";
import type { CharacterSheet, HeldDie } from "../../validation/characters";

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
  /** Roll options only (`applyRollOptions`): ends this effect (`sheet.effects[].id`), e.g. Get In & Get Out's advantage, spent once. */
  effectId?: string;
};

/**
 * What the campaign allows a sheet's class modules to offer: Hope & Fear classes only with the
 * `hopeAndFear` option (`classFeaturesAvailable`), and in Motherboard (`ikonis`) the Warrior's Combat
 * Training is replaced by Ikonis Training (CB 295). Callers without a campaign pass nothing: everything is offered.
 */
export type FeatureScope = { hopeAndFear: boolean; ikonis: boolean };

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
  /** Only for physical damage (Combat Training, CB 48): `convex/rolls.ts` drops it for a magic damage source. */
  physicalOnly?: boolean;
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
  /** The damage it deals; unset is physical (Brawler's Strike is unarmed, HF 10). */
  damageType?: "physical" | "magic";
};

/** What a weapon override reads from the sheet (so `derivedDefense` can ask for the override's Evasion). */
export type WeaponSheet = Pick<CharacterSheet, "classId" | "multiclass" | "primaryWeaponId" | "secondaryWeaponId" | "proficiency">;

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

/**
 * An input the features panel renders for a feature, filling one `FeatureParams` field:
 * - `text`: free text in `choice` (a target's name); optional.
 * - `select`: one of `options(sheet)` in `choice` (a Beastform, a trait, a loadout card).
 * - `number`: a whole number from `min` to `max` in `amount` (Strange Patterns).
 * - `heldDice`: held dice of `heldKind`, by their order among those dice, in `dieIndexes` (Prayer Dice).
 * - `rollDice`: damage dice of the latest roll, by index, in `dieIndexes` (Volatile Magic).
 * - `ally`: another active PC in `targetId`; optional ones default to the user.
 */
export type FeatureInput =
  | { kind: "text"; param: "choice"; label: string; placeholder?: string }
  | { kind: "select"; param: "choice"; label: string; required: boolean; empty: string; options: (sheet: CharacterSheet) => { value: string; label: string }[] }
  | { kind: "number"; param: "amount"; label: string; min: number; max: number }
  | { kind: "heldDice"; param: "dieIndexes"; label: string; heldKind: HeldDie["kind"] }
  | { kind: "rollDice"; param: "dieIndexes"; label: string }
  | { kind: "ally"; param: "targetId"; label: string; required: boolean };

/** A Hope feature or class action: metadata the UI renders generically, plus `use` for automated ones. */
export type FeatureMeta = {
  key: string;
  name: string;
  /** Short rules reminder shown on the button. */
  text?: string;
  cost?: FeatureCost;
  automation: Automation;
  target: FeatureTarget;
  /** Inputs the features panel shows before the Use button (see `FeatureInput`). */
  inputs?: readonly FeatureInput[];
  /** Applies the feature; absent for `text` features. Throw a `RuleError` for an expected refusal. */
  use?: (input: FeatureUseInput) => FeatureUseResult;
};

/** Everything a class adds. Every member is optional; `hooks.ts` supplies the no-op default. */
export type ClassFeatures = {
  classId: string;
  /** The class's Hope feature (3 Hope, CB 27). Never gained through multiclass. */
  hopeFeature?: FeatureMeta;
  classActions?: readonly FeatureMeta[];
  /** Options the dice box offers for a roll of this kind. Held Rally Dice are offered by `hooks.ts` for every class. */
  rollOptions?: (sheet: CharacterSheet, kind: HookRollKind, scope: FeatureScope) => RollOption[];
  weaponOverrides?: (sheet: WeaponSheet) => WeaponOverride[];
  afterDualityRoll?: (sheet: CharacterSheet, result: DualityRollResult) => RollPrompt[];
  /** After `expire(sheet, shortRest|longRest)`: class resets on a rest. */
  onRest?: (sheet: CharacterSheet, kind: "short" | "long") => CharacterSheet;
  /** Session start (Prayer Dice). */
  onSessionStart?: (sheet: CharacterSheet, rng: Rng) => CharacterSheet;
  /** Session end, after `expire(sheet, "session")`. */
  onSessionEnd?: (sheet: CharacterSheet) => CharacterSheet;
};
