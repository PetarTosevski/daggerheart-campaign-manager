"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { battlePoints, BP_ADJUSTMENTS, type BpAdjustmentId, type BudgetEntry } from "@/lib/domain/encounters/budget";

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

/**
 * The Battle Points panel of the Sessions board's encounter builder (CB p.197): party-size stepper, progress bar,
 * "Spent X of Y" with the verdict, and the six adjustments as toggles, with the ones the adversaries suggest marked.
 */
export function BudgetPanel({ campaignId, view, partyTier }: { campaignId: Id<"campaigns">; view: EncounterView; partyTier: number }) {
  const { encounter } = view;
  const [error, setError] = useState<string | null>(null);
  const setBudget = useMutation(api.encounters.setBudget).withOptimisticUpdate((store, { encounterId, change }) => {
    const current = store.getQuery(api.encounters.get, { campaignId, encounterId });
    if (!current) return;
    store.setQuery(api.encounters.get, { campaignId, encounterId }, { ...current, encounter: applyBudgetChange(current.encounter, change) });
  });
  const bp = battlePoints({ pcs: encounter.pcs, adjustments: encounter.adjustments, entries: budgetEntries(view), partyTier });
  const on = new Set(encounter.adjustments);

  function change(next: BudgetChange) {
    setError(null);
    setBudget({ campaignId, encounterId: encounter._id, change: next }).catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <section className="enc-card" aria-labelledby="enc-bp-h">
      <div className="enc-head">
        <h2 id="enc-bp-h" className="enc-h">
          Encounter builder
        </h2>
        <span className="enc-muted">Battle Points</span>
      </div>
      <div className="enc-party">
        <span id="enc-pcs-label">Player characters</span>
        <span className="enc-stepper" role="group" aria-labelledby="enc-pcs-label">
          <button type="button" className="enc-step" aria-label="Fewer player characters" disabled={encounter.pcs <= MIN_PCS} onClick={() => change({ kind: "pcs", delta: -1 })}>
            −
          </button>
          <span className="enc-num" aria-live="polite">
            {encounter.pcs}
          </span>
          <button type="button" className="enc-step" aria-label="More player characters" disabled={encounter.pcs >= MAX_PCS} onClick={() => change({ kind: "pcs", delta: 1 })}>
            +
          </button>
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
