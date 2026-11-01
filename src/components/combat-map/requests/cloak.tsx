"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * The GM's "Does <name>'s Cloaked end?" (plan lanes-2 wave 10, E1.4a; dcm-vx5n; user 2026-10-31; CB p.42, CB p.99): a
 * Cloaked PC made an action roll that targets an enemy but is not an attack. Yes ends Cloaked (in the use's undo group),
 * No keeps it (`cloakPrompts.answer`). Rows come from `cloakPrompts.pending`; an optimistic update drops the answered
 * row at once. Plain buttons for now (the combat UI redesign, dcm-bxp.99.32, restyles it).
 */

export type CloakPromptRow = FunctionReturnType<typeof api.cloakPrompts.pending>[number];

/** "Does Ash's Cloaked end? (Words of Discord on Bear)". */
export function cloakPromptText(row: Pick<CloakPromptRow, "characterName" | "label" | "targets">): string {
  const on = row.targets.map((t) => t.name).join(", ");
  return `Does ${row.characterName}'s Cloaked end? (${row.label}${on ? ` on ${on}` : ""})`;
}

/** The result line of an answer. */
export function cloakAnswerLine(out: FunctionReturnType<typeof api.cloakPrompts.answer>, name: string): string {
  if (out.status === "ended") return `${name} is no longer Cloaked.`;
  if (out.status === "declined") return `${name} stays Cloaked.`;
  return "The use no longer stands: nothing changed.";
}

/** The GM's list of open Cloaked prompts; nothing while loading or when none waits. */
export function CloakPrompts({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const rows = useQuery(api.cloakPrompts.pending, { campaignId });
  const answer = useMutation(api.cloakPrompts.answer).withOptimisticUpdate((store, { requestId }) => {
    const current = store.getQuery(api.cloakPrompts.pending, { campaignId });
    if (current !== undefined) store.setQuery(api.cloakPrompts.pending, { campaignId }, current.filter((r) => r.requestId !== requestId));
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const waiting = rows ?? [];
  if (waiting.length === 0 && !error && !result) return null;

  async function send(row: CloakPromptRow, ends: boolean) {
    setError(null);
    setResult(null);
    setPending(true);
    try {
      setResult(cloakAnswerLine(await answer({ campaignId, requestId: row.requestId, ends, idempotencyKey: crypto.randomUUID() }), row.characterName));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="dfr" data-testid="cloak-prompts">
      <span className="cm-lbl">Cloaked?</span>
      {waiting.length > 0 ? (
        <ul className="dfr-list" aria-label="Cloaked prompts">
          {waiting.map((r) => {
            const text = cloakPromptText(r);
            return (
              <li key={r.requestId} className="dfr-row" data-testid="cloak-prompt">
                <span className="dfr-text">{text}</span>
                <span className="dfr-actions">
                  <button type="button" className="cm-btn cm-sm" disabled={pending} aria-label={`Yes, Cloaked ends: ${text}`} onClick={() => void send(r, true)}>
                    Yes, it ends
                  </button>
                  <button type="button" className="cm-btn cm-sm" disabled={pending} aria-label={`No, stays Cloaked: ${text}`} onClick={() => void send(r, false)}>
                    No
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {result ? (
        <p role="status" className="dfr-result">
          {result}
        </p>
      ) : null}
      <p aria-live="polite" className="sd-error">
        {error}
      </p>
    </div>
  );
}
