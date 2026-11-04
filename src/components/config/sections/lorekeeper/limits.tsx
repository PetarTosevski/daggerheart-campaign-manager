"use client";

import type { ReactNode } from "react";

import type { SettingsSectionProps } from "../../slots";

/**
 * Ask for higher Lorekeeper limits (config Q21 changed, N10): an empty slot at the end of the section. Tracer AU3 fills
 * it (after AD12's server); until then it renders nothing.
 */
export function LorekeeperLimits(props: SettingsSectionProps): ReactNode {
  void props;
  return null;
}
