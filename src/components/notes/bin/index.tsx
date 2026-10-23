"use client";

import "./bin.css";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { errorMessage } from "@/lib/convex-errors";
import { binDaysLeft, daysLeftLabel, UNDO_MS } from "@/lib/domain/notes";
import { binPageLocally, restorePageLocally } from "@/lib/optimistic/notes-bin";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { BinRow } from "../../../../convex/notesBin";
import { Entries } from "../entries";
import { selectedPage, useJournal } from "../page/use-journal";
import { toPageRef, type NotesSlotProps } from "../slots";
import { playTear } from "./tear-sound";
import { endTear, hideToast, showToast, startTear, useTearState, type TearFrame } from "./tear-store";

/**
 * The bin (D11 N7; Q11, Q12, D2; board Notes.dc.html l.122-126, 135, 172-191, 326; B8):
 * - `TearOutButton` (page toolbar): 'Tear out page' → 'Click again to tear out'; the second click plays the rip (two
 *   clip-path halves and paper scraps over the page) with a synthesised tear sound, both skipped under reduced motion,
 *   tears the page out (`notesBin.binPage`, optimistic) and shows the toast.
 * - `TornOutPages` (index column): 'Torn-out pages' with title, 'N days left' and 'Restore'; it also mounts
 *   `TearLayer`, the rip frame and the role=status toast 'Page torn out · Undo' (10 s), which outlive the page.
 * - `BinView` (paper column, view 'bin'): a torn-out page read only, with 'Restore'.
 */

/** How long the rip plays (board: the page is removed after 1450 ms; the stub fades by 1.5 s). */
const RIP_MS = 1500;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

// ---------------------------------------------------------------- tear out

