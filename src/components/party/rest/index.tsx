"use client";

import type { CampaignSlot, CharacterSlot } from "../slots";
import { RestBoundary } from "./boundary";
import { Launcher } from "./launcher";
import { Picker } from "./picker";

// D5 party rests (T3, CB 105-106; decision 10). Contract: ../slots.ts.

/** The downtime-move picker on the sheet (page one), shown while a rest is open. */
export const RestPicker: CharacterSlot = (props) => (
  <RestBoundary>
    <Picker {...props} />
  </RestBoundary>
);

/** The GM's rest launcher on the dashboard; players see the open rest. */
export const RestLauncher: CampaignSlot = (props) => (
  <RestBoundary>
    <Launcher {...props} />
  </RestBoundary>
);
