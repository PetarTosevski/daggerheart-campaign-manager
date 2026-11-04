"use client";

import { useMutation } from "convex/react";
import { useId, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import {
  battlePoints,
  BP_ADJUSTMENTS,
  BP_COSTS,
  startingBudget,
  type BattlePoints,
  type BpAdjustmentId,
  type BudgetEntry,
} from "@/lib/domain/encounters/budget";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { EncounterView } from "./types";

const MIN_PCS = 1;
const MAX_PCS = 12;

export type BudgetChange = { kind: "pcs"; delta: number } | { kind: "adjustment"; adjustment: BpAdjustmentId; on: boolean };

/** What the server does with a Battle Points intent (convex/encounters.ts setBudget), for the optimistic update. */
export function applyBudgetChange<T extends { pcs: number; adjustments: BpAdjustmentId[] }>(encounter: T, change: BudgetChange): T {
  if (change.kind === "pcs") return { ...encounter, pcs: Math.min(MAX_PCS, Math.max(MIN_PCS, encounter.pcs + change.delta)) };
  const rest = encounter.adjustments.filter((a) => a !== change.adjustment);
  return { ...encounter, adjustments: change.on ? [...rest, change.adjustment] : rest };
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** The instances as the budget counts them. */
export function budgetEntries(view: EncounterView): BudgetEntry[] {
  return view.instances.map((i) => ({ type: i.type, tier: i.tier, summoned: i.summoned, minionCount: i.minionCount }));
}

/** Each cost row of CB p.197, as the Journal's Battle Points card lists them ('Costs'). */
export const BP_COST_ROWS: readonly { label: string; cost: number }[] = [
  { label: "Minion group", cost: 1 },
  { label: "Social / Support", cost: BP_COSTS.Social },
  { label: "Horde, Ranged, Skulk, Standard", cost: BP_COSTS.Standard },
  { label: "Leader", cost: BP_COSTS.Leader },
  { label: "Bruiser", cost: BP_COSTS.Bruiser },
  { label: "Solo", cost: BP_COSTS.Solo },
];

/** 'N left' / 'On budget' / 'N over' (the Journal board's short verdict). */
export function leftLabel(left: number): string {
  if (left > 0) return `${left} left`;
  if (left === 0) return "On budget";
  return `${-left} over`;
}

export type BudgetPanelProps = {
  campaignId: Id<"campaigns">;
  view: EncounterView;
  partyTier: number;
  /**
   * `builder` (default): the encounter builder's panel (Adversaries tab, old Sessions prep). `journal`: the Journal
   * Plan board's 'Battle points · Scene N' card (journal.css `jr-*` tokens, no party stepper, the cost table).
   */
  variant?: "builder" | "journal";
  /** The journal variant's heading, e.g. 'Battle points · Scene 3'. */
  title?: string;
};

/**
 * The Battle Points panel of the Sessions board's encounter builder (CB p.197): party-size stepper, progress bar,
 * "Spent X of Y" with the verdict, and the six adjustments as toggles, with the ones the adversaries suggest marked.
 * `variant="journal"` shows the same numbers on the same `encounters.setBudget` intent as the Journal board's card.
 */
export function BudgetPanel({ campaignId, view, partyTier, variant = "builder", title = "Battle points" }: BudgetPanelProps) {
  const { encounter } = view;
  const [error, setError] = useState<string | null>(null);
  // Budget writes not yet confirmed by the server. The optimistic update shows the new budget at once, so the panel says
  // it is still saving (aria-busy) until every write lands; leaving the page before then can lose the last one (dcm-o0tx).
  const [saving, setSaving] = useState(0);
  const setBudget = useMutation(api.encounters.setBudget).withOptimisticUpdate((store, { encounterId, change }) => {
    const current = store.getQuery(api.encounters.get, { campaignId, encounterId });
    if (!current) return;
    store.setQuery(api.encounters.get, { campaignId, encounterId }, { ...current, encounter: applyBudgetChange(current.encounter, change) });
  });
  const bp = battlePoints({ pcs: encounter.pcs, adjustments: encounter.adjustments, entries: budgetEntries(view), partyTier });
  const on = new Set(encounter.adjustments);

  function change(next: BudgetChange) {
    setError(null);
    setSaving((n) => n + 1);
    setBudget({ campaignId, encounterId: encounter._id, change: next })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setSaving((n) => n - 1));
  }

  if (variant === "journal") {
    return <JournalBudget title={title} pcs={encounter.pcs} bp={bp} on={on} saving={saving > 0} error={error} onChange={change} />;
  }

  return (
    <section className="enc-card" aria-labelledby="enc-bp-h" aria-busy={saving > 0} data-testid="bp-panel">
      <div className="enc-head">
        <h2 id="enc-bp-h" className="enc-h">
          Encounter builder
        </h2>
        <span className="enc-muted">Battle Points</span>
      </div>
      <div className="enc-party">
        <span id="enc-pcs-label">Player characters</span>
        <span className="enc-stepper" role="group" aria-labelledby="enc-pcs-label">
          <BrandButton variant="neutral" size="sm" icon aria-label="Fewer player characters" disabled={encounter.pcs <= MIN_PCS} onClick={() => change({ kind: "pcs", delta: -1 })}>
            −
          </BrandButton>
          <span className="enc-num" aria-live="polite">
            {encounter.pcs}
          </span>
          <BrandButton variant="neutral" size="sm" icon aria-label="More player characters" disabled={encounter.pcs >= MAX_PCS} onClick={() => change({ kind: "pcs", delta: 1 })}>
            +
          </BrandButton>
        </span>
      </div>
      <div
        className="enc-bar"
        role="meter"
        aria-label="Battle Points spent"
        aria-valuemin={0}
        aria-valuemax={Math.max(bp.budget, bp.spent)}
        aria-valuenow={bp.spent}
        aria-valuetext={`Spent ${bp.spent} of ${bp.budget}`}
      >
        <div className="enc-bar-fill" data-state={bp.state} style={{ width: `${bp.percent}%` }} />
      </div>
      <div className="enc-spent" data-testid="bp-spent">
        <span>
          Spent <strong>{bp.spent}</strong> of <strong>{bp.budget}</strong>
        </span>
        <span className="enc-verdict" data-state={bp.state}>
          {bp.verdict}
        </span>
      </div>
      {bp.minionGroups > 0 ? (
        <p className="enc-muted enc-note">
          Minions: {bp.minionGroups} {bp.minionGroups === 1 ? "group" : "groups"} of up to {encounter.pcs} (1 BP each).
        </p>
      ) : null}
      <h3 className="enc-lbl">Adjustments</h3>
      <div role="group" aria-label="Adjustments">
        {BP_ADJUSTMENTS.map((a) => {
          const pressed = on.has(a.id);
          const hinted = bp.hints.includes(a.id) && !pressed;
          return (
            <button key={a.id} type="button" className="enc-adj" aria-pressed={pressed} onClick={() => change({ kind: "adjustment", adjustment: a.id, on: !pressed })}>
              <span className="enc-box" aria-hidden="true">
                {pressed ? "✓" : ""}
              </span>
              <span className="enc-adj-label">
                <span>{a.label}</span>
                {hinted ? <span className="enc-hint">Suggested by this encounter&apos;s adversaries</span> : null}
              </span>
              <span className="enc-delta">{signed(a.delta)}</span>
            </button>
          );
        })}
      </div>
      <p className="enc-muted enc-note">Starting budget is 3 × player characters + 2, per the core rules&apos; encounter guidance.</p>
      {error ? (
        <p role="alert" className="enc-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- the Journal variant

const STATE_TEXT = { under: "text-(--jr-live-text)", exact: "text-(--jr-acc)", over: "text-(--jr-danger)" } as const;
const STATE_FILL = { under: "bg-(--jr-acc)", exact: "bg-(--jr-acc)", over: "bg-(--jr-danger)" } as const;

/**
 * The Journal Plan board's card (design reference/designs/journal/journal_views.jpg, right column): 'X of Y spent',
 * 'Z left', the bar, the party formula with the starting budget, the adjustments with their deltas, the cost table.
 * The party size is set in the builder (Adversaries tab); this card shows it.
 */
function JournalBudget({
  title,
  pcs,
  bp,
  on,
  saving,
  error,
  onChange,
}: {
  title: string;
  pcs: number;
  bp: BattlePoints;
  on: ReadonlySet<BpAdjustmentId>;
  saving: boolean;
  error: string | null;
  onChange: (change: BudgetChange) => void;
}) {
  const id = useId();
  return (
    <section className="jr-card flex flex-col gap-3" aria-labelledby={id} aria-busy={saving} data-testid="bp-panel" data-variant="journal">
      <h2 id={id} className="jr-lbl m-0">
        {title}
      </h2>
      <div className="flex items-baseline justify-between gap-3" data-testid="bp-spent">
        <p className="m-0 flex items-baseline gap-2">
          <span className="font-(family-name:--jr-serif) text-[40px] leading-none text-(--jr-acc)">{bp.spent}</span>
          <span className="text-(--jr-muted)">of {bp.budget} spent</span>
        </p>
        <span className={`font-semibold ${STATE_TEXT[bp.state]}`} data-state={bp.state}>
          {leftLabel(bp.left)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-(--jr-border)"
        role="meter"
        aria-label="Battle Points spent"
        aria-valuemin={0}
        aria-valuemax={Math.max(bp.budget, bp.spent)}
        aria-valuenow={bp.spent}
        aria-valuetext={`Spent ${bp.spent} of ${bp.budget}`}
      >
        <div className={`h-full rounded-full motion-safe:transition-[width] ${STATE_FILL[bp.state]}`} style={{ width: `${bp.percent}%` }} />
      </div>
      <p className="m-0 flex justify-between gap-3 text-sm text-(--jr-muted)" data-testid="bp-party">
        <span>
          Party of {pcs}: 3 × {pcs} + 2
        </span>
        <span className="font-semibold text-(--jr-text)">{startingBudget(pcs)}</span>
      </p>
      {bp.minionGroups > 0 ? (
        <p className="m-0 text-sm text-(--jr-muted)">
          Minions: {bp.minionGroups} {bp.minionGroups === 1 ? "group" : "groups"} of up to {pcs} (1 BP each).
        </p>
      ) : null}
      <h3 className="jr-lbl m-0">Adjustments</h3>
      <div role="group" aria-label="Adjustments" className="-mt-1 flex flex-col">
        {BP_ADJUSTMENTS.map((a) => {
          const pressed = on.has(a.id);
          const hinted = bp.hints.includes(a.id) && !pressed;
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange({ kind: "adjustment", adjustment: a.id, on: !pressed })}
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-1 text-left text-sm text-(--jr-text) hover:bg-(--jr-hover) focus-visible:outline-2 focus-visible:outline-(--jr-acc)"
            >
              <span
                aria-hidden="true"
                className={`grid size-4 flex-none place-items-center rounded-[3px] border text-[11px] leading-none ${pressed ? "border-(--jr-acc) bg-(--jr-acc) text-(--jr-acc-ink)" : "border-(--jr-border) bg-(--jr-text)"}`}
              >
                {pressed ? "✓" : ""}
              </span>
              <span className="flex flex-1 flex-col">
                <span>{a.label}</span>
                {hinted ? <span className="text-xs text-(--jr-acc)">Suggested by this encounter&apos;s adversaries</span> : null}
              </span>
              <span className={`font-semibold ${a.delta < 0 ? "text-(--jr-danger)" : "text-(--jr-live-text)"}`}>{signed(a.delta)}</span>
            </button>
          );
        })}
      </div>
      <h3 className="jr-lbl m-0">Costs</h3>
      <ul aria-label="Battle Point costs" className="m-0 flex list-none flex-wrap gap-2 p-0">
        {BP_COST_ROWS.map((row) => (
          <li key={row.label} className="rounded-full border border-(--jr-border) px-2.5 py-1 text-xs text-(--jr-muted)">
            {row.label} <strong className="ml-1 text-(--jr-acc)">{row.cost}</strong>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="m-0 text-sm text-(--jr-danger)">
          {error}
        </p>
      ) : null}
    </section>
  );
}
