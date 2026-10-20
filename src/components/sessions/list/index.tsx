"use client";

import type { Id } from "../../../../convex/_generated/dataModel";
import type { DefaultSessionArgs, NewSessionButtonProps, SessionHeaderLineProps, SessionListProps } from "../slots";

/**
 * List slot (S2 fills it): the header line, '+ New session' and the sessions column. S0 ships these stubs so the page
 * has its layout before any session function exists; S2 keeps the export names and props
 * (src/components/sessions/slots.ts).
 */

/**
 * The session shown when the URL names none: the newest session (GM) or the newest live / played one (player).
 * `undefined` while loading, null for none. Stub: no sessions exist yet.
 */
export function useDefaultSessionId(args: DefaultSessionArgs): Id<"sessions"> | null | undefined {
  void args;
  return null;
}

/** Header line (B1): 'N sessions · M played · Next: <date>'. Stub: the board's line for no sessions. */
export function SessionHeaderLine(props: SessionHeaderLineProps) {
  void props;
  return <>0 sessions · 0 played</>;
}

/** '+ New session' (GM, B1). Stub: the board's primary pill, disabled until S2 adds `create`. */
export function NewSessionButton({ isGm }: NewSessionButtonProps) {
  if (!isGm) return null;
  return (
    <button type="button" className="ss-primary" disabled title="Comes with session records (S2)">
      + New session
    </button>
  );
}

/** Left column (B1): 'SESSION n', status chip, title, date; newest first. Stub: the board's empty state. */
export function SessionList({ isGm }: SessionListProps) {
  return (
    <div className="ss-empty">
      {isGm ? "No sessions yet. Create one to start prepping." : "No sessions played yet."}
    </div>
  );
}
