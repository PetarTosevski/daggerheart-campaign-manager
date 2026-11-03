import type { FunctionReturnType } from "convex/server";

import { api } from "../../convex";

export type CombatMapLayout = NonNullable<FunctionReturnType<typeof api.combatMaps.live>>;
export type CombatPlayerView = FunctionReturnType<typeof api.combatVision.playerView>;

/** Props for a combat map slot. Play, GM tools and edit each replace their stub. */
export type CombatSlotProps = {
  campaignId: string;
  isGm: boolean;
  layout: CombatMapLayout;
  view: CombatPlayerView;
};

export const COMBAT_SLOT_IDS = ["play", "gm", "edit"] as const;
export type CombatSlotId = (typeof COMBAT_SLOT_IDS)[number];
