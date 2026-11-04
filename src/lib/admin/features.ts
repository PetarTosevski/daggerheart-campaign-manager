import type { FeatureMode } from "./config";

/**
 * Feature switches (config AD9, Q25 b): every row of the Admin board's Feature switches tab except the dropped
 * "New combat HUD" (it cut over in wave 9). Shared by the server (`convex/lib/features.ts`, `convex/features.ts`) and
 * the admin page (AU4). The order is the board's.
 *
 * A feature with no saved switch is on for everyone (`DEFAULT_FEATURE_MODE`), so nothing that ships today disappears
 * when switches land. Turning a feature off never deletes data.
 */
export const FEATURE_KEYS = ["journal", "dice3d", "phoneLayout", "lorekeeperWeb", "spriteTokens", "shareLinks"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** No saved switch = everyone (what ships today stays on). */
export const DEFAULT_FEATURE_MODE: FeatureMode = "everyone";

export type FeatureInfo = {
  key: FeatureKey;
  /** The row's name on the board. */
  name: string;
  /** The board's description line. */
  description: string;
  /**
   * N2 (a): the switch is saved and remembered but does nothing yet; the feature is always on for everyone. The
   * admin row shows `note` instead of pretending the choice takes effect.
   */
  inert: boolean;
  /** Shown under an inert row. */
  note?: string;
};

export const FEATURES: readonly FeatureInfo[] = [
  {
    key: "journal",
    name: "Journal",
    description: "Sessions and Notes as one tab. Replaces the old Sessions page.",
    inert: true,
    note: "Always on for now: the old Sessions and Notes pages are gone.",
  },
  { key: "dice3d", name: "3D dice", description: "Players can still turn them off in Preferences.", inert: false },
  { key: "phoneLayout", name: "Phone layout", description: "The Combat Map on screens under 600 px wide.", inert: false },
  { key: "lorekeeperWeb", name: "Lorekeeper internet search", description: "GMs still choose per campaign.", inert: false },
  { key: "spriteTokens", name: "Sprite tokens", description: "Animated character sprites instead of portraits.", inert: false },
  {
    key: "shareLinks",
    name: "Share links",
    description: "Read-only links to a session recap for people without an account.",
    inert: true,
    note: "Not built yet.",
  },
];

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function featureInfo(key: FeatureKey): FeatureInfo {
  return FEATURES.find((f) => f.key === key)!;
}

/** Which features are on for one caller. */
export type FeatureFlags = Record<FeatureKey, boolean>;

/** Who the caller is, as far as a switch cares. */
export type FeatureAudience = { isOwner: boolean; isTester: boolean };

/**
 * Whether a switch in `mode` turns its feature on for `who`. Off = nobody (the owner included); Only me = the app
 * owner; Testers = the testers and the owner (the owner tries a feature first, then testers, then everyone);
 * Everyone = everyone, signed out included.
 */
export function modeAllows(mode: FeatureMode, who: FeatureAudience): boolean {
  switch (mode) {
    case "off":
      return false;
    case "owner":
      return who.isOwner;
    case "testers":
      return who.isOwner || who.isTester;
    case "everyone":
      return true;
  }
}
