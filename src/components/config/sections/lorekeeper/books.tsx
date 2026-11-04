"use client";

import type { ReactNode } from "react";

import type { SettingsSectionProps } from "../../slots";

/**
 * The GM's own campaign books (PDF uploads, config Q24 b): an empty slot under 'Sources it may search'. Tracer AU8
 * fills it (after LB1's server); until then it renders nothing.
 */
export function LorekeeperCampaignBooks(props: SettingsSectionProps): ReactNode {
  void props;
  return null;
}
