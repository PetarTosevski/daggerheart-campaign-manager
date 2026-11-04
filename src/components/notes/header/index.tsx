"use client";

import "./header.css";

import { useQuery } from "convex/react";

import { BrandButton } from "@/components/brand/buttons";
import { journalTitle, subLine } from "@/lib/domain/notes";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { useJournal } from "../page/use-journal";
import type { NotesSlotProps } from "../slots";

/**
 * Hero heading (B1, Q8): H1 '<whoName>’s Journal' ('Game Master’s Journal' for the GM, the journal's character for a
 * player, else the account name) and the sub line '<whoSub> · <N> pages · <M> entries'. Before the first write the
 * counts are the default pages'. No PIN (A1). The actions (threads, download) are other slots; the 'Writing as' chips
 * (Journal JN2) are `WritingAs` below, mounted only in the Journal's Notes sub-tab.
 */
export function JournalHeading({ campaignId }: NotesSlotProps) {
  const view = useJournal(campaignId);
  if (view === undefined) {
    return (
      <p role="status" className="bj-muted">
        Loading the journal…
      </p>
    );
  }
  const counts = view.journal ?? { pageCount: view.templates.length, entryCount: 0 };
  return (
    <>
      <h1 className="bj-title">{journalTitle(view.whoName)}</h1>
      <div className="bj-sub">{subLine(view.whoSub, counts)}</div>
    </>
  );
}

/** Up to two initials for a chip's portrait disc ('GM' for the Game Master). */
export function chipInitials(name: string, isGm: boolean): string {
  if (isGm) return "GM";
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[words.length - 1]![0]}` : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

type Chip = { key: string; name: string; isGm: boolean; pressed: boolean; onPick: () => void };

/**
 * 'Writing as' chips (Journal JN2, user Q12 default; reverses D11 A2), the design's row over the paper:
 * - the GM: 'Game Master' (their own journal, view 'page') and one chip per present player journal
 *   (`notesJournals.playerJournals`, named after its character, Q8). A player chip opens the existing journal view
 *   (view 'journal'), where the GM reads and adds lines as the sharing rules already allow; the GM's lines there are
 *   labelled ' - GM' as today (D11 Q3). Authorship never changes: the server writes every entry as `ctx.user`.
 * - a player: one chip, their own journal (no switching; they read others' pages through Shared).
 * A chip is pressed while its journal is on the paper (the own chip for every own view: page, threads, shared, bin).
 */
export function WritingAs({ campaignId, access, view, journalId, onPage, onView }: NotesSlotProps) {
  const own = useJournal(campaignId);
  const players = useQuery(api.notesJournals.playerJournals, access.isGm ? { campaignId } : "skip");
  if (own === undefined || (access.isGm && players === undefined)) {
    return (
      <p role="status" className="bj-muted bj-wa-row">
        Loading journals…
      </p>
    );
  }
  const chips: Chip[] = [
    {
      key: "own",
      name: own.whoName,
      isGm: own.isGm,
      pressed: view !== "journal",
      onPick: () => onPage(null, "page"),
    },
    ...(players ?? []).map((row) => ({
      key: row.journalId,
      name: row.name,
      isGm: false,
      pressed: view === "journal" && journalId === row.journalId,
      onPick: () => onView("journal", row.journalId),
    })),
  ];
  return (
    <div className="bj-wa-row">
      <div role="group" aria-labelledby="bj-wa-h" className="bj-wa">
        <span id="bj-wa-h" className="bj-wa-lbl">
          Writing as
        </span>
        <ul className="bj-wa-list">
          {chips.map((chip) => (
            <li key={chip.key}>
              <BrandButton
                variant="pill"
                size="sm"
                aria-pressed={chip.pressed}
                className={cn("bj-wa-chip", chip.isGm && "bj-wa-chip-gm")}
                onClick={chip.onPick}
              >
                <span aria-hidden="true" className="bj-wa-face">
                  {chipInitials(chip.name, chip.isGm)}
                </span>
                {chip.name}
              </BrandButton>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
