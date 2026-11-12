/**
 * A user's preferences and UI state (plan config S0; the Preferences popover, reference/designs/config/Settings.dc.html).
 * Saved to the account (Q15 b), so they follow the user to every device:
 * - `userPreferences`: one row per user (the popover's switches, the volume, text size).
 * - `userUiState`: one row per key (token names, range circles, sort orders, roll-panel folds), so a flip never
 *   rewrites the preferences row (CD10, rule 6).
 * An unset field or a missing row uses the defaults below, the one source for the server and the UI.
 */

export const TEXT_SIZES = ["small", "medium", "large"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** Mouse and desktop screens (`desktop`), or touch screens (`touch`, `TOUCH_QUERY` in src/lib/zoom-media.mjs). */
export type ScreenInput = "desktop" | "touch";

/**
 * CSS zoom on `<html>` per text size (Q12 a), per kind of screen. Mouse and desktop screens sit on the website's base
 * zoom 0.8 (dcm-1i3z: today's 80% browser zoom is the 100% view); touch screens keep zoom 1 (dcm-jkxa). Medium is the
 * base itself, the zoom every page has with no preference (signed out, /signin); Small and Large are 0.9 and 1.15 of
 * it. globals.css spells out the same numbers (CSS can't import this); tests/unit/prefs-sync.test.tsx checks they
 * agree. The phone app doesn't use it.
 */
export const TEXT_SIZE_ZOOM: Readonly<Record<ScreenInput, Readonly<Record<TextSize, number>>>> = Object.freeze({
  desktop: Object.freeze({ small: 0.72, medium: 0.8, large: 0.92 }),
  touch: Object.freeze({ small: 0.9, medium: 1, large: 1.15 }),
});

export const DICE_VOLUME_MIN = 0;
export const DICE_VOLUME_MAX = 100;

export type Preferences = {
  /** 3D dice. The device's reduced-motion request still turns the animation off (`canAnimate3d`). */
  dice3d: boolean;
  diceSound: boolean;
  /** 0-100. */
  diceVolume: number;
  /** Q13 a: on = calmer even when the device doesn't ask; off = follow the device. */
  reduceMotion: boolean;
  textSize: TextSize;
  /** Q14 a: a chime and a toast when the spotlight moves to a PC the user owns. */
  spotlightPing: boolean;
};

export type StoredPreferences = Partial<Preferences>;
export type PreferenceKey = keyof Preferences;

/** The defaults: today's dice behaviour (3D on, sound off), the board's volume (60) and ping (on). */
export const PREFERENCE_DEFAULTS: Readonly<Preferences> = Object.freeze({
  dice3d: true,
  diceSound: false,
  diceVolume: 60,
  reduceMotion: false,
  textSize: "medium",
  spotlightPing: true,
});

export const PREFERENCE_KEYS = Object.keys(PREFERENCE_DEFAULTS) as PreferenceKey[];

/** A volume clamped to 0-100 and rounded; not a number = the default. */
export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return PREFERENCE_DEFAULTS.diceVolume;
  return Math.min(DICE_VOLUME_MAX, Math.max(DICE_VOLUME_MIN, Math.round(volume)));
}

/** The user's preferences: each stored field, or its default when unset. */
export function resolvePreferences(stored: StoredPreferences | null | undefined): Preferences {
  return {
    dice3d: stored?.dice3d ?? PREFERENCE_DEFAULTS.dice3d,
    diceSound: stored?.diceSound ?? PREFERENCE_DEFAULTS.diceSound,
    diceVolume: stored?.diceVolume === undefined ? PREFERENCE_DEFAULTS.diceVolume : clampVolume(stored.diceVolume),
    reduceMotion: stored?.reduceMotion ?? PREFERENCE_DEFAULTS.reduceMotion,
    textSize: stored?.textSize ?? PREFERENCE_DEFAULTS.textSize,
    spotlightPing: stored?.spotlightPing ?? PREFERENCE_DEFAULTS.spotlightPing,
  };
}

// ------------------------------------------------------------------ UI state (one row per key)

