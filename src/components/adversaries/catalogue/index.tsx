"use client";

import "./catalogue.css";

import { useMemo, useRef, useState, type ReactNode } from "react";

import {
  NO_FILTERS,
  PAGE_FIRST,
  PAGE_MORE,
  countLine,
  filterAdversaries,
  groupByTier,
  moreLabel,
  toggleChip,
  typeLabel,
  type CatalogueBook,
  type CatalogueFilters,
  type CatalogueTier,
} from "@/lib/adversaries/catalogue";
import { adversariesFor } from "@/lib/domain/adversaries";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { ADVERSARY_TYPES, type AdversaryType } from "@/lib/srd/types";

import type { CatalogueProps } from "../slots";
import { HopeFearPill, StatBlock } from "./stat-block";

const TIERS: readonly CatalogueTier[] = [1, 2, 3, 4];
const BOOKS: readonly { id: CatalogueBook; label: string }[] = [
  { id: "core", label: "Core Rulebook" },
  { id: "hope-and-fear", label: "Hope & Fear" },
];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="adc-chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function ChipRow<T extends string | number>({
  label,
  values,
  current,
  name,
  onPick,
}: {
  label: string;
  values: readonly T[];
  current: T | null;
  name: (value: T) => string;
  onPick: (value: T | null) => void;
}) {
  return (
    <div className="adc-chips" role="group" aria-label={label}>
      <span className="adc-flab">{label}</span>
      <Chip on={current === null} onClick={() => onPick(null)}>
        All
      </Chip>
      {values.map((value) => (
        <Chip key={value} on={current === value} onClick={() => onPick(toggleChip(current, value))}>
          {name(value)}
        </Chip>
      ))}
    </div>
  );
}

/** Catalogue tab (D8 A2): search, Tier / Type / Book chips, tier-grouped list with paging, and the selected stat block. */
export function Catalogue({ hopeAndFear, frameId, renderActions }: CatalogueProps) {
  const visible = useMemo(() => adversariesFor(ADVERSARIES, { hopeAndFear, frameId }), [hopeAndFear, frameId]);
  const [filters, setFilters] = useState<CatalogueFilters>(NO_FILTERS);
  const [limit, setLimit] = useState(PAGE_FIRST);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);

  // The Book row exists only with Hope & Fear on; a Book filter left over from before the switch went off is ignored.
  const book = hopeAndFear ? filters.book : null;
  const { query, tier, type } = filters;
  const matches = useMemo(() => filterAdversaries(visible, { query, tier, type, book }), [visible, query, tier, type, book]);
  const groups = groupByTier(matches, limit);
  const more = moreLabel(matches.length, limit);
  const selected = matches.find((def) => def.id === selectedId) ?? matches[0] ?? null;

  function update(patch: Partial<CatalogueFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setLimit(PAGE_FIRST);
  }

  function pick(id: string) {
    setSelectedId(id);
    // One column (under 980 px): the stat block sits below the list, so bring it into view.
    if (window.matchMedia("(max-width: 980px)").matches) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      detailRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  }

  return (
    <div className="adc-grid">
      <section className="adc-browse" aria-label="Adversary list">
        <p className="adc-count" aria-live="polite">
          {countLine(visible, matches.length)}
        </p>
        <div className="adc-filters">
          <input
            className="adc-search"
            type="search"
            placeholder="Search by name, type, motive or feature"
            aria-label="Search adversaries"
            value={filters.query}
            onChange={(event) => update({ query: event.target.value })}
          />
          <ChipRow label="Tier" values={TIERS} current={tier} name={String} onPick={(tier) => update({ tier })} />
          <ChipRow<AdversaryType> label="Type" values={ADVERSARY_TYPES} current={type} name={String} onPick={(type) => update({ type })} />
          {hopeAndFear ? (
            <ChipRow<CatalogueBook>
              label="Book"
              values={BOOKS.map((b) => b.id)}
              current={book}
              name={(id) => BOOKS.find((b) => b.id === id)!.label}
              onPick={(book) => update({ book })}
            />
          ) : null}
        </div>
        <div className="adc-list">
          {groups.map((group) => (
            <div key={group.tier} role="group" aria-labelledby={`adc-tier-${group.tier}`}>
              <div className="adc-tierhead">
                <h3 id={`adc-tier-${group.tier}`}>{group.title}</h3>
                <span>{group.sub}</span>
              </div>
              {group.entries.map((def) => (
                <button
                  key={def.id}
                  type="button"
                  className="adc-item"
                  aria-current={def.id === selected?.id ? "true" : undefined}
                  onClick={() => pick(def.id)}
                >
                  <span className="adc-item-main">
                    <span className="adc-nm">
                      {def.name}
                      {def.source === "hope-and-fear" ? <HopeFearPill /> : null}
                    </span>
                    <span className="adc-sub">{def.motives}</span>
                  </span>
                  <span className="adc-type">{typeLabel(def)}</span>
                  <span className="adc-num" aria-hidden="true">
                    <span>
                      <strong>{def.difficulty}</strong>Diff
                    </span>
                    <span>
                      <strong>{def.hp}</strong>HP
                    </span>
                    <span>
                      <strong>{def.stress ?? "–"}</strong>Stress
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ))}
          {more ? (
            <button type="button" className="adc-more" onClick={() => setLimit((n) => n + PAGE_MORE)}>
              {more}
            </button>
          ) : null}
          {matches.length === 0 ? <p className="adc-empty">No adversaries match these filters. Clear the search or pick another tier or type.</p> : null}
        </div>
      </section>
      <aside ref={detailRef} className="adc-detail" aria-label="Stat block">
        {selected ? <StatBlock adversary={selected} actions={renderActions(selected)} /> : null}
      </aside>
    </div>
  );
}
