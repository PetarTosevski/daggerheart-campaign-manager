/**
 * Feature ids and the sheet keys built from them (plan sheet-drawer, SD0; analysis section 5.1). Pure.
 *
 * - A feature id is `<source>:<owner>:<slug>`: `subclass:stalwart:iron-will`, `ancestry:dwarf:thick-skin`,
 *   `class:bard:rally`, `beastform:agile-scout:fragile`, `transformation:vampire:feed`, `stance:martial-artist:quick`.
 *   A class has one Hope feature, so its id has no slug: `hope:guardian`.
 * - Limits are stored in the sheet's `featureUses` under `feat:<featureId>` (or `feat:<featureId>:<useId>` for a limit on
 *   one use), and tokens in `cardTokens` under `feat:<featureId>` (the card runner's keys are `card:<cardId>[:<useId>]`).
 *   D5's own keys (`rally`, `unstoppable`, `channelRawPower`, `commune`, …) stay as they are (analysis section 7).
 * - `cardTokens` ids hold at most 60 characters and `featureUses` keys 80 (src/lib/validation/characters.ts), so every
 *   `feat:<featureId>` fits in 60 (tests/unit/feature-classification.test.ts checks the longest).
 */

import { FEATURE_SOURCES, type FeatureSource } from "./types";

/** The most characters of a `cardTokens` id (`cardTokensSchema`); every `feat:<featureId>` key fits in it. */
export const FEATURE_TOKEN_KEY_MAX = 60;
/** The most characters of a `featureUses` key (`featureUseSchema`); `feat:<featureId>:<useId>` must fit in it. */
export const FEATURE_USE_KEY_MAX = 80;

/** The prefix of every feature key in `featureUses` and `cardTokens`. */
export const FEATURE_KEY_PREFIX = "feat:";

/** The slug of a printed name: lower case, apostrophes dropped, every other run of non-letters a hyphen ("Ranger’s Focus" → "rangers-focus"). */
export function featureSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A feature's id. `hope` features take only the class id (`hope:<classId>`); every other source needs the feature's name. */
export function featureId(source: FeatureSource, owner: string, name?: string): string {
  if (source === "hope") return `hope:${owner}`;
  if (name === undefined || featureSlug(name) === "") throw new Error(`A ${source} feature of ${owner} needs a name.`);
  return `${source}:${owner}:${featureSlug(name)}`;
}

/** The id of a Beastform's attack entry (Q10, CB p.30: "use the trait specified in their statistics for your attack"). */
export function beastformAttackId(formId: string): string {
  return `beastform:${formId}:attack`;
}

const isSource = (s: string | undefined): s is FeatureSource => s !== undefined && (FEATURE_SOURCES as readonly string[]).includes(s);

/** The parts of a feature id, or null for a string that is not one. */
export function parseFeatureId(id: string): { source: FeatureSource; owner: string; slug: string | null } | null {
  const [source, owner, slug, ...rest] = id.split(":");
  if (rest.length > 0 || !owner || !isSource(source)) return null;
  if (source === "hope") return slug === undefined ? { source, owner, slug: null } : null;
  return slug ? { source, owner, slug } : null;
}

/**
 * The `featureUses` key of a feature (or of one of its uses) and its `cardTokens` id (no `useId`): `feat:<featureId>[:<useId>]`.
 * Throws when the key would not fit the sheet's caps: a feature id over `FEATURE_TOKEN_KEY_MAX` with its prefix, or a
 * use key over `FEATURE_USE_KEY_MAX`.
 */
export function featureKey(featureIdValue: string, useId?: string): string {
  const base = `${FEATURE_KEY_PREFIX}${featureIdValue}`;
  if (base.length > FEATURE_TOKEN_KEY_MAX) throw new Error(`Feature key ${base} is longer than ${FEATURE_TOKEN_KEY_MAX} characters.`);
  const key = useId === undefined ? base : `${base}:${useId}`;
  if (key.length > FEATURE_USE_KEY_MAX) throw new Error(`Feature use key ${key} is longer than ${FEATURE_USE_KEY_MAX} characters.`);
  return key;
}

/** Whether a `featureUses` key or `cardTokens` id belongs to a feature (not a card or a D5 key). */
export function isFeatureKey(key: string): boolean {
  return key.startsWith(FEATURE_KEY_PREFIX);
}
