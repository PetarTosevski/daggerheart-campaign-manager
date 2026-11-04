"use client";

import type { ReactNode } from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";

export type PresenceSlotProps = { campaignId: Id<"campaigns">; userId: Id<"users"> };

/**
 * A member row's Online / Away mark (design `.on` / `.on.off`). Stub: tracer U3p fills it once `@convex-dev/presence`
 * is approved (Q11 b, N5); keep the name and props. Renders nothing until then.
 */
export function PresenceSlot(props: PresenceSlotProps): ReactNode {
  void props;
  return null;
}
