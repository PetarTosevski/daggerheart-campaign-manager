"use client";

import "./notes.css";

import { Caveat } from "next/font/google";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Component, useId, useState, type ReactNode } from "react";

import { BinView, TornOutPages } from "@/components/notes/bin";
import { DownloadJournalButton } from "@/components/notes/export";
import { JournalHeading } from "@/components/notes/header";
import { PageGroups } from "@/components/notes/index-column";
import { JournalsList, JournalView } from "@/components/notes/journals";
import { JournalPage } from "@/components/notes/page";
import { selectedPage, useJournal } from "@/components/notes/page/use-journal";
import { JournalSearch, useJournalSearch } from "@/components/notes/search";
import { SharedPageView, SharedSection } from "@/components/notes/shared";
import { parseView, type NotesSlotProps, type NotesView } from "@/components/notes/slots";
import { ThreadsButton, ThreadsView } from "@/components/notes/threads";

import type { Id } from "../../../convex/_generated/dataModel";

/** The board's handwriting face (Notes.dc.html l.10): put `notesFontClass` on the `.bj-root` that holds NotesBody. */
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat" });
export const notesFontClass = caveat.variable;

/**
 * Where NotesBody renders (Journal JN):
 * - 'page': the old /notes route. The hero (campaign line, '<who>’s Journal', Open threads, Download) above the columns.
 * - 'journal': the Journal's Notes sub-tab. No hero (the Journal header holds the title and Open threads);
 *   'Download my journal' moves into the index column.
 */
export type NotesChrome = "page" | "journal";

export type NotesBodyProps = {
  campaignId: Id<"campaigns">;
  isGm: boolean;
} & ({ chrome: "page"; campaignName: string } | { chrome: "journal" });

/** Keeps a failing slot (a `useQuery` that throws) from blanking the page (CL1); "Try again" remounts it. */
export class SlotBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean; message: string }> {
  state: { failed: boolean; message: string } = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.label} failed to load`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="bj-alert">
        <span>
          {this.props.label} failed to load{this.state.message ? `: ${this.state.message}` : "."}
        </span>
        <button type="button" className="bj-ghost" onClick={() => this.setState({ failed: false, message: "" })}>
          Try again
        </button>
      </div>
    );
  }
}

/** The paper column for the current view. */
function PaperColumn(slot: NotesSlotProps) {
  switch (slot.view) {
    case "threads":
      return (
        <SlotBoundary label="Open threads">
          <ThreadsView {...slot} />
        </SlotBoundary>
      );
    case "shared-players":
    case "shared-gm":
      return (
        <SlotBoundary label="The shared page">
          <SharedPageView {...slot} />
        </SlotBoundary>
      );
    case "journal":
      return (
        <SlotBoundary label="The journal">
          <JournalView {...slot} />
        </SlotBoundary>
      );
    case "bin":
      return (
        <SlotBoundary label="The torn-out page">
          <BinView {...slot} />
        </SlotBoundary>
      );
    case "page":
      return (
        <SlotBoundary label="The page">
          <JournalPage {...slot} />
        </SlotBoundary>
      );
  }
}

/**
 * Notes (D11), moved out of the /notes route (Journal JN) so the Journal's Notes sub-tab renders the same UI: the index
 * column (search, page groups, shared pages, journals, torn-out pages, Quick keys) and the paper column, with the URL
 * state `?view=…&page=…&journal=…`. Every other query param (the Journal's `?tab`, `?s`, `?sv`) is kept as is. Uses
 * `useSearchParams`: the caller wraps it in a Suspense boundary.
 */
export function NotesBody(props: NotesBodyProps) {
  const { campaignId, isGm, chrome } = props;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const matchingPageIds = useJournalSearch({ campaignId, search });
  // At <= 720 px (no board layout) the whole index column sits behind the 'Pages' disclosure (N9); picking anything
  // in it closes it again. Wider screens always show the column (notes.css).
  const [indexOpen, setIndexOpen] = useState(false);
  const indexId = useId();
  const journal = useJournal(campaignId);

  /** Rewrites `?view` / `?page` / `?journal` (null removes one) without a scroll jump or a new history entry. */
  function navigate(next: { view?: NotesView | null; page?: string | null; journal?: string | null }) {
    const query = new URLSearchParams(params.toString());
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined) continue;
      if (value === null || (name === "view" && value === "page")) query.delete(name);
      else query.set(name, value);
    }
    const text = query.toString();
    setIndexOpen(false);
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }

  const view = parseView(params.get("view"));
  const current = view === "page" && journal ? selectedPage(journal, params.get("page")) : null;

  const slot: NotesSlotProps = {
    campaignId,
    access: { isGm },
    journalId: params.get("journal"),
    pageId: params.get("page"),
    view,
    search,
    matchingPageIds,
    onPage: (page, view) => navigate({ page, ...(view ? { view } : {}) }),
    onView: (view, journal) => navigate({ view, ...(journal !== undefined ? { journal } : {}) }),
    onSearch: setSearch,
  };

  return (
    <>
      {props.chrome === "page" ? (
        <header className="bj-hero">
          <div className="bj-hero-text">
            <div className="bj-campaign">{props.campaignName}</div>
            <SlotBoundary label="The journal heading">
              <JournalHeading {...slot} />
            </SlotBoundary>
          </div>
          <div className="bj-actions">
            <SlotBoundary label="Open threads">
              <ThreadsButton {...slot} />
            </SlotBoundary>
            <SlotBoundary label="Download">
              <DownloadJournalButton {...slot} />
            </SlotBoundary>
          </div>
        </header>
      ) : null}
      <main className="bj-main" data-chrome={chrome}>
        <aside className="bj-index" aria-label="Journal index">
          <button
            type="button"
            className="bj-ghost bj-index-toggle"
            aria-expanded={indexOpen}
            aria-controls={indexId}
            onClick={() => setIndexOpen(!indexOpen)}
          >
            <span aria-hidden="true">{indexOpen ? "▾" : "▸"}</span> Pages
            {current ? <span className="bj-index-current">· {current.title}</span> : null}
          </button>
          <div id={indexId} className="bj-index-body" data-open={indexOpen}>
            <SlotBoundary label="Search">
              <JournalSearch {...slot} />
            </SlotBoundary>
            <SlotBoundary label="Your pages">
              <PageGroups {...slot} />
            </SlotBoundary>
            <SlotBoundary label="Shared pages">
              <SharedSection {...slot} />
            </SlotBoundary>
            <SlotBoundary label="Journals">
              <JournalsList {...slot} />
            </SlotBoundary>
            <SlotBoundary label="Torn-out pages">
              <TornOutPages {...slot} />
            </SlotBoundary>
            <div className="bj-card">
              <span className="bj-lbl">Quick keys</span>
              <span>
                Start a line with <strong>*</strong> task · <strong>o</strong> event · <strong>-</strong> note · <strong>!</strong> idea ·{" "}
                <strong className="bj-k-hope">+</strong> Hope · <strong className="bj-k-fear">^</strong> Fear
              </span>
              <span>
                Type <strong>@name</strong> to link someone or somewhere from Codex.
              </span>
            </div>
            {chrome === "journal" ? (
              <div className="bj-index-download">
                <SlotBoundary label="Download">
                  <DownloadJournalButton {...slot} />
                </SlotBoundary>
              </div>
            ) : null}
          </div>
        </aside>
        <section className="bj-sheet" aria-label="Journal page">
          <PaperColumn {...slot} />
        </section>
      </main>
    </>
  );
}
