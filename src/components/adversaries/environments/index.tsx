"use client";

import "../catalogue/catalogue.css";
import "./environments.css";

import { ChevronDown } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  PAGE_FIRST,
  PAGE_MORE,
  moreLabel,
  openCount,
  sortAdversaries,
  toggleChip,
  type CatalogueBook,
  type CatalogueSort,
  type CatalogueTier,
} from "@/lib/adversaries/catalogue";
import { adversariesFor } from "@/lib/domain/adversaries";
import {
  NO_ENVIRONMENT_FILTERS,
  environmentCountLine,
  environmentsFor,
  filterEnvironments,
  groupEnvironmentsByTier,
  type EnvironmentFilters,
} from "@/lib/domain/environments";
import type { FrameId } from "@/lib/frames";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { ENVIRONMENTS } from "@/lib/srd/environments";
import { ENVIRONMENT_TYPES, type EnvironmentDef, type EnvironmentType } from "@/lib/srd/types";

import type { Id } from "../../../../convex/_generated/dataModel";
import { HopeFearPill } from "../catalogue/stat-block";
import { EnvironmentFearBar, EnvironmentStatus, FeatureActions, useEnvironmentActions } from "./feature-actions";
import { EnvironmentStatBlock } from "./stat-block";

const TIERS: readonly CatalogueTier[] = [1, 2, 3, 4];
const BOOKS: readonly { id: CatalogueBook; label: string }[] = [
  { id: "core", label: "Core Rulebook" },
  { id: "hope-and-fear", label: "Hope & Fear" },
];

/** "An environment's type represents the style of scene it most readily supports" (Core Rulebook p.241). */
const TYPE_MEANING: Record<EnvironmentType, string> = {
  Exploration: "Wondrous locations with mysteries and marvels to discover.",
  Social: "Locations that primarily present interpersonal challenges.",
  Traversal: "Dangerous locations where moving around the space itself is a challenge.",
  Event: "Defined more by the activity taking place than the space they take place in.",
};

const SORT_KEY = "dcm:environment-sort";
const SORT_EVENT = "dcm-environment-sort";
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

export type EnvironmentCatalogueProps = {
  campaignId: Id<"campaigns">;
  /** The campaign's GM Fear (the dashboard's), spent by features with a Fear cost (EF1). */
  fear: number;
  /** The campaign's Hope & Fear content switch: Hope & Fear environments (and adversary links) only when on. */
  hopeAndFear: boolean;
  frameId: FrameId;
  /** The selected environment (null = the first match), kept by the page so it survives a tab switch. */
  selectedId: string | null;
  onSelect: (environmentId: string) => void;
  /** A potential adversary was picked: show it in the Catalogue tab. */
  onOpenAdversary: (adversaryId: string, fromEnvironment: Pick<EnvironmentDef, "id" | "name">) => void;
};

/**
 * Environment tab (EV1): search, Order / Tier / Type / Book chips, tier groups that collapse, paging, and the selected
 * environment's parchment stat block, laid out like the adversary catalogue.
 */
export function EnvironmentCatalogue({ campaignId, fear, hopeAndFear, frameId, selectedId, onSelect, onOpenAdversary }: EnvironmentCatalogueProps) {
  const actions = useEnvironmentActions(campaignId);
  const visible = useMemo(() => environmentsFor(ENVIRONMENTS, { hopeAndFear, frameId }), [hopeAndFear, frameId]);
  const adversaryIds = useMemo(() => new Set(adversariesFor(ADVERSARIES, { hopeAndFear, frameId }).map((a) => a.id)), [hopeAndFear, frameId]);
  const [filters, setFilters] = useState<EnvironmentFilters>(NO_ENVIRONMENT_FILTERS);
  const [limit, setLimit] = useState(PAGE_FIRST);
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
  const matches = useMemo(() => sortAdversaries(filterEnvironments(visible, { query, tier, type, book }), sort), [visible, query, tier, type, book, sort]);
  const groups = groupEnvironmentsByTier(matches, limit, collapsed);
  const more = moreLabel(openCount(matches, collapsed), limit);
  const selected = matches.find((def) => def.id === selectedId) ?? matches[0] ?? null;

  function update(patch: Partial<EnvironmentFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setLimit(PAGE_FIRST);
  }

  function pick(id: string) {
    onSelect(id);
    // One column (under 980 px): the stat block sits below the list, so bring it into view.
    if (window.matchMedia("(max-width: 980px)").matches) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      detailRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  }

  return (
    <>
      <p className="adc-count" aria-live="polite" data-testid="environment-count">
        {environmentCountLine(visible, matches.length)}
      </p>
      <div className="adc-grid">
        <section className="adc-browse" aria-label="Environment list">
          <div className="adc-filters">
            <input
              className="adc-search"
              type="search"
              placeholder="Search by name, type, impulse or feature"
              aria-label="Search environments"
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
            <ChipRow<EnvironmentType> label="Type" values={ENVIRONMENT_TYPES} current={type} name={String} onPick={(type) => update({ type })} />
            <details className="adc-legend">
              <summary>What do the types mean?</summary>
              <dl>
                {ENVIRONMENT_TYPES.map((t) => (
                  <div key={t} className="contents">
                    <dt>{t}</dt>
                    <dd>{TYPE_MEANING[t]}</dd>
                  </div>
                ))}
              </dl>
              <p className="adc-legend-src">Core Rulebook p. 241, “Environment Types”.</p>
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
              <div key={group.tier} role="group" aria-labelledby={`env-tier-${group.tier}`}>
                <h3 className="adc-tierhead-h" id={`env-tier-${group.tier}`}>
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
                      // A fresh page from the tiers still open, as in the adversary catalogue.
                      setLimit(PAGE_MORE);
                    }}
                  >
                    <span className="adc-tierhead-title">{group.title}</span>
                    <span className="adc-tierhead-sub">{group.sub}</span>
                    <ChevronDown className="adc-tierhead-chev size-4" aria-hidden="true" />
                  </button>
                </h3>
                {collapsed.has(group.tier)
                  ? null
                  : group.entries.map((def) => (
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
                          <span className="adc-sub">{def.impulses}</span>
                        </span>
                        <span className="adc-type">{def.type}</span>
                        <span className="adc-num" aria-hidden="true">
                          <span>
                            <strong>{typeof def.difficulty === "number" ? def.difficulty : "Special"}</strong>Diff
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
            {matches.length === 0 ? <p className="adc-empty">No environments match these filters. Clear the search or pick another tier or type.</p> : null}
          </div>
        </section>
        <aside ref={detailRef} className="adc-detail" aria-label="Environment stat block">
          {selected ? (
            <EnvironmentStatBlock
              environment={selected}
              canOpenAdversary={(id) => adversaryIds.has(id)}
              onOpenAdversary={(id) => onOpenAdversary(id, selected)}
              top={
                <>
                  <EnvironmentFearBar campaignId={campaignId} fear={fear} />
                  <EnvironmentStatus status={actions.statusFor(selected.id)} />
                </>
              }
              renderFeatureActions={(feature) => <FeatureActions environment={selected} feature={feature} fear={fear} actions={actions} />}
            />
          ) : null}
        </aside>
      </div>
    </>
  );
}
