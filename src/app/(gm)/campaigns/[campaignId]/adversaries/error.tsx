"use client";

import "./adversaries.css";

import { useSessionEndedRedirect } from "@/lib/auth/use-session-ended-redirect";
import { errorMessage } from "@/lib/convex-errors";

/** The Adversaries page failed to render (CL1): the campaign chrome stays, with the reason and a retry. */
export default function AdversariesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // A session that ended mid-use goes to sign-in and back instead of this screen (B5, dcm-bxp.131).
  const sessionEnded = useSessionEndedRedirect(error);
  return (
    <div className="adv-root">
      <main className="adv-main">
        <h1 className="adv-title">Adversaries</h1>
        {sessionEnded ? (
          <p role="status">Your session ended – taking you to sign in…</p>
        ) : (
          <div role="alert" className="adv-alert">
            <span>Adversaries failed to load. {errorMessage(error)}</span>
            <button type="button" onClick={() => retry()}>
              Try again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
