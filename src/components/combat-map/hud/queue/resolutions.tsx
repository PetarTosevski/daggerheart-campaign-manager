"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { feedDetail } from "../feed/model";
import { RESOLUTION_SCAN, resolutionRows } from "./model";

/**
 * Resolutions with Undo under the queue (plan combat-hud H5.1; GMDesktop `.gr`): the GM's latest combat rows from
 * `feed.list` — a PC's attack or card, an adversary's attack or feature with its Fear (Momentum, answer 7a) — each with
 * Undo (`actionLog.undo`, which undoes the whole action). Optimistic: the row reads "undone" at once; a refusal such
 * as UNDO_STALE ("something newer happened since") rolls it back and shows under the list.
 */

/** Marks a feed row undone in every loaded page (CL4: never mutate store objects). */
function markUndone(store: OptimisticLocalStore, entryId: Id<"actionLog">) {
  for (const { args, value } of store.getAllQueries(api.feed.list)) {
    if (value === undefined || !value.page.some((r) => r._id === entryId)) continue;
    store.setQuery(api.feed.list, args, { ...value, page: value.page.map((r) => (r._id === entryId ? { ...r, undone: true, canUndo: false } : r)) });
  }
}

const HIT_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M13.5 1.5l-1 3.5-6 6-2-2 6-6zM3.2 9.3l3.5 3.5M2 14l2.4-2.4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
  </svg>
);

export function HudResolutions({ campaignId }: { campaignId: Id<"campaigns"> }): ReactNode {
  const page = useQuery(api.feed.list, { campaignId, paginationOpts: { numItems: RESOLUTION_SCAN, cursor: null } });
  const undo = useMutation(api.actionLog.undo).withOptimisticUpdate((store, { entryId }) => markUndone(store, entryId));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Id<"actionLog"> | null>(null);

  async function run(entryId: Id<"actionLog">) {
    setError(null);
    setPending(entryId);
    try {
      await undo({ entryId, idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  }

  const rows = page === undefined ? [] : resolutionRows(page.page);
  // Not a landmark (the classic column's "Resolutions" region stays the only one; the heading names this list).
  return (
    <div className="hud-res" data-testid="hud-resolutions">
      <h2 className="hud-res-h">Resolutions</h2>
      {page === undefined ? (
        <p role="status" className="hud-q-note">
          Loading resolutions…
        </p>
      ) : rows.length === 0 ? (
        <p className="hud-q-note">No hits yet. Attacks on the map land here with what they did, each with Undo.</p>
      ) : (
        <ul className="hud-res-list" aria-label="Latest resolutions">
          {rows.map((row) => {
            const detail = feedDetail(row);
            return (
              <li key={row._id} className={cn(row.undone && "hud-res-undone")} data-testid="hud-resolution">
                <span className="hud-res-i">{HIT_ICON}</span>
                <span className="hud-res-t">
                  <b>{row.summary}</b>
                  {detail ? <span> {detail}</span> : null}
                </span>
                {row.canUndo ? (
                  <button type="button" className="hud-res-undo" disabled={pending !== null} aria-label={`Undo: ${row.summary}`} onClick={() => void run(row._id)}>
                    Undo
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <p role="alert" className="hud-q-err" data-testid="hud-resolutions-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
