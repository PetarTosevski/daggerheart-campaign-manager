"use client";

import type { ReactNode } from "react";

import type { SpotlightPingProps } from "./slots";

/**
 * 'Ping me when I get the spotlight' (chime + toast, Q14 a), mounted once in the campaign shell. Stub: renders nothing
 * until tracer U6d fills it (see ./slots.ts).
 */
export function SpotlightPing(props: SpotlightPingProps): ReactNode {
  void props;
  return null;
}
