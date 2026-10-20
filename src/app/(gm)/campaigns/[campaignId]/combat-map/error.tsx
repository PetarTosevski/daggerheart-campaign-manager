"use client";

import "./combat-map.css";

import { errorMessage } from "@/lib/convex-errors";

/** The Combat Map page failed to render (CL1): the campaign chrome stays, with the reason and a retry. */
export default function CombatMapError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="cm-root">
      <main className="cm-main cm-solo">
        <h1 className="cm-title">Combat Map</h1>
        <div role="alert" className="cm-alert">
          <span>The combat map failed to load. {errorMessage(error)}</span>
          <button type="button" className="cm-btn cm-sm" onClick={() => retry()}>
            Try again
          </button>
        </div>
      </main>
    </div>
  );
}
