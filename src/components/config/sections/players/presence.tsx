"use client";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export type PresenceSlotProps = { campaignId: Id<"campaigns">; userId: Id<"users"> };

/** Design `.on` / `.on.off` (reference/designs/config/Settings.dc.html); players.css is not this tracer's. */
const ONLINE_STYLE = { flex: "none", marginLeft: 6, fontSize: 12, color: "#9ff0bd" } as const;
const AWAY_STYLE = { ...ONLINE_STYLE, color: "#7d8f96" } as const;

/**
 * A member row's Online / Away mark (config U3p, Q11 b) from `presence.list` (GM and co-GMs only; the Players section
 * is GM only). Every row reads the same subscription, which Convex shares. A member with no presence row (never opened
 * the campaign) is Away. Nothing while the list loads.
 */
export function PresenceSlot({ campaignId, userId }: PresenceSlotProps): ReactNode {
  const list = useQuery(api.presence.list, { campaignId });
  if (list === undefined) return null;
  const online = list.some((row) => row.userId === userId && row.online);
  return (
    <span style={online ? ONLINE_STYLE : AWAY_STYLE} data-presence={online ? "online" : "away"}>
      {online ? "Online" : "Away"}
    </span>
  );
}
