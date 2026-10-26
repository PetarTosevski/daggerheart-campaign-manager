"use client";

import "./notes.css";

import { useSessionEndedRedirect } from "@/lib/auth/use-session-ended-redirect";
import { errorMessage } from "@/lib/convex-errors";

/** The Notes page failed to render (CL1): the campaign chrome stays, with the reason and a retry. */
export default function NotesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // A session that ended mid-use goes to sign-in and back instead of this screen (B5, dcm-bxp.131).
  const sessionEnded = useSessionEndedRedirect(error);
  return (
    <div className="bj-root">
      <header className="bj-hero">
        <h1 className="bj-title">Notes</h1>
      </header>
      <main className="bj-main bj-solo">
        {sessionEnded ? (
          <p role="status">Your session ended – taking you to sign in…</p>
        ) : (
          <div role="alert" className="bj-alert">
            <span>The notes failed to load. {errorMessage(error)}</span>
            <button type="button" className="bj-ghost" onClick={() => retry()}>
              Try again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
