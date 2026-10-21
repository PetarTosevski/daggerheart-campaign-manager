"use client";

import "./notes.css";

import { Caveat } from "next/font/google";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Component, Suspense, useState, type ReactNode } from "react";

import { BinView, TornOutPages } from "@/components/notes/bin";
import { DownloadJournalButton } from "@/components/notes/export";
import { JournalHeading } from "@/components/notes/header";
import { PageGroups } from "@/components/notes/index-column";
import { JournalsList, JournalView } from "@/components/notes/journals";
import { JournalPage } from "@/components/notes/page";
import { JournalSearch, useJournalSearch } from "@/components/notes/search";
import { SharedPageView, SharedSection } from "@/components/notes/shared";
import { parseView, type NotesSlotProps, type NotesView } from "@/components/notes/slots";
import { ThreadsButton, ThreadsView } from "@/components/notes/threads";

import type { CampaignSummary } from "../../../../../../convex/campaigns";
import { useCampaign } from "../campaign-shell";

/** The board's handwriting face (Notes.dc.html l.10), only on this page. */
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat" });

/**
 * Notes (D11): the page shell. N0 owns the layout, the hero frame, the Quick keys card and the URL state
 * (`?view=…&page=…&journal=…`); every feature lives in a slot under src/components/notes/ (contract: slots.ts).
 * GM and players get the same layout; the server decides what each reads. No 'Writing as' switcher (A2), no PIN (A1).
 */

/** Keeps a failing slot (a `useQuery` that throws) from blanking the page (CL1); "Try again" remounts it. */
class SlotBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean; message: string }> {
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

/** Everything that depends on the URL (`useSearchParams` needs the Suspense boundary of the page). */
function NotesBody({ campaign, isGm }: { campaign: CampaignSummary; isGm: boolean }) {
  const campaignId = campaign._id;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const matchingPageIds = useJournalSearch({ campaignId, search });

  /** Rewrites `?view` / `?page` / `?journal` (null removes one) without a scroll jump or a new history entry. */
  function navigate(next: { view?: NotesView | null; page?: string | null; journal?: string | null }) {
    const query = new URLSearchParams(params.toString());
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined) continue;
      if (value === null || (name === "view" && value === "page")) query.delete(name);
      else query.set(name, value);
    }
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }

  const slot: NotesSlotProps = {
    campaignId,
    access: { isGm },
    journalId: params.get("journal"),
    pageId: params.get("page"),
    view: parseView(params.get("view")),
    search,
    matchingPageIds,
    onPage: (page, view) => navigate({ page, ...(view ? { view } : {}) }),
    onView: (view, journal) => navigate({ view, ...(journal !== undefined ? { journal } : {}) }),
    onSearch: setSearch,
  };

  return (
    <>
      <header className="bj-hero">
        <div className="bj-hero-text">
          <div className="bj-campaign">{campaign.name}</div>
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
      <main className="bj-main">
        <aside className="bj-index" aria-label="Journal index">
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
              Type <strong>@name</strong> to link someone or somewhere from Characters &amp; Locations.
            </span>
          </div>
        </aside>
        <section className="bj-sheet" aria-label="Journal page">
          <PaperColumn {...slot} />
        </section>
      </main>
    </>
  );
}

export default function NotesPage() {
  const campaign = useCampaign();
  const isGm = campaign.role === "gm";
  return (
    <div className={`bj-root ${caveat.variable}`} data-role={isGm ? "gm" : "player"}>
      <title>{`Notes · ${campaign.name}`}</title>
      <SlotBoundary label="Notes">
        <Suspense
          fallback={
            <p role="status" className="bj-muted bj-hero">
              Loading notes…
            </p>
          }
        >
          <NotesBody campaign={campaign} isGm={isGm} />
        </Suspense>
      </SlotBoundary>
    </div>
  );
}
