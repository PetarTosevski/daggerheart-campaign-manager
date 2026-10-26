"use client";

import { useState } from "react";

import { useIntent } from "@/lib/use-intent";

import { Modal } from "@/components/brand/modal";
import { TrackerSessionChip } from "@/components/sessions/session-chip";
import { battlePoints } from "@/lib/domain/encounters/budget";
import { MAX_FEAR } from "@/lib/domain/fear";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

import type { FearReason, TrackerActions, TrackerView } from "./use-tracker";

const STATUS_LABEL = { draft: "Draft", running: "Running", ended: "Ended" } as const;

/** Why the GM spends Fear (CB p.154). */
const REASONS: readonly { id: FearReason; label: string }[] = [
  { id: "move", label: "Additional GM move" },
  { id: "feature", label: "Fear feature" },
  { id: "experience", label: "Experience" },
  { id: "interrupt", label: "Interrupt" },
];

function SpendFearDialog({ open, onClose, fear, actions }: { open: boolean; onClose: () => void; fear: number; actions: TrackerActions }) {
  const [amount, setAmount] = useState(1);
  const n = Math.min(amount, Math.max(1, fear));
  return (
    <Modal open={open} onClose={onClose} title="Spend Fear">
      <div className="trk-dialog">
        <p className="trk-muted">
          You hold {fear} Fear. Spend it to interrupt the players, make an additional GM move, use a Fear feature or add an adversary&apos;s Experience
          to a roll.
        </p>
        <div className="trk-defeat" role="group" aria-label="Fear to spend">
          <button type="button" className="trk-step" aria-label="Spend less Fear" disabled={n <= 1} onClick={() => setAmount(n - 1)}>
            −
          </button>
          <span className="trk-amount" aria-live="polite">
            {n} Fear
          </span>
          <button type="button" className="trk-step" aria-label="Spend more Fear" disabled={n >= fear} onClick={() => setAmount(n + 1)}>
            +
          </button>
        </div>
        <div className="trk-reasons">
          {REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="trk-btn trk-btn-fear"
              disabled={fear < n}
              onClick={() =>
                void actions.spendFear(n, r.id).then((result) => {
                  if (result) {
                    setAmount(1);
                    onClose();
                  }
                })
              }
            >
              {r.label}
            </button>
          ))}
        </div>
        {fear === 0 ? <p className="trk-muted">No Fear to spend.</p> : null}
      </div>
    </Modal>
  );
}

/**
 * The tracker's top bar: encounter name and status, "GM turn N" with "End GM turn" (spotlight counts reset), the GM
 * Fear as the dashboard's token art (12, lit up to the campaign's Fear; read-only here) with "Spend Fear", and the Battle Points meter (A3's budget, CB p.197).
 */
export function TopBar({ campaignId, view, fear, actions }: { campaignId: Id<"campaigns">; view: TrackerView; fear: number; actions: TrackerActions }) {
  const { encounter, instances } = view;
  const [spending, setSpending] = useState(false);
  // The GM gains Fear by hand (the same campaign Fear as the dashboard; rolls with Fear raise it on their own).
  const gain = useIntent(api.fear.adjust);
  const bp = battlePoints({
    pcs: encounter.pcs,
    adjustments: encounter.adjustments,
    entries: instances.map((i) => ({ type: i.type, tier: i.tier, summoned: i.summoned, minionCount: i.minionCount })),
    partyTier: 1,
  });
  const running = encounter.status === "running";

  return (
    <header className="trk-top">
      <div className="trk-top-name">
        <h2 className="trk-h">{encounter.name}</h2>
        <span className="trk-status" data-status={encounter.status}>
          {STATUS_LABEL[encounter.status]}
        </span>
        <TrackerSessionChip campaignId={campaignId} encounterId={encounter._id} />
      </div>
      <div className="trk-top-turn">
        <span className="trk-turn" data-testid="gm-turn">
          GM turn {encounter.gmTurn}
        </span>
        <button type="button" className="trk-btn" disabled={!running} onClick={() => void actions.endGmTurn()}>
          End GM turn
        </button>
      </div>
      <div className="trk-top-fear">
        <span className="trk-tokens" role="img" aria-label={`GM Fear ${fear} of ${MAX_FEAR}`} data-testid="tracker-fear">
          {Array.from({ length: MAX_FEAR }, (_, i) => (
            <i key={i} className={`trk-token ${i < fear ? "trk-token-on" : "trk-token-off"}`} />
          ))}
        </span>
        <span className="trk-fear-n" aria-hidden="true">
          {fear}
        </span>
        <button
          type="button"
          className="trk-btn trk-btn-fear"
          aria-label="Gain 1 Fear"
          disabled={fear >= MAX_FEAR || gain.pending}
          onClick={() => void gain.fire({ campaignId, direction: "increase" })}
        >
          + Fear
        </button>
        <button type="button" className="trk-btn trk-btn-fear" disabled={!running || fear === 0} onClick={() => setSpending(true)}>
          Spend Fear
        </button>
      </div>
      <div className="trk-top-bp" data-testid="tracker-bp">
        <span>
          Spent {bp.spent} of {bp.budget} BP
        </span>
        <span className="trk-bar" role="meter" aria-label="Battle Points spent" aria-valuemin={0} aria-valuemax={bp.budget} aria-valuenow={bp.spent} data-state={bp.state}>
          <i style={{ width: `${bp.percent}%` }} />
        </span>
      </div>
      <SpendFearDialog open={spending} onClose={() => setSpending(false)} fear={fear} actions={actions} />
    </header>
  );
}
