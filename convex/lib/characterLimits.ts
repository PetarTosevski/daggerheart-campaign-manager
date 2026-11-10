/**
 * The campaign character bounds, in a leaf module with no imports (2026-11-10): `./sessions` reads them while it loads,
 * and `./characterSheet` (which re-exports them) sits in an import loop with `./ruleModes` → `./sessions`, so a value
 * read from it at load time could still be undefined.
 */

/**
 * The creation cap (review M5, dcm-bxp.38): `characters.create` refuses a campaign's next character at this many. It stays
 * 50 as an abuse bound (config Q19 a); the per-player cap the owner sets in App admin (AD5b) is the everyday limit.
 * Never above `CHARACTER_READ_BOUND`.
 */
export const MAX_CHARACTERS_CREATED_PER_CAMPAIGN = 50;

/**
 * The read bound (dcm-bxp.38): how many of a campaign's characters every bounded party read takes (`partyOf`, rests,
 * sessions, combat scenes, card hands, combat reveals). It stays 50 when the creation cap drops, so a campaign that
 * holds more characters than a lowered cap (made before it dropped) is still read whole.
 */
export const CHARACTER_READ_BOUND = 50;

/** The read bound under its old name (dcm-bxp.38): the party reads outside convex/characters.ts import it. */
export const MAX_CHARACTERS_PER_CAMPAIGN = CHARACTER_READ_BOUND;
