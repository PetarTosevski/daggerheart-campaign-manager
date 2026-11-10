import type * as z from "../zod";

import { characterSchemas } from "./character-schemas";
import {
  TEXT,
  NAME,
  CONDITIONS,
  SUBCLASS_RANKS,
  EFFECT_UNTIL,
  HELD_DIE_UNTIL,
  FEATURE_USE_UNTIL,
  PRONOUNS_LABELS,
  pronounsFieldLabel,
  HELD_DIE_KINDS,
  ADVANCEMENT_OPTIONS,
  EFFECT_ID_MAX,
  FEATURE_USES_MAX,
  CARD_TOKENS_MAX,
  FOCUS_HOLD_MAX,
  MARTIAL_STANCES_MAX,
  MAX_SHEET_CREATURE_TOKEN_KINDS,
  SESSION_POOL_MAX,
  SHEET_VERSION,
} from "./character-constants";

/** The zod-free constants (dcm-uh6r: Convex validators and light modules import them without building the schemas). */
export {
  TEXT,
  NAME,
  CONDITIONS,
  SUBCLASS_RANKS,
  EFFECT_UNTIL,
  HELD_DIE_UNTIL,
  FEATURE_USE_UNTIL,
  PRONOUNS_LABELS,
  pronounsFieldLabel,
  HELD_DIE_KINDS,
  ADVANCEMENT_OPTIONS,
  EFFECT_ID_MAX,
  FEATURE_USES_MAX,
  CARD_TOKENS_MAX,
  FOCUS_HOLD_MAX,
  MARTIAL_STANCES_MAX,
  MAX_SHEET_CREATURE_TOKEN_KINDS,
  SESSION_POOL_MAX,
  SHEET_VERSION,
};
export type { Condition, SubclassRank, PronounsLabel, AdvancementOption } from "./character-constants";

/**
 * The sheet schemas (built in ./character-schemas.ts, where each one is documented). Importing this module builds them;
 * Convex code that parses a sheet only on some calls uses `characterSchemas()` from there instead (dcm-uh6r).
 */
const schemas = characterSchemas();
export const traitsSchema = schemas.traitsSchema;
export const ancestryChoiceSchema = schemas.ancestryChoiceSchema;
export const experienceV1Schema = schemas.experienceV1Schema;
export const listId = schemas.listId;
export const experienceSchema = schemas.experienceSchema;
export const inventoryItemSchema = schemas.inventoryItemSchema;
export const portraitSchema = schemas.portraitSchema;
export const characterSheetV1Schema = schemas.characterSheetV1Schema;
export const advancementPickSchema = schemas.advancementPickSchema;
export const advancementSchema = schemas.advancementSchema;
export const conditionSourceSchema = schemas.conditionSourceSchema;
export const effectSchema = schemas.effectSchema;
export const heldDieSchema = schemas.heldDieSchema;
export const featureUseSchema = schemas.featureUseSchema;
export const cardTokensSchema = schemas.cardTokensSchema;
export const martialStateSchema = schemas.martialStateSchema;
export const classStateSchema = schemas.classStateSchema;
export const sheetCreatureTokensSchema = schemas.sheetCreatureTokensSchema;
export const sessionFeaturesSchema = schemas.sessionFeaturesSchema;
export const characterSheetSchema = schemas.characterSheetSchema;

export type ConditionSource = z.infer<typeof conditionSourceSchema>;
export type Advancement = z.infer<typeof advancementSchema>;
export type AdvancementPick = z.infer<typeof advancementPickSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type HeldDie = z.infer<typeof heldDieSchema>;
export type FeatureUse = z.infer<typeof featureUseSchema>;
export type CardTokens = z.infer<typeof cardTokensSchema>;
export type SheetCreatureTokens = z.infer<typeof sheetCreatureTokensSchema>;
export type ClassState = z.infer<typeof classStateSchema>;
export type SessionFeatures = z.infer<typeof sessionFeaturesSchema>;

export type CharacterSheetV1 = z.infer<typeof characterSheetV1Schema>;
/** A parsed sheet: every D5 field is present (defaults filled in by `readSheet`). */
export type CharacterSheet = z.infer<typeof characterSheetSchema>;
/** A sheet before defaults: the D5 fields may be missing (what callers may build and `storedSheet` accepts). */
export type CharacterSheetInput = z.input<typeof characterSheetSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type Experience = z.infer<typeof experienceSchema>;

export type { CharacterDraft, SheetPatch } from "./character-input";
