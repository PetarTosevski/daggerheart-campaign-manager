"use client";

import { useState, type KeyboardEvent } from "react";

import type { ClassDef } from "@/lib/srd";

import { DomainCardsSection } from "./sections/domains";
import { HeritageSection, heritageCardCount } from "./sections/heritage";
import { useSheet } from "./sheet-context";
import { nextTabIndex } from "./sheet-helpers";

const COLLECTIONS = [
  { id: "cards", label: "Domain Cards" },
  { id: "heritage", label: "Heritage & Subclass" },
] as const;

type CollectionId = (typeof COLLECTIONS)[number]["id"];

/** Domains page: the "Card collections" sub-tabs (board dk-tabs) over Domain Cards and Heritage & Subclass. */
export function PageThree({ cls }: { cls: ClassDef | undefined }) {
  const { sheet } = useSheet();
  const [tab, setTab] = useState<CollectionId>("cards");
  const counts: Record<CollectionId, number> = { cards: sheet.domainCards.owned.length, heritage: heritageCardCount(sheet) };

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const next = nextTabIndex(e.key, COLLECTIONS.findIndex((c) => c.id === tab), COLLECTIONS.length);
    const target = COLLECTIONS[next];
    if (!target) return;
    e.preventDefault();
    setTab(target.id);
    document.getElementById(`subtab-${target.id}`)?.focus();
  }

  return (
    <div className="cs-page">
      <div className="dk-tabs" role="tablist" aria-label="Card collections" onKeyDown={onKey}>
        {COLLECTIONS.map((c) => (
          <button
            key={c.id}
            id={`subtab-${c.id}`}
            type="button"
            role="tab"
            className="dk-tab"
            aria-selected={tab === c.id}
            aria-controls={`subpanel-${c.id}`}
            tabIndex={tab === c.id ? 0 : -1}
            onClick={() => setTab(c.id)}
          >
            {c.label}
            <span className="dk-tabn" aria-hidden="true">
              {counts[c.id]}
            </span>
          </button>
        ))}
      </div>
      {COLLECTIONS.map((c) => (
        <div key={c.id} id={`subpanel-${c.id}`} role="tabpanel" aria-labelledby={`subtab-${c.id}`} hidden={tab !== c.id}>
          {tab !== c.id ? null : c.id === "cards" ? <DomainCardsSection cls={cls} /> : <HeritageSection />}
        </div>
      ))}
    </div>
  );
}