/** 'Tear out page' for the page toolbar (B3, B8). Two clicks; the page is in the bin after the second. */
export function TearOutButton({ campaignId, pageId, view, onPage }: NotesSlotProps) {
  const journal = useJournal(campaignId);
  const binPage = useMutation(api.notesBin.binPage).withOptimisticUpdate(binPageLocally);
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const ref = toPageRef(pageId);
  if (ref === null || pageId === null) return null;
  const isArmed = armed === pageId;

  function tearOut() {
    if (ref === null) return;
    setArmed(null);
    setError(null);
    const title = (journal && selectedPage(journal, pageId)?.title) ?? "Page";
    const paper = button.current?.closest<HTMLElement>(".bj-paper");
    if (paper && !prefersReducedMotion()) {
      playTear(); // inside the click: browsers allow audio after a gesture
      const r = paper.getBoundingClientRect();
      startTear(paper.cloneNode(true) as HTMLElement, { top: r.top, left: r.left, width: r.width, height: r.height });
    }
    const back = view === "journal" ? "journal" : "page";
    binPage({ campaignId, page: ref })
      .then((id) => showToast({ campaignId, pageId: id, title, view: back }))
      .catch((e: unknown) => setError(errorMessage(e)));
    onPage(null, back);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="bj-ghost bj-paper-btn bj-tear-btn"
        aria-live="polite"
        onClick={() => (isArmed ? tearOut() : setArmed(pageId))}
        onBlur={() => setArmed(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setArmed(null);
        }}
      >
        {isArmed ? "Click again to tear out" : "Tear out page"}
      </button>
      {error ? (
        <span role="alert" className="bj-tear-error">
          {error}
        </span>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- the rip frame and the toast

/** Appends a copy of the torn paper to a half once (React renders the halves empty). */
function useClone(paper: HTMLElement) {
  return useCallback(
    (el: HTMLDivElement | null) => {
      if (el && el.childElementCount === 0) el.appendChild(paper.cloneNode(true));
    },
    [paper],
  );
}

/** The board's twelve paper scraps (l.317): positions, drift, spin and delay. */
const SCRAPS: CSSProperties[] = Array.from(
  { length: 12 },
  (_, i) =>
    ({
      left: `${6 + (i % 3)}%`,
      top: `${4 + i * 8}%`,
      "--dx": `${-20 + (i % 4) * 30}px`,
      "--dy": `${90 + i * 22}px`,
      "--rot": `${i * 83}deg`,
      animationDelay: `${0.25 + i * 0.05}s`,
    }) as CSSProperties,
);

function RipFrame({ tear }: { tear: TearFrame }) {
  const stub = useClone(tear.paper);
  const main = useClone(tear.paper);
  useEffect(() => {
    const timer = window.setTimeout(() => endTear(tear.key), RIP_MS);
    return () => window.clearTimeout(timer);
  }, [tear.key]);
  return (
    <div
      className="bj-tear"
      aria-hidden="true"
      inert
      data-testid="tear-frame"
      style={{ top: tear.rect.top, left: tear.rect.left, width: tear.rect.width, height: tear.rect.height }}
    >
      <div ref={stub} className="bj-half bj-half-stub" />
      <div ref={main} className="bj-half bj-half-main" />
      {SCRAPS.map((style, i) => (
        <span key={i} className="bj-scrap" style={style} />
      ))}
    </div>
  );
}

/** The rip frame and the 'Page torn out · Undo' toast, portalled into the Notes root (its tokens apply). */
function TearLayer({ campaignId, onPage }: Pick<NotesSlotProps, "campaignId" | "onPage">) {
  const { tear, toast } = useTearState();
  const [root, setRoot] = useState<Element | null>(null);
  const anchor = useCallback((el: HTMLSpanElement | null) => setRoot(el?.closest(".bj-root") ?? null), []);
  const restore = useMutation(api.notesBin.restorePage).withOptimisticUpdate(restorePageLocally);
  const [error, setError] = useState<string | null>(null);
  const toastKey = toast?.key;

  useEffect(() => {
    if (toastKey === undefined) return;
    const timer = window.setTimeout(() => hideToast(toastKey), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [toastKey]);

  const ownToast = toast !== null && toast.campaignId === campaignId ? toast : null;

  function undo() {
    if (ownToast === null) return;
    hideToast(ownToast.key);
    setError(null);
    restore({ campaignId, page: ownToast.pageId })
      .then(() => onPage(ownToast.pageId, ownToast.view))
      .catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <>
      <span ref={anchor} hidden />
      {root
        ? createPortal(
            <>
              {tear ? <RipFrame key={tear.key} tear={tear} /> : null}
              <div className="bj-toast-wrap">
                <div role="status" className="bj-toast" data-open={ownToast !== null || error !== null}>
                  {ownToast ? (
                    <>
                      <span>
                        Page torn out<span className="sr-only">: {ownToast.title}</span> ·
                      </span>
                      <button type="button" className="bj-toast-undo" onClick={undo}>
                        Undo
                      </button>
                    </>
                  ) : error ? (
                    <span>{error}</span>
                  ) : null}
                </div>
              </div>
            </>,
            root,
          )
        : null}
    </>
  );
}

// ---------------------------------------------------------------- torn-out pages

/** 'Torn-out pages' in the index column (Q11): title, 'N days left', 'Restore'. Also hosts the rip and the toast. */
export function TornOutPages({ campaignId, pageId, view, onPage }: NotesSlotProps) {
  const rows = useQuery(api.notesBin.bin, { campaignId });
  const restore = useMutation(api.notesBin.restorePage).withOptimisticUpdate(restorePageLocally);
  const [error, setError] = useState<string | null>(null);
  // Days left change once a day; the time the list mounted is close enough (no clock in the query, CF10). A page torn
  // out after that counts from its own binnedAt (a full 30 days), never 31.
  const [now] = useState(() => Date.now());

  function restoreRow(row: BinRow) {
    setError(null);
    const viewing = view === "bin" && pageId === row._id;
    restore({ campaignId, page: row._id })
      .then(() => {
        if (row.from === null) onPage(row._id, "page");
        else if (viewing) onPage(null, "page");
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <section className="bj-group bj-bin" aria-labelledby="bj-bin-h">
      <div id="bj-bin-h" className="bj-lbl">
        Torn-out pages
      </div>
      {rows === undefined ? (
        <p role="status" className="bj-muted">
          Loading …
        </p>
      ) : rows.length === 0 ? (
        <div className="bj-empty">Nothing torn out.</div>
      ) : (
        <ul className="bj-bin-list" aria-labelledby="bj-bin-h">
          {rows.map((row) => (
            <li key={row._id} className="bj-bin-row">
              <button
                type="button"
                className="bj-bin-open"
                aria-current={view === "bin" && pageId === row._id ? "page" : undefined}
                onClick={() => onPage(row._id, "bin")}
              >
                <span aria-hidden="true" className={`bj-bin-tab bj-tape-${row.tape}`} />
                <span className="bj-bin-text">
                  <span className="bj-bin-title">{row.title}</span>
                  <span className="bj-bin-meta">
                    {daysLeftLabel(binDaysLeft(row.binnedAt, Math.max(now, row.binnedAt)))}
                    {row.from !== null ? ` · from ${row.from}’s journal` : ""}
                  </span>
                </span>
              </button>
              <button type="button" className="bj-ghost bj-bin-restore" aria-label={`Restore ${row.title}`} onClick={() => restoreRow(row)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="bj-bin-error">
          {error}
        </p>
      ) : null}
      <TearLayer campaignId={campaignId} onPage={onPage} />
    </section>
  );
}

// ---------------------------------------------------------------- one torn-out page

/** A torn-out page read only (view 'bin'), with 'Restore'. Its entries come read only from `Entries` (all flags off). */
export function BinView(props: NotesSlotProps) {
  const { campaignId, pageId, onPage } = props;
  const rows = useQuery(api.notesBin.bin, { campaignId });
  const restore = useMutation(api.notesBin.restorePage).withOptimisticUpdate(restorePageLocally);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  if (rows === undefined) {
    return (
      <article className="bj-paper" aria-label="Torn-out page">
        <p role="status" className="bj-line">
          Loading the page…
        </p>
      </article>
    );
  }
  const row = rows.find((r) => r._id === pageId);
  if (row === undefined) {
    return (
      <article className="bj-paper" aria-label="Torn-out page">
        <div className="bj-tape bj-tape-2">Torn out</div>
        <p className="bj-line">Pick a page under Torn-out pages.</p>
      </article>
    );
  }
  const id: Id<"journalPages"> = row._id;
  return (
    <article className="bj-paper" aria-label="Torn-out page">
      <div className={`bj-tape bj-tape-${row.tape}`}>{row.title}</div>
      <div className="bj-toolbar">
        <span className="bj-page-meta">
          Torn out · {daysLeftLabel(binDaysLeft(row.binnedAt, Math.max(now, row.binnedAt)))}
          {row.from !== null ? ` · from ${row.from}’s journal` : ""}
        </span>
        <button
          type="button"
          className="bj-ghost bj-paper-btn"
          onClick={() => {
            setError(null);
            restore({ campaignId, page: id })
              .then(() => onPage(row.from === null ? id : null, "page"))
              .catch((e: unknown) => setError(errorMessage(e)));
          }}
        >
          Restore page
        </button>
      </div>
      {error ? (
        <p role="alert" className="bj-tear-error">
          {error}
        </p>
      ) : null}
      <Entries {...props} />
    </article>
  );
}
