"use client";

import { useEffect, useRef } from "react";

import { hudButtonClass } from "../ui";

/**
 * INTERIM (plan combat-hud H5.2): a stand-in for H5.3's `FearConfirm` (hud/fear), written against its planned props
 * `{ amount, reasons, onConfirm, onCancel }` while H5.3 builds it in parallel. `fear-confirm.tsx` re-exports this; at
 * merge the orchestrator points that one import at `../fear` and deletes this file (docs/tasks/TASK-HUD-H5.2.md).
 * Board: GMDesktop 'Spend Fear' (`.sp`): "Spend 2 Fear?", the reasons, Cancel, "Spend 2 Fear".
 */
export type FearConfirmProps = {
  amount: number;
  reasons: readonly string[];
  onConfirm: () => void;
  onCancel?: () => void;
};

export function FearConfirm({ amount, reasons, onConfirm, onCancel }: FearConfirmProps) {
  const yes = useRef<HTMLButtonElement>(null);
  // Focus is not state: the question takes it so Enter / Esc answer it.
  useEffect(() => yes.current?.focus(), []);
  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label="Spend Fear"
      className="hsb-fc"
      data-testid="hud-fear-confirm"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel?.();
        }
      }}
    >
      <b>Spend {amount} Fear?</b>
      {reasons.length > 0 ? <p>{reasons.join(", ")}.</p> : null}
      <div className="hsb-fc-f">
        {onCancel ? (
          <button type="button" className={hudButtonClass()} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button ref={yes} type="button" className={hudButtonClass("primary")} onClick={onConfirm}>
          Spend {amount} Fear
        </button>
      </div>
    </div>
  );
}
