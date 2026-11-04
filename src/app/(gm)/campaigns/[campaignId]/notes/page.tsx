"use client";

import { Suspense } from "react";

import { NotesBody, notesFontClass, SlotBoundary } from "@/components/notes/notes-body";

import { useCampaign } from "../campaign-shell";

/**
 * Notes (D11): the page shell. The body (index column, paper column, URL state `?view=…&page=…&journal=…`) lives in
 * src/components/notes/notes-body.tsx (Journal JN) so the Journal's Notes sub-tab renders the same UI; this route
 * renders it with the hero (`chrome="page"`) until the Journal replaces it (JX1). Every feature lives in a slot under
 * src/components/notes/ (contract: slots.ts). GM and players get the same layout; the server decides what each reads.
 */
export default function NotesPage() {
  const campaign = useCampaign();
  const isGm = campaign.role === "gm";
  return (
    <div className={`bj-root ${notesFontClass}`} data-role={isGm ? "gm" : "player"}>
      <title>{`Notes · ${campaign.name}`}</title>
      <SlotBoundary label="Notes">
        <Suspense
          fallback={
            <p role="status" className="bj-muted bj-hero">
              Loading notes…
            </p>
          }
        >
          <NotesBody chrome="page" campaignId={campaign._id} campaignName={campaign.name} isGm={isGm} />
        </Suspense>
      </SlotBoundary>
    </div>
  );
}
