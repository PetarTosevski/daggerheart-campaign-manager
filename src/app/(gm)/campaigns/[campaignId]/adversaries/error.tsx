"use client";

import "./adversaries.css";

import { errorMessage } from "@/lib/convex-errors";

/** The Adversaries page failed to render (CL1): the campaign chrome stays, with the reason and a retry. */
export default function AdversariesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="adv-root">
      <main className="adv-main">
        <h1 className="adv-title">Adversaries</h1>
        <div role="alert" className="adv-alert">
          <span>Adversaries failed to load. {errorMessage(error)}</span>
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </div>
      </main>
    </div>
  );
}
