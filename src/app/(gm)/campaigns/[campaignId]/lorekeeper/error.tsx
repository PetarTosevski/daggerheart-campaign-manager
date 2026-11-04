"use client";

import "./lorekeeper.css";

import { BrandButton } from "@/components/brand/buttons";
import { useSessionEndedRedirect } from "@/lib/auth/use-session-ended-redirect";
import { errorMessage } from "@/lib/convex-errors";

/** The Lorekeeper page failed to render (CL1): the campaign chrome stays, with the reason and a retry. */
export default function LorekeeperError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // A session that ended mid-use goes to sign-in and back instead of this screen (B5, dcm-bxp.131).
  const sessionEnded = useSessionEndedRedirect(error);
  return (
    <div className="lk-root">
      <main className="lk-main" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <h1 className="lk-name">The Lorekeeper</h1>
        {sessionEnded ? (
          <p role="status">Your session ended – taking you to sign in…</p>
        ) : (
          <div role="alert" className="lk-alert">
            <span>The Lorekeeper failed to load. {errorMessage(error)}</span>
            <BrandButton variant="neutral" size="sm" onClick={() => retry()}>
              Try again
            </BrandButton>
          </div>
        )}
      </main>
    </div>
  );
}
