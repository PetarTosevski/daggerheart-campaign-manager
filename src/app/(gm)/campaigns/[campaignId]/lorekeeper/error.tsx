"use client";

import "./lorekeeper.css";

import { errorMessage } from "@/lib/convex-errors";

/** The Lorekeeper page failed to render (CL1): the campaign chrome stays, with the reason and a retry. */
export default function LorekeeperError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="lk-root">
      <main className="lk-main" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <h1 className="lk-name">The Lorekeeper</h1>
        <div role="alert" className="lk-alert">
          <span>The Lorekeeper failed to load. {errorMessage(error)}</span>
          <button type="button" className="lk-act lk-act-dark" onClick={() => retry()}>
            Try again
          </button>
        </div>
      </main>
    </div>
  );
}
