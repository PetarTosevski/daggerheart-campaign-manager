"use client";

import type { PlayStageProps } from "../slots";

/**
 * Play slot (S5 fills it): the Spotlight, the read-only Session tally (Q3) and the Session log (B4). S0 ships a
 * placeholder card; S5 keeps the export name and props (src/components/sessions/slots.ts) and adds CSS only in a
 * colocated .css in this folder.
 */
export function PlayStage(props: PlayStageProps) {
  void props;
  return (
    <section className="ss-card" aria-label="Play stage">
      <p className="ss-muted ss-m0">The spotlight, the session tally and the session log come with Play (S5).</p>
    </section>
  );
}