export const CATALOGUE_SORTS = ["name", "book"] as const;
export type CatalogueSortChoice = (typeof CATALOGUE_SORTS)[number];

/** The most tokens whose range circles are remembered (oldest dropped first). */
export const RANGE_RINGS_MAX = 50;

export type UiState = {
  /** The Combat Map's "Names" switch. */
  tokenNames: boolean;
  /** Token ids that show their range circles. */
  rangeRings: string[];
  adversarySort: CatalogueSortChoice;
  environmentSort: CatalogueSortChoice;
  rollFeedCollapsed: boolean;
  gmRollFormCollapsed: boolean;
  freeRollFormOpen: boolean;
};

export type UiStateKey = keyof UiState;

export const UI_STATE_DEFAULTS: Readonly<UiState> = Object.freeze({
  tokenNames: false,
  rangeRings: [],
  adversarySort: "name",
  environmentSort: "name",
  rollFeedCollapsed: false,
  gmRollFormCollapsed: false,
  freeRollFormOpen: false,
});

export const UI_STATE_KEYS = Object.keys(UI_STATE_DEFAULTS) as UiStateKey[];

const BOOLEAN_UI_KEYS = new Set<UiStateKey>(["tokenNames", "rollFeedCollapsed", "gmRollFormCollapsed", "freeRollFormOpen"]);
const SORT_UI_KEYS = new Set<UiStateKey>(["adversarySort", "environmentSort"]);

/** What a `userUiState` row stores as its value. */
export type UiStateValue = boolean | CatalogueSortChoice | string[];

/** Token ids, de-duplicated (last wins), at most `RANGE_RINGS_MAX`, newest kept. */
export function capRangeRings(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (let i = ids.length - 1; i >= 0 && kept.length < RANGE_RINGS_MAX; i--) {
    const id = ids[i];
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }
  return kept.reverse();
}

/** The value if it fits the key (a stored value of another shape is ignored), else undefined. */
export function uiStateValueFor<K extends UiStateKey>(key: K, value: unknown): UiState[K] | undefined {
  if (BOOLEAN_UI_KEYS.has(key)) return (typeof value === "boolean" ? value : undefined) as UiState[K] | undefined;
  if (SORT_UI_KEYS.has(key)) {
    return ((CATALOGUE_SORTS as readonly unknown[]).includes(value) ? value : undefined) as UiState[K] | undefined;
  }
  if (key === "rangeRings") {
    return (Array.isArray(value) && value.every((id) => typeof id === "string") ? capRangeRings(value) : undefined) as
      | UiState[K]
      | undefined;
  }
  return undefined;
}

/** The user's UI state from their rows: each key's stored value when it fits, else the default. */
export function resolveUiState(rows: readonly { key: UiStateKey; value: UiStateValue }[]): UiState {
  const state: UiState = { ...UI_STATE_DEFAULTS, rangeRings: [...UI_STATE_DEFAULTS.rangeRings] };
  for (const row of rows) {
    const value = uiStateValueFor(row.key, row.value);
    if (value !== undefined) (state as Record<UiStateKey, UiStateValue>)[row.key] = value;
  }
  return state;
}

// ------------------------------------------------------------------ drafts

/**
 * The draft kinds: the character wizard (per campaign), the custom frame form (no campaign) and a guided level-up's
 * unconfirmed picks (per character, config N4 b; added 2026-11-04 as a widening, so older rows stay valid).
 */
export const DRAFT_KINDS = ["characterWizard", "customFrame", "levelUp"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** The kinds a browser held before drafts moved to the account (the one-time import); never a level-up draft. */
export const LEGACY_DRAFT_KINDS = ["characterWizard", "customFrame"] as const satisfies readonly DraftKind[];

/** The most bytes a draft's JSON text may hold (UTF-8). */
export const DRAFT_MAX_BYTES = 64 * 1024;

/** The current shape version of each draft's JSON (rule 7). */
export const DRAFT_SCHEMA_VERSION = 1;

/** UTF-8 byte length of a string. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
