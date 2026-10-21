"use client";

import type { ActionsLayerProps, AdversaryPanelProps } from "../../slots";

/**
 * Adversary controls on the map (plan combat-actions; CA0 stub, AA5 fills it): Attack and feature buttons for the
 * selected adversary token with the Fear prompts (Q12, Q16, Q19), and the hit flashes on target tokens (a map layer of
 * its own). Both render nothing yet.
 */
export function AdversaryPanel(props: AdversaryPanelProps) {
  void props;
  return null;
}

export function HitFlashLayer(props: ActionsLayerProps) {
  void props;
  return null;
}
