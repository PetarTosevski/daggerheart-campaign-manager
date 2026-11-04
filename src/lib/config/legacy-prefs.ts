import {
  CATALOGUE_SORTS,
  DRAFT_MAX_BYTES,
  capRangeRings,
  utf8Bytes,
  type CatalogueSortChoice,
  type StoredPreferences,
  type UiState,
} from "./preferences";

/**
 * Every value the app saved in the browser before preferences moved to the account (config Q15 b), parsed into what
 * the account stores. Pure: the import (tracer IMP) writes the result and then removes `keys` and `dead`.
 *
 * Not preferences, so never read or listed here: Convex Auth's own `__convexAuth*` keys and the level-up draft in
 * sessionStorage (`dcm:level-up-draft:*`, N4 a).
 *
 * Bad JSON, a value of the wrong shape, blocked storage (every call throws) and keys the app never wrote all give
 * nothing.
 */

/** The browser storage methods the parser uses (`window.localStorage` fits). */
export type StorageLike = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
};

export const LEGACY_KEYS = {
  dice: "dcm.dice.settings",
  handHiddenPrefix: "dh.combat.handHidden:",
  names: "dh.combat.names",
  rings: "dh.combat.rings",
  adversarySort: "dcm:adversary-sort",
  environmentSort: "dcm:environment-sort",
  rollFeedCollapsed: "dcm:roll-feed-collapsed",
  gmRollFormCollapsed: "dcm:gm-roll-form-collapsed",
  freeRollFormOpen: "dcm:free-roll-form-open",
  wizardPrefix: "dh.characterWizard.",
  customDraft: "dh.customDraft",
} as const;

/** Keys nothing reads any more; the import deletes them. `dcm:combat-hud` went with the HUD cut-over (H8.1). */
export const DEAD_KEYS = ["dcm:combat-hud"] as const;

export type LegacyDraft =
  | { kind: "characterWizard"; campaignId: string; data: string }
  | { kind: "customFrame"; data: string };

export type LegacyPrefs = {
  /** 3D dice and dice sound from `dcm.dice.settings`. */
  preferences: Pick<StoredPreferences, "dice3d" | "diceSound">;
  /** Each UI-state key the browser held a valid value for. */
  uiState: Partial<UiState>;
  /** Folded hands ("Hide cards" on); an unfolded one is the default and gives no row. */
  handFolds: { campaignId: string; characterId: string }[];
  /** Unsent drafts: JSON text of an object, at most `DRAFT_MAX_BYTES`. */
  drafts: LegacyDraft[];
  /** Every app key found (valid or not), to remove once imported. */
  keys: string[];
  /** Dead keys found, to remove. */
  dead: string[];
};

function emptyPrefs(): LegacyPrefs {
  return { preferences: {}, uiState: {}, handFolds: [], drafts: [], keys: [], dead: [] };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** "1" / "0", as the app's on/off flags were written. */
function flag(raw: string): boolean | undefined {
  return raw === "1" ? true : raw === "0" ? false : undefined;
}

function sort(raw: string): CatalogueSortChoice | undefined {
  return (CATALOGUE_SORTS as readonly string[]).includes(raw) ? (raw as CatalogueSortChoice) : undefined;
}

/** An id segment of a key: non-empty, no separator, no spaces. */
function idPart(text: string): string | undefined {
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : undefined;
}

/** A draft's JSON text, when it is an object and fits the size cap. */
function draftData(raw: string): string | undefined {
  const value = parseJson(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const text = JSON.stringify(value);
  return utf8Bytes(text) <= DRAFT_MAX_BYTES ? text : undefined;
}

const FLAG_KEYS: [string, "tokenNames" | "rollFeedCollapsed" | "gmRollFormCollapsed" | "freeRollFormOpen"][] = [
  [LEGACY_KEYS.names, "tokenNames"],
  [LEGACY_KEYS.rollFeedCollapsed, "rollFeedCollapsed"],
  [LEGACY_KEYS.gmRollFormCollapsed, "gmRollFormCollapsed"],
  [LEGACY_KEYS.freeRollFormOpen, "freeRollFormOpen"],
];

/** Parses one key's value into `out`; returns whether the key is one the app wrote. */
function readKey(key: string, raw: string, out: LegacyPrefs): boolean {
  if (key === LEGACY_KEYS.dice) {
    const value = parseJson(raw);
    if (typeof value === "object" && value !== null) {
      const { threeD, sound } = value as { threeD?: unknown; sound?: unknown };
      if (typeof threeD === "boolean") out.preferences.dice3d = threeD;
      if (typeof sound === "boolean") out.preferences.diceSound = sound;
    }
    return true;
  }
  for (const [legacy, uiKey] of FLAG_KEYS) {
    if (key !== legacy) continue;
    const on = flag(raw);
    if (on !== undefined) out.uiState[uiKey] = on;
    return true;
  }
  if (key === LEGACY_KEYS.rings) {
    const value = parseJson(raw);
    if (Array.isArray(value)) out.uiState.rangeRings = capRangeRings(value.filter((id): id is string => typeof id === "string"));
    return true;
  }
  if (key === LEGACY_KEYS.adversarySort || key === LEGACY_KEYS.environmentSort) {
    const value = sort(raw);
    if (value !== undefined) out.uiState[key === LEGACY_KEYS.adversarySort ? "adversarySort" : "environmentSort"] = value;
    return true;
  }
  if (key.startsWith(LEGACY_KEYS.handHiddenPrefix)) {
    const [campaign, character, ...rest] = key.slice(LEGACY_KEYS.handHiddenPrefix.length).split(":");
    const campaignId = idPart(campaign ?? "");
    const characterId = idPart(character ?? "");
    if (campaignId === undefined || characterId === undefined || rest.length > 0) return false;
    if (flag(raw) === true) out.handFolds.push({ campaignId, characterId });
    return true;
  }
  if (key.startsWith(LEGACY_KEYS.wizardPrefix)) {
    const campaignId = idPart(key.slice(LEGACY_KEYS.wizardPrefix.length));
    if (campaignId === undefined) return false;
    const data = draftData(raw);
    if (data !== undefined) out.drafts.push({ kind: "characterWizard", campaignId, data });
    return true;
  }
  if (key === LEGACY_KEYS.customDraft) {
    const data = draftData(raw);
    if (data !== undefined) out.drafts.push({ kind: "customFrame", data });
    return true;
  }
  return false;
}

/** Every browser-saved preference in `storage` (see the module comment). Never throws. */
export function readLegacyPrefs(storage: StorageLike | null | undefined): LegacyPrefs {
  const out = emptyPrefs();
  if (!storage) return out;
  let names: string[];
  try {
    names = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) names.push(key);
    }
  } catch {
    return emptyPrefs();
  }
  for (const key of names.sort()) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      continue;
    }
    if (raw === null) continue;
    if ((DEAD_KEYS as readonly string[]).includes(key)) {
      out.dead.push(key);
      continue;
    }
    if (readKey(key, raw, out)) out.keys.push(key);
  }
  return out;
}
