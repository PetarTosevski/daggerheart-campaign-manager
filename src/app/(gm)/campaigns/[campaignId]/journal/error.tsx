"use client";

import "@/components/journal/journal.css";

import { useSessionEndedRedirect } from "@/lib/auth/use-session-ended-redirect";
import { errorMessage } from "@/lib/convex-errors";

/** The Journal page failed to render (CL1): the campaign chrome stays, with the reason and a retry. */
export default function JournalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // A session that ended mid-use goes to sign-in and back instead of this screen (B5, dcm-bxp.131).
  const sessionEnded = useSessionEndedRedirect(error);
  return (
    <div className="jr-root">
      <header className="jr-head">
        <h1 className="jr-title">Journal</h1>
      </header>
      <main className="jr-sessions jr-solo">
        {sessionEnded ? (
          <p role="status">Your session ended – taking you to sign in…</p>
        ) : (
          <div role="alert" className="jr-alert">
            <span>The journal failed to load. {errorMessage(error)}</span>
            <button type="button" className="jr-ghost" onClick={() => retry()}>
              Try again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
