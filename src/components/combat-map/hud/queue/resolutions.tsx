"use client";

import "./queue.css";

import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { RefusalMessage, useRefusal } from "../blocked";
import { feedDetail } from "../feed/model";
import { RESOLUTION_SCAN, fearRollLine, isFearRoll, resolutionRows } from "./model";

/**
 * Resolutions with Undo (plan combat-hud H5.1; GMDesktop `.gr`): since H9.2 behind the dock's Log (the shell's "log"
 * region: right 16, bottom 80, 360 px; tablet right 12, bottom 74, 330 px) and in the GM's phone queue sheet. The GM's
 * latest combat rows from `feed.list` — a PC's attack or card, an adversary's attack or feature with its Fear (Momentum, answer 7a), a player's
 * roll with Fear ("Vex rolled with Fear · +1 Fear", user answer 2026-11-02) — each with Undo (`actionLog.undo`, which undoes the whole action). Optimistic: the row reads "undone" at once; a refusal such
 * as UNDO_STALE ("something newer happened since") rolls it back and shows under the list (H6.3: `useRefusal`, the
 * table's words; a toast-placed refusal goes to the toast host).
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

const FEAR_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.5c2.6 2.2 4.5 4.6 4.5 7.2a4.5 4.5 0 0 1-9 0C3.5 6.1 5.4 3.7 8 1.5z" fill="currentColor" />
  </svg>
);

export function HudResolutions({ campaignId }: { campaignId: Id<"campaigns"> }): ReactNode {
  const page = useQuery(api.feed.list, { campaignId, paginationOpts: { numItems: RESOLUTION_SCAN, cursor: null } });
  const undo = useMutation(api.actionLog.undo).withOptimisticUpdate((store, { entryId }) => markUndone(store, entryId));
  const refusal = useRefusal({ viewer: "gm" });
  const [pending, setPending] = useState<Id<"actionLog"> | null>(null);

  async function run(entryId: Id<"actionLog">) {
    setPending(entryId);
    try {
      await refusal.run(() => undo({ entryId, idempotencyKey: crypto.randomUUID() }));
    } finally {
      setPending(null);
    }
  }

  const rows = page === undefined ? [] : resolutionRows(page.page);
  // Not a landmark (the classic column's "Resolutions" region stays the only one; the heading names this list).
  return (
    <div className="hud-q-res" data-testid="hud-resolutions">
      <h2 className="hud-q-res-h">Resolutions</h2>
      {page === undefined ? (
        <p role="status" className="hud-q-note">
          Loading resolutions…
        </p>
      ) : rows.length === 0 ? (
        <p className="hud-q-note">No hits yet. Attacks on the map and rolls with Fear land here, each with Undo.</p>
      ) : (
        <ul className="hud-q-res-list" aria-label="Latest resolutions">
          {rows.map((row) => {
            const fearRoll = isFearRoll(row) ? fearRollLine(row) : null;
            const title = fearRoll ? fearRoll.lead : row.summary;
            const detail = fearRoll ? [fearRoll.fear, row.undone ? "undone" : null].filter(Boolean).join(" · ") : feedDetail(row);
            return (
              <li key={row._id} className={cn(row.undone && "hud-res-undone", fearRoll && "hud-q-res-fear")} data-testid="hud-resolution" data-kind={fearRoll ? "fear-roll" : row.kind}>
                <span className="hud-q-res-i">{fearRoll ? FEAR_ICON : HIT_ICON}</span>
                <span className="hud-q-res-t" title={fearRoll ? row.summary : undefined}>
                  <b>{title}</b>
                  {detail ? <span> {fearRoll ? `· ${detail}` : detail}</span> : null}
                </span>
                {row.canUndo ? (
                  <button type="button" className="hud-q-res-undo" disabled={pending !== null} aria-label={`Undo: ${title}`} onClick={() => void run(row._id)}>
                    Undo
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {refusal.refusal ? (
        <div data-testid="hud-resolutions-error">
          <RefusalMessage refusal={refusal.refusal} id={refusal.messageId} className="hud-q-inl" />
        </div>
      ) : null}
    </div>
  );
}
