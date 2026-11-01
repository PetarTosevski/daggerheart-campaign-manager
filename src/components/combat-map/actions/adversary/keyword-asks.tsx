"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * The GM's keyword asks (plan lanes-2, E2.4, dcm-sk4r; user answer 2026-10-31: "Fireproof on an untyped hit: the GM
 * decides whether the hit is fire"): one row per open hit whose keyword the data can't settle on a PC with a keyword
 * guard, "Bandit 2 → Ember: Was this hit fire? (Fireproof)", with Yes and No. Plain on purpose (user 2026-10-31: the
 * combat UI redesign restyles it). Renders nothing while there is no ask.
 */
export function KeywordAsks({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const asks = useQuery(api.hitKeywords.asks, { campaignId });
  const answer = useMutation(api.hitKeywords.answer).withOptimisticUpdate((store, args) => {
    const list = store.getQuery(api.hitKeywords.asks, { campaignId: args.campaignId });
    if (list !== undefined) store.setQuery(api.hitKeywords.asks, { campaignId: args.campaignId }, list.filter((a) => a.requestId !== args.requestId));
  });
  const [error, setError] = useState<string | null>(null);
  if (asks === undefined || (asks.length === 0 && !error)) return null;

  async function send(requestId: Id<"combatRequests">, keyword: "fire", carries: boolean) {
    setError(null);
    try {
      await answer({ campaignId, requestId, answer: { keyword, carries }, idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section className="cm-card cma-card" aria-label="Hit questions" data-testid="keyword-asks">
      <h2 className="cm-h">Hit questions</h2>
      <ul className="cma-res-list">
        {asks.map((a) => (
          <li key={a.requestId} className="cma-note" data-testid="keyword-ask">
            <span>
              {a.attackerLabel}
              {a.feature ? ` (${a.feature})` : ""} → {a.targetName}, {a.damage} damage: {a.question}
            </span>{" "}
            <button type="button" className="cm-btn" onClick={() => void send(a.requestId, a.keyword, true)}>
              Yes, {a.keyword}
            </button>{" "}
            <button type="button" className="cm-btn" onClick={() => void send(a.requestId, a.keyword, false)}>
              No
            </button>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="cma-error">
        {error}
      </p>
    </section>
  );
}
