"use client";

import { NotesBody, notesFontClass } from "@/components/notes/notes-body";

import type { NotesTabProps } from "../slots";

/**
 * The Notes sub-tab (JN, contract: ../slots.ts): the existing Notes UI (src/components/notes/notes-body.tsx) without its
 * hero; the Journal header holds the title and Open threads, 'Download my journal' sits in the index column. The notes
 * params `view` / `page` / `journal` work beside `?tab=notes`. The page mounts this inside its SlotBoundary and the
 * Suspense boundary `useSearchParams` needs. Writing-as chips and the page groups' names come with JN2.
 */
export function NotesTab({ campaignId, isGm }: NotesTabProps) {
  return (
    <div className={`bj-root ${notesFontClass}`} data-role={isGm ? "gm" : "player"} data-chrome="journal">
      <NotesBody chrome="journal" campaignId={campaignId} isGm={isGm} />
    </div>
  );
}
