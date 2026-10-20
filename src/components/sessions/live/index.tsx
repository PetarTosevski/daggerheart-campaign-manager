"use client";

import type { LiveCardProps } from "../slots";

/**
 * Live slot (S3 fills it): the board's live card (dot, 'Session in progress' / 'Not running', Start / End with their
 * confirm dialogs and reports, the XC1 switch). Start calls `onStage("play")`, End `onStage("wrap")` (B2). S0 ships
 * the board's idle card without buttons; S3 keeps the export name and props (src/components/sessions/slots.ts).
 */
export function LiveCard(props: LiveCardProps) {
  void props;
  return (
    <section className="ss-card ss-row-card" aria-label="Live session">
      <span aria-hidden="true" className="ss-dot" />
      <div className="ss-grow">
        <strong className="ss-live-title">Not running</strong>
        <span className="ss-muted">Starting and ending sessions comes with the live session (S3).</span>
      </div>
    </section>
  );
}
