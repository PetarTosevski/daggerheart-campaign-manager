"use client";

import "./sessions.css";

import { errorMessage } from "@/lib/convex-errors";

/** The Sessions page failed to render (CL1): the campaign chrome stays, with the reason and a retry. */
export default function SessionsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="ss-root">
      <header className="ss-head">
        <h1 className="ss-title">Sessions</h1>
      </header>
      <main className="ss-main ss-solo">
        <div role="alert" className="ss-alert">
          <span>The sessions failed to load. {errorMessage(error)}</span>
          <button type="button" className="ss-ghost" onClick={() => retry()}>
            Try again
          </button>
        </div>
      </main>
    </div>
  );
}
