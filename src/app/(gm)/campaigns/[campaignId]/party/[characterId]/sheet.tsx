"use client";

import { useQuery } from "convex/react";
import { X } from "lucide-react";
import Link from "next/link";
import { useState, type KeyboardEvent } from "react";

import { LevelUpButton } from "@/components/party/level-up";
import { getClass } from "@/lib/srd";

import { api } from "../../../../../../../convex/_generated/api";
import { useCampaign } from "../../campaign-shell";

import { PageOne } from "./page-one";
import { PageThree } from "./page-three";
import { PageTwo } from "./page-two";
import { SheetBanner, SheetDeathMoves } from "./sections/header";
import { StatusControls } from "./sections/status";
import { SheetProvider, useSheet } from "./sheet-context";
import { nextTabIndex } from "./sheet-helpers";

const PAGES = [
  { id: "sheet", label: "Character Sheet" },
  { id: "story", label: "Story & Advancement" },
  { id: "domains", label: "Domains" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

/** The board's sheet shell: header row (banner | tabs | level | close), the live error, three pages, footer, status row. */
function SheetBody({ rosterHref }: { rosterHref: string }) {
  const { sheet, canEdit, error, slot } = useSheet();
  const [page, setPage] = useState<PageId>("sheet");
  const cls = getClass(sheet.classId);

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const next = PAGES[nextTabIndex(e.key, PAGES.findIndex((p) => p.id === page), PAGES.length)];
    if (!next) return;
    e.preventDefault();
    setPage(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <article className="cs-paper" aria-labelledby="sheet-title">
      <header className="cs-head">
        <SheetBanner cls={cls} />
        <div className="cs-tabs flex-[0_1_auto]" role="tablist" aria-label="Sheet pages" onKeyDown={onTabKey}>
          {PAGES.map((p) => (
            <button
              key={p.id}
              id={`tab-${p.id}`}
              type="button"
              role="tab"
              className="cs-tab flex-1"
              aria-selected={page === p.id}
              aria-controls={`panel-${p.id}`}
              tabIndex={page === p.id ? 0 : -1}
              onClick={() => setPage(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="cs-head-end">
          <LevelUpButton {...slot} />
          <Link href={rosterHref} className="cs-close" aria-label="Close character sheet">
            <X className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </header>
      <SheetDeathMoves />

      <p role="alert" aria-live="assertive" className="cs-error">
        {error}
      </p>

      {PAGES.map((p) => (
        <div key={p.id} id={`panel-${p.id}`} role="tabpanel" aria-labelledby={`tab-${p.id}`} hidden={page !== p.id}>
          {page !== p.id ? null : p.id === "sheet" ? <PageOne cls={cls} /> : p.id === "story" ? <PageTwo cls={cls} /> : <PageThree cls={cls} />}
        </div>
      ))}

      <footer className="cs-foot">
        {!canEdit ? (
          <span className="cs-small mr-auto italic" data-testid="read-only-note">
            Read only: only the player and the GM can change this sheet.
          </span>
        ) : null}
        <span className="cs-small italic">{canEdit ? "All changes save automatically." : "Updates live as the table plays."}</span>
      </footer>
      <StatusControls />
    </article>
  );
}

/** The 3-page character sheet; owner and GM edit, everyone else in the campaign reads. A route; × goes back to the roster. */
export function CharacterSheetView({ characterId }: { characterId: string }) {
  const campaign = useCampaign();
  const character = useQuery(api.characters.get, { characterId });
  const rosterHref = `/campaigns/${campaign._id}/party`;

  if (character === undefined) {
    return (
      <main className="cs-backdrop">
        <p className="cs-paper cs-empty cs-small italic" role="status">
          Loading character…
        </p>
      </main>
    );
  }
  if (character === null) {
    return (
      <main className="cs-backdrop">
        <div className="cs-paper cs-empty">
          <h1>Character not found</h1>
          <p className="cs-small m-0">It may have been deleted, or it belongs to another campaign.</p>
          <Link href={rosterHref} className="cs-back">
            Back to the party
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="cs-backdrop">
      <SheetProvider character={character} campaignId={campaign._id} isGm={campaign.role === "gm"} hopeAndFear={Boolean(campaign.options.hopeAndFear)}>
        <SheetBody rosterHref={rosterHref} />
      </SheetProvider>
    </main>
  );
}
