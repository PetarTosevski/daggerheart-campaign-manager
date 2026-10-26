"use client";

import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ResolutionsProps } from "../../slots";
import { BAND_LABEL } from "../targets";

/**
 * Resolutions (plan combat-actions CA5; U4, Q10, Q1): the GM column's list of the latest combat resolutions (the GM's
 * own `combat` feed rows: damage, severity and HP marked per target), each with Undo, which undoes the whole action
 * (the player's row too) through `actionLog.undo`. Above it, the attacks out of range waiting for the GM's call, with
 * Allow / Decline (`combatRequests.sanction`).
 */

type FeedPage = FunctionReturnType<typeof api.feed.list>;
type FeedRow = FeedPage["page"][number];
type Sanction = Extract<FunctionReturnType<typeof api.combatRequests.mine>[number], { kind: "sanction" }>;

/** Feed rows read for the list (the GM's rows include every roll; combat ones are filtered out of these). */
export const RESOLUTION_SCAN = 40;
/** Resolutions shown. */
export const RESOLUTIONS_SHOWN = 8;

/** The GM's combat resolutions among feed rows, newest first. */
export function resolutionsOf(rows: readonly FeedRow[]): FeedRow[] {
  return rows.filter((r) => r.kind === "combat" && r.visibility === "gm").slice(0, RESOLUTIONS_SHOWN);
}

/** Marks a feed row undone in every loaded page (CL4: never mutate store objects). */
function markUndone(store: OptimisticLocalStore, entryId: Id<"actionLog">) {
  for (const { args, value } of store.getAllQueries(api.feed.list)) {
    if (value === undefined) continue;
    if (!value.page.some((r) => r._id === entryId)) continue;
    store.setQuery(api.feed.list, args, { ...value, page: value.page.map((r) => (r._id === entryId ? { ...r, undone: true, canUndo: false } : r)) });
  }
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/** One resolution with Undo (optimistic: the row shows Undone at once; a refusal such as UNDO_STALE is shown). */
export function ResolutionRow({ row, onUndo, pending }: { row: FeedRow; onUndo: (id: Id<"actionLog">) => void; pending: boolean }) {
  return (
    <li className={row.undone ? "cma-res undone" : "cma-res"} data-testid="combat-resolution">
      <span className="cma-feed-time">{TIME.format(row.at)}</span>
      <span className="cma-res-text">{row.summary}</span>
      {row.undone ? (
        <span className="cm-muted cma-small">Undone</span>
      ) : row.canUndo ? (
        <button type="button" className="cm-btn cm-sm" disabled={pending} aria-label={`Undo: ${row.summary}`} onClick={() => onUndo(row._id)}>
          Undo
        </button>
      ) : null}
    </li>
  );
}

/** GM column, last: sanctions waiting and the latest resolutions. */
export function Resolutions({ campaignId }: ResolutionsProps) {
  return (
    <section className="cm-card cma-card" aria-label="Resolutions">
      <h2 className="cm-h">Resolutions</h2>
      <Sanctions campaignId={campaignId} />
      <ResolutionList campaignId={campaignId} />
    </section>
  );
}

function ResolutionList({ campaignId }: { campaignId: Id<"campaigns"> }) {
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

  if (page === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading resolutions…
      </p>
    );
  }
  const rows = resolutionsOf(page.page);
  return (
    <>
      {rows.length === 0 ? (
        <p className="cm-muted cma-note">No hits yet. Attacks on the map land here with what they did, each with Undo.</p>
      ) : (
        <ul className="cma-res-list" aria-label="Latest resolutions">
          {rows.map((r) => (
            <ResolutionRow key={r._id} row={r} pending={pending !== null} onUndo={(id) => void run(id)} />
          ))}
        </ul>
      )}
      <p aria-live="polite" className="cma-error">
        {error}
      </p>
    </>
  );
}

/** Attacks out of range waiting for the GM (Q1): nothing was rolled; Allow resolves it now, Decline drops it. */
function Sanctions({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const rows = useQuery(api.combatRequests.mine, { campaignId });
  const sanction = useMutation(api.combatRequests.sanction).withOptimisticUpdate((store, { requestId }) => {
    const current = store.getQuery(api.combatRequests.mine, { campaignId });
    if (current !== undefined) store.setQuery(api.combatRequests.mine, { campaignId }, current.filter((r) => r.requestId !== requestId));
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const waiting = (rows ?? []).filter((r): r is Sanction => r.kind === "sanction");
  if (waiting.length === 0 && !error) return null;

  async function answer(requestId: Id<"combatRequests">, approve: boolean) {
    setError(null);
    setPending(true);
    try {
      await sanction({ campaignId, requestId, approve, idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="cma-sanctions">
      <span className="cm-lbl">Out of range: your call</span>
      <ul className="cma-res-list" aria-label="Attacks waiting for you">
        {waiting.map((r) => {
          const bands = new Map<string, string>(r.outOfRange.map((o) => [o.tokenId, BAND_LABEL[o.band]]));
          const text = `${r.characterName} attacks ${r.targets.map((t) => (bands.has(t.tokenId) ? `${t.name} (${bands.get(t.tokenId)})` : t.name)).join(", ")}`;
          return (
            <li key={r.requestId} className="cma-res" data-testid="combat-sanction">
              <span className="cma-res-text">{text}</span>
              <span className="cma-row">
                <button type="button" className="cm-btn cm-sm" disabled={pending} aria-label={`Allow: ${text}`} onClick={() => void answer(r.requestId, true)}>
                  Allow
                </button>
                <button type="button" className="cm-btn cm-sm cm-danger" disabled={pending} aria-label={`Decline: ${text}`} onClick={() => void answer(r.requestId, false)}>
                  Decline
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="cma-error">
        {error}
      </p>
    </div>
  );
}
