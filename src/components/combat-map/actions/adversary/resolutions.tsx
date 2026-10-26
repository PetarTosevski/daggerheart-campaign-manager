"use client";

import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ResolutionsProps } from "../../slots";
import { RESOLUTION_SCAN, RESOLUTIONS_SHOWN, ResolutionRow } from "../gm";
import { adversaryResolutionsOf } from "./model";

/** Marks a feed row undone in every loaded page (CL4: never mutate store objects). */
function markUndone(store: OptimisticLocalStore, entryId: Id<"actionLog">) {
  for (const { args, value } of store.getAllQueries(api.feed.list)) {
    if (value === undefined || !value.page.some((r) => r._id === entryId)) continue;
    store.setQuery(api.feed.list, args, { ...value, page: value.page.map((r) => (r._id === entryId ? { ...r, undone: true, canUndo: false } : r)) });
  }
}

/**
 * GM column, in Resolutions (plan combat-actions AA5; U4 "Damage applies automatically; the GM can undo it"): the
 * latest adversary actions from either page, as the GM's rows have them (roll, hit or miss, damage, severity and marks),
 * each with Undo, which undoes the whole action (PCs' sheets, the adversaries, the Fear; an open hit is called off).
 * Renders nothing until an adversary has acted.
 */
export function AdversaryResolutions({ campaignId, role }: ResolutionsProps) {
  const page = useQuery(api.feed.list, role === "gm" ? { campaignId, paginationOpts: { numItems: RESOLUTION_SCAN, cursor: null } } : "skip");
  const undo = useMutation(api.actionLog.undo).withOptimisticUpdate((store, { entryId }) => markUndone(store, entryId));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (page === undefined) return null;
  const rows = adversaryResolutionsOf(page.page, RESOLUTIONS_SHOWN);
  if (rows.length === 0 && !error) return null;

  async function run(entryId: Id<"actionLog">) {
    setError(null);
    setPending(true);
    try {
      await undo({ entryId, idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="cm-card cma-card" aria-label="Adversary resolutions">
      <h2 className="cm-h">Adversary actions</h2>
      <ul className="cma-res-list" aria-label="Latest adversary actions">
        {rows.map((r) => (
          <ResolutionRow key={r._id} row={r} pending={pending} onUndo={(id) => void run(id)} />
        ))}
      </ul>
      <p aria-live="polite" className="cma-error">
        {error}
      </p>
    </section>
  );
}
