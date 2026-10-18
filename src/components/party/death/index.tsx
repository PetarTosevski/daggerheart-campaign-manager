"use client";

import type { CharacterSlot } from "../slots";

import { DeathBadges } from "./badges";
import { DeathBoundary } from "./boundary";
import { DeathMoveSheet } from "./death-move";

// D5 death moves (T4). Contract: ../slots.ts.

/** The death-move modal on the sheet; opens when the last Hit Point is marked. Also the unconscious and journey-ends badges. */
export const DeathMoveModal: CharacterSlot = (props) => (
  <DeathBoundary>
    <DeathMoveSheet {...props} />
  </DeathBoundary>
);

/** Unconscious / away / journey-ends badge on the dashboard party card. */
export const DeathCardBadge: CharacterSlot = (props) => <DeathBadges {...props} showAway tone="card" />;
