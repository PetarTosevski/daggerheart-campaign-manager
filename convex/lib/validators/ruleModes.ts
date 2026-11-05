import { v, type Infer, type Validator, type VOptional } from "convex/values";

import type { RuleModes, StoredRuleModes } from "../../../src/lib/rules/registry";

/**
 * Validators of the rule switches (plan rule-switches RS0, CD19). `campaigns.ruleModes` is a typed object of optional
 * fields, one per settable rule of `src/lib/rules/registry.ts` (plus the numbers set in a rule's row), so rule 7 needs
 * no `schemaVersion`. Widen only: a new rule is a new optional field, a new variant a new literal; never remove one.
 * The drift checks at the bottom and tests/unit/rules/registry.test.ts fail when this file and the registry disagree.
 */

const bookManual = v.union(v.literal("book"), v.literal("manual"));

export const fearFromRestsModeValidator = v.union(v.literal("book"), v.literal("extendedDowntime"), v.literal("manual"));
export const minionsModeValidator = v.union(v.literal("book"), v.literal("gmPicks"), v.literal("manual"));
export const darknessModeValidator = v.union(
  v.literal("book"),
  v.literal("disadvantage"),
  v.literal("difficulty"),
  v.literal("both"),
  v.literal("manual"),
);
export const sharedDomainCardsValidator = v.union(v.literal("allow"), v.literal("warn"), v.literal("refuse"));

/** Every field, each in its resolved (required) form. */
const fields = {
  // switch rules
  hopeFearFromRolls: bookManual,
  fearFromRests: fearFromRestsModeValidator,
  extraSpotlightFear: bookManual,
  resistance: bookManual,
  stressOverflow: bookManual,
  fullStressVulnerable: bookManual,
  minions: minionsModeValidator,
  adversaryDefeated: bookManual,
  armorSlots: bookManual,
  conditionDice: bookManual,
  hiddenEnds: bookManual,
  shortRestLimit: bookManual,
  interruptedRest: bookManual,
  deathMovePrompt: bookManual,
  deathMoveResolve: bookManual,
  spotlightToGm: bookManual,
  playersWait: bookManual,
  lineOfSight: bookManual,
  wallsBlock: bookManual,
  darkness: darknessModeValidator,
  countdownTicks: bookManual,
  witherTokens: bookManual,
  horizonSanctuaryRest: bookManual,
  beastFeastFeast: bookManual,
  colossusSiphoning: bookManual,
  umbraLurkingDarkness: bookManual,
  andaluriaLycanthropy: bookManual,
  // optional rules
  massiveDamage: v.boolean(),
  spotlightTracker: v.boolean(),
  fallingDamage: v.boolean(),
  underwater: v.boolean(),
  goldCoins: v.boolean(),
  fateRolls: v.boolean(),
  pcConflict: v.boolean(),
  horizonEncounterBonuses: v.boolean(),
  sharedDomainCards: sharedDomainCardsValidator,
  definedRanges: v.boolean(),
  // numbers set in a rule's row (range checked by `ruleSettings.set`)
  spotlightTrackerTokens: v.number(),
  darknessDifficulty: v.number(),
};

/** Every rule's mode, resolved (`ruleSettings.get`). */
export const ruleModesValidator = v.object(fields);

/** `campaigns.ruleModes` as stored: any field may be unset (unset = the registry default). */
export const storedRuleModesValidator = v.object(allOptional(fields));

/** Every stored key (the drift test compares it with the registry). */
export const RULE_MODE_FIELDS = Object.keys(fields) as (keyof typeof fields)[];

function allOptional<F extends Record<string, Validator<unknown, "required", string>>>(f: F): { [K in keyof F]: VOptional<F[K]> } {
  return Object.fromEntries(Object.entries(f).map(([k, val]) => [k, v.optional(val)])) as { [K in keyof F]: VOptional<F[K]> };
}

function change<K extends keyof typeof fields>(key: K) {
  return v.object({ key: v.literal(key), value: fields[key] });
}

/**
 * One rule change (rule 12: one field per call): a union of `{ key, value }`, one member per field. `ruleSettings.set`
 * checks the rest (the rule is in the campaign's frame, a number is a whole number in range).
 */
export const ruleChangeValidator = v.union(
  change("hopeFearFromRolls"),
  change("fearFromRests"),
  change("extraSpotlightFear"),
  change("resistance"),
  change("stressOverflow"),
  change("fullStressVulnerable"),
  change("minions"),
  change("adversaryDefeated"),
  change("armorSlots"),
  change("conditionDice"),
  change("hiddenEnds"),
  change("shortRestLimit"),
  change("interruptedRest"),
  change("deathMovePrompt"),
  change("deathMoveResolve"),
  change("spotlightToGm"),
  change("playersWait"),
  change("lineOfSight"),
  change("wallsBlock"),
  change("darkness"),
  change("countdownTicks"),
  change("witherTokens"),
  change("horizonSanctuaryRest"),
  change("beastFeastFeast"),
  change("colossusSiphoning"),
  change("umbraLurkingDarkness"),
  change("andaluriaLycanthropy"),
  change("massiveDamage"),
  change("spotlightTracker"),
  change("fallingDamage"),
  change("underwater"),
  change("goldCoins"),
  change("fateRolls"),
  change("pcConflict"),
  change("horizonEncounterBonuses"),
  change("sharedDomainCards"),
  change("definedRanges"),
  change("spotlightTrackerTokens"),
  change("darknessDifficulty"),
);

export type RuleChange = { [K in keyof typeof fields]: { key: K; value: Infer<(typeof fields)[K]> } }[keyof typeof fields];

// Drift checks: the validator and the registry's types must be assignable both ways.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const resolvedMatches: Same<Infer<typeof ruleModesValidator>, { -readonly [K in keyof RuleModes]: RuleModes[K] }> = true;
const storedMatches: Same<Infer<typeof storedRuleModesValidator>, StoredRuleModes> = true;
void resolvedMatches;
void storedMatches;
