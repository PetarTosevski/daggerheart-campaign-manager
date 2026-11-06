"use client";

import { Eye } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { setOwnerViewOpen } from "@/lib/convex-errors";

import { ARCHIVED_BANNER_TEXT } from "./archived-banner";

export const OWNER_VIEW_BANNER_TITLE = "Read-only view";
export const OWNER_VIEW_BANNER_TEXT = "You are not in this campaign. Nothing can be changed here.";

/**
 * The app owner's read-only view of a campaign they are not in (config AU7, Q27 b, N1 changed: they see everything and
 * change nothing). The campaign shell mounts it once, in place of `ConfigMounts`, while `campaigns.get` says
 * `ownerView`, so every campaign page shows it. A small tab hanging from the top centre (`role="status"`), the archived
 * banner's place, so no page's layout moves; an archived campaign adds the archived line here (the archived banner's
 * Restore is the creator's, never the owner's). While mounted, a write that still slips through reads as
 * `OWNER_VIEW_READ_ONLY` (`setOwnerViewOpen`, src/lib/convex-errors.ts).
 */
export function OwnerViewBanner({ archived = false }: { archived?: boolean }): ReactNode {
  // Syncs an external store (the error text module), not React state; nothing is written to the server.
  useEffect(() => {
    setOwnerViewOpen(true);
    return () => setOwnerViewOpen(false);
  }, []);
  return (
    <div
      role="status"
      data-testid="owner-view-banner"
      className="fixed top-0 left-1/2 z-[60] flex max-w-[calc(100vw-16px)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-b-xl border border-t-0 border-[#3d5a63] bg-[#0f1c20]/95 px-4 py-1.5 text-center text-[13px] text-[#cfe3ea] shadow-lg"
    >
      <Eye className="size-4 flex-none" strokeWidth={1.8} aria-hidden="true" />
      <p className="m-0">
        <strong className="font-semibold text-parchment">{OWNER_VIEW_BANNER_TITLE}</strong> · {OWNER_VIEW_BANNER_TEXT}
      </p>
      {archived ? <span className="w-full text-[#f3c9bf]">{ARCHIVED_BANNER_TEXT}</span> : null}
    </div>
  );
}
