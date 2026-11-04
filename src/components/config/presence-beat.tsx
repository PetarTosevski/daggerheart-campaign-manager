"use client";

import type { ReactNode } from "react";

import type { PresenceBeatProps } from "./slots";

/**
 * The presence heartbeat (Online / Away in Campaign settings, Players), mounted once in the campaign shell. Stub:
 * renders nothing until tracer U3p fills it (see ./slots.ts).
 */
export function PresenceBeat(props: PresenceBeatProps): ReactNode {
  void props;
  return null;
}
