/**
 * The character sheet's constants: limits, enums and labels, without zod (dcm-uh6r). Split out of
 * `./characters` (which re-exports every one) so Convex validators and modules that only need a constant do not
 * build the sheet's zod schemas when they load.
 */

export const TEXT = 2000;
export const NAME = 80;

/** Conditions a character can have (CB 102-103, plus Unconscious from Avoid Death, CB 106). */
export const CONDITIONS = ["vulnerable", "restrained", "hidden", "cloaked", "unconscious", "distracted"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const SUBCLASS_RANKS = ["foundation", "specialization", "mastery"] as const;
export type SubclassRank = (typeof SUBCLASS_RANKS)[number];

/**
 * When an effect ends: `expire(sheet, event)` (src/lib/domain/characters/expiry.ts) removes it.
 * `scene` ends at session end; `manual` only through its End button.
 */
export const EFFECT_UNTIL = ["rest", "longRest", "session", "hit", "scene", "manual"] as const;
export const HELD_DIE_UNTIL = ["session", "longRest", "manual"] as const;
/**
 * When a used "once per X" feature comes back. `scene` (plan sheet-drawer SD0, Q7, dcm-bxp.117; widened, no version
 * bump): "once per scene" limits, cleared when the scene ends (the GM ends the encounter or presses End scene, or the
 * session ends). `campaign` (plan lanes-2 wave 9, E5.3, dcm-pg8x; widened, no version bump, old rows stay valid): an
 * entry nothing ends, Words of Discord's per-target memory (user answer 2026-10-31, dcm-c75: the whole campaign).
 */
export const FEATURE_USE_UNTIL = ["rest", "longRest", "session", "scene", "gmTurn", "day", "week", "campaign"] as const;
/** Labels for the `pronouns` field (dcm-bxp.35): "gender" is the default. */
export const PRONOUNS_LABELS = ["gender", "pronouns"] as const;
export type PronounsLabel = (typeof PRONOUNS_LABELS)[number];

/** The `pronouns` field's label: "Gender" unless the character chose "Pronouns" (dcm-bxp.35). */
export function pronounsFieldLabel(flag: PronounsLabel | undefined): "Gender" | "Pronouns" {
  return flag === "pronouns" ? "Pronouns" : "Gender";
}
export const HELD_DIE_KINDS = ["rally", "prayer", "patron", "combo"] as const;

/** The level-up options (CB 110; `comboDie`: Brawler only, HF 10). Proficiency and multiclass take both picks of a level. */
export const ADVANCEMENT_OPTIONS = ["traits", "hp", "stress", "experiences", "domainCard", "evasion", "subclass", "proficiency", "multiclass", "comboDie"] as const;
export type AdvancementOption = (typeof ADVANCEMENT_OPTIONS)[number];

/**
 * A sheet effect's id. Widened from 40 to 120 (dcm-s7hd; widen only, stored sheets still parse): an adversary feature's
 * effect on a PC is `card:<adversaryId>/<feature>:<n>` (cardRunner, read back by ADVERSARY_SHEET_EFFECT), and the SRD's
 * longest is 77 characters (`card:fallen-warlord-realm-breaker/I Have Never Known Defeat (Phase Change):99`).
 */
export const EFFECT_ID_MAX = 120;

/**
 * The most `featureUses` entries a sheet holds (widened from 40 by the sheet drawer, SD0): every once-per feature of a
 * class, subclass, multiclass, heritage, transformation and Beastform, the per-use and per-target entries of five loadout
 * cards, and D5's keys.
 */
export const FEATURE_USES_MAX = 60;

/** Most tokens or dice one card holds (Dark Army places 8; Sigil of Retribution holds up to your level in d8s). */
export const CARD_TOKENS_MAX = 99;

/** The most Focus a Martial Artist holds (HF p.12: "You can hold a maximum of 6 Focus"). */
export const FOCUS_HOLD_MAX = 6;

/** The martial stances of HF p.12 (four per tier). */
export const MARTIAL_STANCES_MAX = 16;

/** The most token names one sheet keeps (`creatureTokens`; as an adversary instance's `MAX_CREATURE_TOKEN_KINDS`). */
export const MAX_SHEET_CREATURE_TOKEN_KINDS = 10;

/** The most Slayer Dice or Know the Tide tokens a sheet can hold: Proficiency and level both stop at 10. */
export const SESSION_POOL_MAX = 10;

/** The stored sheet's current `schemaVersion`. */
export const SHEET_VERSION = 2;
