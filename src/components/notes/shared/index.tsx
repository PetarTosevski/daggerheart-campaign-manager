"use client";

import "./shared.css";

import { useQuery } from "convex/react";
import { useRef, useState, type KeyboardEvent } from "react";

import { pageMeta } from "@/lib/domain/notes";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SharedRow, SharedTab } from "../../../../convex/notesSharing";
import { Entries } from "../entries";
import type { NotesSlotProps, NotesView } from "../slots";

const TABS = [
  { id: "players", label: "Shared by players" },
  { id: "gm", label: "Shared by GM" },
] as const satisfies readonly { id: SharedTab; label: string }[];

const VIEW_OF: Record<SharedTab, NotesView> = { players: "shared-players", gm: "shared-gm" };

/** The Shared tab's rows (`undefined` while loading). */
function useShared(campaignId: Id<"campaigns">, tab: SharedTab): SharedRow[] | undefined {
  return useQuery(api.notesSharing.shared, { campaignId, tab });
}

/** Rows grouped by owner, in the server's order (by owner, then created). */
function byOwner(rows: readonly SharedRow[]): { owner: string; rows: SharedRow[] }[] {
  const groups: { owner: string; rows: SharedRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.owner === row.ownerName) last.rows.push(row);
    else groups.push({ owner: row.ownerName, rows: [row] });
  }
  return groups;
}

/**
 * The Shared block of the index column (A2, Q2): ARIA tabs 'Shared by players' / 'Shared by GM' and exactly the pages
 * the server lets the caller read in each (`notesSharing.shared`): tape tab, title and owner; the GM sees players'
 * pages grouped by player (Q2) and, under 'Shared by GM', their own shared pages with who reads them. A reader's row
 * opens the read-only page (?view=shared-players / shared-gm); the GM's own row opens it in their journal.
 */
export function SharedSection({ campaignId, view, pageId, onPage }: NotesSlotProps) {
  const [chosen, setChosen] = useState<SharedTab | null>(null);
  const tab: SharedTab = chosen ?? (view === "shared-gm" ? "gm" : "players");
  const refs = useRef<Partial<Record<SharedTab, HTMLButtonElement | null>>>({});
  const rows = useShared(campaignId, tab);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: SharedTab = event.key === "Home" ? "players" : event.key === "End" ? "gm" : tab === "players" ? "gm" : "players";
    setChosen(next);
    refs.current[next]?.focus();
  }

  function rowButton(row: SharedRow, showOwner: boolean) {
    const current = (view === VIEW_OF[tab] || (row.own && view === "page")) && pageId === row.pageId;
    return (
      <li key={row.pageId}>
        <button
          type="button"
          className="bj-shared-btn"
          aria-current={current ? "page" : undefined}
          onClick={() => onPage(row.pageId, row.own ? "page" : VIEW_OF[tab])}
        >
          <span aria-hidden="true" className={`bj-shared-tab bj-tape-${row.tape}`} />
          <span className="bj-shared-text">
            <span className="bj-shared-title">{row.title}</span>
            <span className="bj-shared-owner">{row.own ? row.chip : showOwner ? row.ownerName : row.chip}</span>
          </span>
        </button>
      </li>
    );
  }

  return (
    <section className="bj-group bj-shared" aria-labelledby="bj-shared-h">
      <div id="bj-shared-h" className="bj-lbl">
        Shared
      </div>
      <div role="tablist" aria-label="Shared pages" className="bj-tabs" onKeyDown={onKeyDown}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            ref={(el) => {
              refs.current[id] = el;
            }}
            type="button"
            role="tab"
            id={`bj-shared-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="bj-shared-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setChosen(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="bj-shared-panel" aria-labelledby={`bj-shared-tab-${tab}`} className="bj-shared-panel">
        {rows === undefined ? (
          <p role="status" className="bj-muted">
            Loading shared pages…
          </p>
        ) : rows.length === 0 ? (
          <div className="bj-empty">Nothing shared yet.</div>
        ) : tab === "players" ? (
          byOwner(rows).map((group) => (
            <div key={group.owner} role="group" aria-label={group.owner} className="bj-shared-group">
              <div className="bj-shared-group-head">{group.owner}</div>
              <ul className="bj-shared-list">{group.rows.map((row) => rowButton(row, false))}</ul>
            </div>
          ))
        ) : (
          <ul className="bj-shared-list">{rows.map((row) => rowButton(row, true))}</ul>
        )}
      </div>
    </section>
  );
}

/**
 * A page shared with the caller (Q3): '<owner>’s page · read only' above the paper, the tape and title, the meta and
 * the sharing label, then the entries with the reader's flags (the add row when the server allows it). The row comes
 * from the tab's `shared` list, so a page that stops being shared closes at once.
 */
export function SharedPageView(props: NotesSlotProps) {
  const tab: SharedTab = props.view === "shared-gm" ? "gm" : "players";
  const rows = useShared(props.campaignId, tab);
  if (props.pageId === null) {
    return (
      <article className="bj-paper" aria-label="Shared page">
        <div className="bj-tape bj-tape-1">Shared pages</div>
        <p className="bj-line">Pick a page under Shared.</p>
      </article>
    );
  }
  if (rows === undefined) {
    return (
      <article className="bj-paper" aria-label="Shared page">
        <p role="status" className="bj-line">
          Loading the page…
        </p>
      </article>
    );
  }
  const row = rows.find((r) => r.pageId === props.pageId);
  if (row === undefined) {
    return (
      <article className="bj-paper" aria-label="Shared page">
        <div className="bj-tape bj-tape-2">Not shared</div>
        <p className="bj-line">This page isn&apos;t shared with you. Pick one under Shared.</p>
      </article>
    );
  }
  return (
    <div className="bj-shared-view">
      <p className="bj-shared-by">{`${row.ownerName}’s page · read only`}</p>
      <article className="bj-paper" aria-label="Shared page">
        <div className={`bj-tape bj-tape-${row.tape}`}>{row.title}</div>
        <div className="bj-toolbar">
          <h2 className="bj-shared-heading">{row.title}</h2>
          <span className="bj-page-meta">{pageMeta({ kind: row.kind, createdAt: row.createdAt })}</span>
          <span className="bj-chip bj-shared-chip">
            <span aria-hidden="true">👁</span>
            {row.chip}
          </span>
        </div>
        <Entries {...props} pageId={row.pageId} />
      </article>
    </div>
  );
}
