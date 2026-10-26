"use client";

import type { CardSlot, CharacterSlot } from "../slots";

import { DeathBadges } from "./badges";
import { DeathBoundary } from "./boundary";
import { DeathMoveSheet } from "./death-move";

export { awayLabel } from "./badges";

// D5 death moves (T4). Contract: ../slots.ts.

/** The death-move modal on the sheet; opens when the last Hit Point is marked. */
export const DeathMoveModal: CharacterSlot = (props) => (
  <DeathBoundary>
    <DeathMoveSheet {...props} />
  </DeathBoundary>
);

/**
 * Unconscious / journey-ends badges, a less-lethal "Requested" badge with the GM's Confirm / Change (LL1) and the
 * GM's "Return to play" in the sheet's banner (the banner shows the away status itself).
 */
export const DeathBannerBadges: CharacterSlot = (props) => (
  <DeathBoundary>
    <DeathBadges {...props} showAway={false} tone="banner" />
  </DeathBoundary>
);

/** Unconscious / away (with "Requested", LL1) / journey-ends badge on the dashboard party card. */
export const DeathCardBadge: CardSlot = (props) => (
  <DeathBoundary>
    <DeathBadges {...props} showAway tone="card" />
  </DeathBoundary>
);
