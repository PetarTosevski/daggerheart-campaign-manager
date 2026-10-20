"use client";

import type { WrapStageProps } from "../slots";

/**
 * Wrap-up slot (S6 fills it): Recap, 'Loot & gold', 'Countdowns & threads' and the milestone row (B5, Q5). S0 ships a
 * placeholder card; S6 keeps the export name and props (src/components/sessions/slots.ts) and adds CSS only in a
 * colocated .css in this folder.
 */
export function WrapStage(props: WrapStageProps) {
  void props;
  return (
    <section className="ss-card" aria-label="Wrap-up stage">
      <p className="ss-muted ss-m0">The recap, loot, threads and the milestone come with Wrap-up (S6).</p>
    </section>
  );
}
