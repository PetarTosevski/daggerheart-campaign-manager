"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import type { NotesSlotProps } from "../slots";

const TABS = [
  { id: "players", label: "Shared by players" },
  { id: "gm", label: "Shared by GM" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/**
 * The Shared block of the index column (A2, Q2): ARIA tabs 'Shared by players' / 'Shared by GM' and the pages the
 * caller may read in each. N0 stub: the tabs and the empty line; N6 fills them from the `shared` query.
 */
export function SharedSection({ view }: NotesSlotProps) {
  const [chosen, setChosen] = useState<Tab | null>(null);
  const tab: Tab = chosen ?? (view === "shared-gm" ? "gm" : "players");
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: Tab = event.key === "Home" ? "players" : event.key === "End" ? "gm" : tab === "players" ? "gm" : "players";
    setChosen(next);
    refs.current[next]?.focus();
  }
  return (
    <section className="bj-group" aria-labelledby="bj-shared-h">
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
      <div role="tabpanel" id="bj-shared-panel" aria-labelledby={`bj-shared-tab-${tab}`} className="bj-empty">
        Nothing shared yet.
      </div>
    </section>
  );
}

/** A shared page, read-only with the add row (Q3). N0 stub: an empty paper; N6 fills it. */
export function SharedPageView(props: NotesSlotProps) {
  void props; // N0 stub: the feature tracer uses them.
  return (
    <article className="bj-paper" aria-label="Shared page">
      <div className="bj-tape bj-tape-1">Shared page</div>
      <p className="bj-line">Pick a page under Shared.</p>
    </article>
  );
}
