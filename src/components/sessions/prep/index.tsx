"use client";

import type { PrepStageProps } from "../slots";

/**
 * Prep slot (S4 fills it): planned scenes, 'Hooks & loose threads' and the 'Encounter builder' card for the session's
 * D8 encounter (B3, Q1). S0 ships a placeholder card; S4 keeps the export name and props
 * (src/components/sessions/slots.ts) and adds CSS only in a colocated .css in this folder.
 */
export function PrepStage(props: PrepStageProps) {
  void props;
  return (
    <section className="ss-card" aria-label="Prep stage">
      <p className="ss-muted ss-m0">Planned scenes, hooks and the session encounter come with Prep (S4).</p>
    </section>
  );
}
