"use client";

import "./catalogue.css";

import { ChevronDown } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  NO_FILTERS,
  PAGE_FIRST,
  PAGE_MORE,
  countLine,
  filterAdversaries,
  groupByTier,
  moreLabel,
  openCount,
  sortAdversaries,
  toggleChip,
  typeLabel,
  type CatalogueBook,
  type CatalogueFilters,
  type CatalogueSort,
  type CatalogueTier,
} from "@/lib/adversaries/catalogue";
import { adversariesFor } from "@/lib/domain/adversaries";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { adversaryArt } from "@/lib/srd/adversary-art";
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

/** Round thumbnail of the rulebook art (AA1); nothing for an adversary without art. Decorative: the name follows. */
function Thumb({ id }: { id: string }) {
  const art = adversaryArt(id);
  if (!art) return null;
  // eslint-disable-next-line @next/next/no-img-element -- static pre-optimised WebP from public/
  return <img className="adc-thumb" src={art.src} width={32} height={32} alt="" loading="lazy" decoding="async" />;
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
/** "An adversary's type represents the role they play in a conflict." The types as the Core Rulebook lists them (p.194). */
const TYPE_MEANING: Record<AdversaryType, string> = {
  Bruiser: "Tough and deliver powerful attacks.",
  Horde: "Groups of identical creatures acting together as a single unit.",
  Leader: "Command and summon other adversaries.",
  Minion: "Easily dispatched but dangerous in numbers.",
  Ranged: "Fragile in close encounters but can attack from a distance for high damage.",
  Skulk: "Maneuver and exploit opportunities to ambush opponents.",
  Social: "Present unique challenges to overcome through conversation rather than combat.",
  Solo: "Present a formidable challenge to a whole party, with or without support.",
  Standard: "Rank-and-file adversaries representative of their fictional group.",
  Support: "Enhance their allies and disrupt their opponents.",
};

const SORT_KEY = "dcm:adversary-sort";
const SORT_EVENT = "dcm-adversary-sort";
/** The last choice, for when storage throws (private windows, blocked site data). */
let sortFallback: CatalogueSort = "name";

function readSort(): CatalogueSort {
  try {
    const stored = window.localStorage.getItem(SORT_KEY);
    return stored === "book" || stored === "name" ? stored : sortFallback;
  } catch {
    return sortFallback;
  }
}

function subscribeSort(onChange: () => void): () => void {
  window.addEventListener(SORT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SORT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function Catalogue({ hopeAndFear, frameId, renderActions }: CatalogueProps) {
  const visible = useMemo(() => adversariesFor(ADVERSARIES, { hopeAndFear, frameId }), [hopeAndFear, frameId]);
  const [filters, setFilters] = useState<CatalogueFilters>(NO_FILTERS);
  const [limit, setLimit] = useState(PAGE_FIRST);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Tier groups the GM folded away (click a tier's heading).
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());
  // A–Z or book order, remembered per device (browser storage is for conveniences only).
  const sort = useSyncExternalStore(subscribeSort, readSort, () => "name" as CatalogueSort);
  function chooseSort(next: CatalogueSort) {
    setLimit(PAGE_FIRST);
    try {
      window.localStorage.setItem(SORT_KEY, next);
    } catch {
      // Storage blocked: the order can't be remembered; fall back to the in-page event only.
    }
    sortFallback = next;
    window.dispatchEvent(new Event(SORT_EVENT));
  }
  const detailRef = useRef<HTMLElement>(null);

  // The Book row exists only with Hope & Fear on; a Book filter left over from before the switch went off is ignored.
  const book = hopeAndFear ? filters.book : null;
  const { query, tier, type } = filters;
  const matches = useMemo(() => sortAdversaries(filterAdversaries(visible, { query, tier, type, book }), sort), [visible, query, tier, type, book, sort]);
  const groups = groupByTier(matches, limit, collapsed);
  const more = moreLabel(openCount(matches, collapsed), limit);
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
    <>
      {/* The count sits above the grid so the stat block lines up with the search bar and the list's bottom. */}
      <p className="adc-count" aria-live="polite" data-testid="catalogue-count">
        {countLine(visible, matches.length)}
      </p>
      <div className="adc-grid">
      <section className="adc-browse" aria-label="Adversary list">
        <div className="adc-filters">
          <input
            className="adc-search"
            type="search"
            placeholder="Search by name, type, motive or feature"
            aria-label="Search adversaries"
            value={filters.query}
            onChange={(event) => update({ query: event.target.value })}
          />
          <div className="adc-chips" role="group" aria-label="Order">
            <span className="adc-flab">Order</span>
            <Chip on={sort === "name"} onClick={() => chooseSort("name")}>
              A–Z
            </Chip>
            <Chip on={sort === "book"} onClick={() => chooseSort("book")}>
              Book order
            </Chip>
          </div>
          <ChipRow label="Tier" values={TIERS} current={tier} name={String} onPick={(tier) => update({ tier })} />
          <ChipRow<AdversaryType> label="Type" values={ADVERSARY_TYPES} current={type} name={String} onPick={(type) => update({ type })} />
          <details className="adc-legend">
            <summary>What do the types mean?</summary>
            <dl>
              {ADVERSARY_TYPES.map((t) => (
                <div key={t} className="contents">
                  <dt>{t}</dt>
                  <dd>{TYPE_MEANING[t]}</dd>
                </div>
              ))}
            </dl>
            <p className="adc-legend-src">Core Rulebook p. 194, “Adversary Types”.</p>
          </details>
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
              <h3 className="adc-tierhead-h" id={`adc-tier-${group.tier}`}>
                <button
                  type="button"
                  className="adc-tierhead"
                  aria-expanded={!collapsed.has(group.tier)}
                  onClick={() => {
                    setCollapsed((c) => {
                      const next = new Set(c);
                      if (next.has(group.tier)) next.delete(group.tier);
                      else next.add(group.tier);
                      return next;
                    });
                    // A fresh page of 60 from the tiers still open (user 2026-10-18).
                    setLimit(PAGE_MORE);
                  }}
                >
                  <span className="adc-tierhead-title">{group.title}</span>
                  <span className="adc-tierhead-sub">{group.sub}</span>
                  <ChevronDown className="adc-tierhead-chev size-4" aria-hidden="true" />
                </button>
              </h3>
              {collapsed.has(group.tier) ? null : group.entries.map((def) => (
                <button
                  key={def.id}
                  type="button"
                  className="adc-item"
                  aria-current={def.id === selected?.id ? "true" : undefined}
                  onClick={() => pick(def.id)}
                >
                  <span className="adc-item-main">
                    <span className="adc-nm">
                      <Thumb id={def.id} />
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
    </>
  );
}
