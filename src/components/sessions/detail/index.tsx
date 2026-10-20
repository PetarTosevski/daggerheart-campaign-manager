"use client";

import type { NoSessionSelectedProps, PlayerSessionViewProps, SessionHeaderCardProps } from "../slots";

/**
 * Detail slot (S2 fills it): the GM's session header card, the player's read-only view and the empty detail column.
 * S0 ships stubs; S2 keeps the export names and props (src/components/sessions/slots.ts).
 */

/** GM: title, date, 'Mark as played' / 'Mark as not played', Delete (B1). Stub: an empty card. */
export function SessionHeaderCard(props: SessionHeaderCardProps) {
  void props;
  return (
    <section className="ss-card" aria-label="Session">
      <p className="ss-muted ss-m0">Session details come with session records (S2).</p>
    </section>
  );
}

/** Player: the selected live or played session read-only, with its recap (Q4). Stub: an empty card. */
export function PlayerSessionView(props: PlayerSessionViewProps) {
  void props;
  return (
    <section className="ss-card" aria-label="Session">
      <p className="ss-muted ss-m0">The session&apos;s recap appears here.</p>
    </section>
  );
}

/** Nothing selected (board copy for the GM; players only read recaps). */
export function NoSessionSelected({ isGm }: NoSessionSelectedProps) {
  return (
    <section className="ss-card ss-start" aria-labelledby="ss-none-h">
      <h2 id="ss-none-h" className="ss-h">
        No session selected
      </h2>
      <p className="ss-muted ss-m0">
        {isGm
          ? "Pick a session on the left, or create a new one. Each session has three stages: Prep before you play, Play while at the table, and Wrap-up afterwards. The recap you write in Wrap-up appears on the dashboard."
          : "Pick a session on the left to read its recap."}
      </p>
    </section>
  );
}
