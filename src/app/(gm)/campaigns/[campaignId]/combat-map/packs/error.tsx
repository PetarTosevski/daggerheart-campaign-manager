"use client";

import "../combat-map.css";

import { useSessionEndedRedirect } from "@/lib/auth/use-session-ended-redirect";
import { errorMessage } from "@/lib/convex-errors";

/** The sprite packs page failed to render (CL1): the campaign chrome stays, with the reason and a retry. */
export default function SpritePacksError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // A session that ended mid-use goes to sign-in and back instead of this screen (B5, dcm-bxp.131).
  const sessionEnded = useSessionEndedRedirect(error);
  return (
    <div className="cm-root">
      <main className="cm-main cm-solo">
        <h1 className="cm-title">Sprite packs</h1>
        {sessionEnded ? (
          <p role="status">Your session ended – taking you to sign in…</p>
        ) : (
          <div role="alert" className="cm-alert">
            <span>The sprite packs failed to load. {errorMessage(error)}</span>
            <button type="button" className="cm-btn cm-sm" onClick={() => retry()}>
              Try again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
