"use client";

import type { KeyboardEvent } from "react";

import type { ClassDef } from "@/lib/srd";

import type { SheetCollection } from "./level-up-draft";
import { DomainCardsSection } from "./sections/domains";
import { HeritageSection, heritageCardCount } from "./sections/heritage";
import { useSheet } from "./sheet-context";
import { nextTabIndex } from "./sheet-helpers";

const COLLECTIONS = [
  { id: "cards", label: "Domain Cards" },
  { id: "heritage", label: "Heritage & Subclass" },
] as const satisfies readonly { id: SheetCollection; label: string }[];

/**
 * Domains page: the "Card collections" sub-tabs (board dk-tabs) over Domain Cards and Heritage & Subclass. The sheet
 * holds the selected sub-tab (`tab` / `onTab`) so the guided level-up can open the Domain Deck.
 */
export function PageThree({ cls, tab, onTab }: { cls: ClassDef | undefined; tab: SheetCollection; onTab: (tab: SheetCollection) => void }) {
  const { sheet } = useSheet();
  const counts: Record<SheetCollection, number> = { cards: sheet.domainCards.owned.length, heritage: heritageCardCount(sheet) };

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const next = nextTabIndex(e.key, COLLECTIONS.findIndex((c) => c.id === tab), COLLECTIONS.length);
    const target = COLLECTIONS[next];
    if (!target) return;
    e.preventDefault();
    onTab(target.id);
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
            onClick={() => onTab(c.id)}
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
