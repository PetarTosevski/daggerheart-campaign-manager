import { v } from "convex/values";

import { CATALOGUE_SORTS, DRAFT_KINDS, TEXT_SIZES, UI_STATE_KEYS } from "../../../src/lib/config/preferences";

/** Validators of the account-saved preferences (config S0; defaults and resolvers in `src/lib/config/preferences.ts`). */

export const textSizeValidator = v.union(...TEXT_SIZES.map((s) => v.literal(s)));

export const catalogueSortValidator = v.union(...CATALOGUE_SORTS.map((s) => v.literal(s)));

/** The keys of `userUiState`: one row per key and user. */
export const uiStateKeyValidator = v.union(...UI_STATE_KEYS.map((k) => v.literal(k)));

/**
 * A `userUiState` row's value: a switch, a sort order, or token ids (at most `RANGE_RINGS_MAX`, enforced by the writer
 * and `uiStateValueFor`). Which shape fits which key is `uiStateValueFor`'s; a mismatched row reads as the default.
 */
export const uiStateValueValidator = v.union(v.boolean(), catalogueSortValidator, v.array(v.string()));

export const draftKindValidator = v.union(...DRAFT_KINDS.map((k) => v.literal(k)));
