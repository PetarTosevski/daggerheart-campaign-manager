"use client";

import { useId, useState } from "react";

import type { Thresholds } from "@/lib/domain/characters";

import { useSheet } from "./sheet-context";
import { planDamage, SEVERITY_LABEL } from "./sheet-helpers";

/** "Take damage": enter a damage roll, see its severity and the Hit Points it marks, then apply. */
export function DamageCalculator({ thresholds, armorFree }: { thresholds: Thresholds; armorFree: number }) {
  const { applyDamage } = useSheet();
  const id = useId();
  const [raw, setRaw] = useState("");
  const [useArmor, setUseArmor] = useState(false);
  const [busy, setBusy] = useState(false);
  const damage = Number.parseInt(raw, 10);
  const valid = Number.isFinite(damage) && damage > 0;
  const plan = valid ? planDamage(damage, thresholds, useArmor, armorFree) : null;

  async function apply() {
    if (!plan) return;
    setBusy(true);
    const ok = await applyDamage(damage, plan.armorUsed);
    setBusy(false);
    if (ok) {
      setRaw("");
      setUseArmor(false);
    }
  }

  return (
    <div className="cs-take" role="group" aria-labelledby={`${id}-h`}>
      <div className="flex flex-wrap items-center gap-3">
        <span id={`${id}-h`} className="cs-lbl">
          Take damage
        </span>
        <label className="flex items-center gap-2">
          <span className="sr-only">Damage roll</span>
          <input
            className="cs-in w-24 text-center"
            inputMode="numeric"
            placeholder="Roll"
            value={raw}
            onChange={(e) => setRaw(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
            aria-describedby={`${id}-out`}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-[16px]">
          <input
            type="checkbox"
            className="size-5 accent-[#6b5a45]"
            checked={useArmor}
            disabled={armorFree <= 0}
            onChange={(e) => setUseArmor(e.target.checked)}
          />
          Use an Armor Slot {armorFree <= 0 ? <span className="cs-small italic">(none free)</span> : null}
        </label>
        <button type="button" className="cs-pill cs-solid ml-auto" disabled={!plan || busy || (plan.marks === 0 && !plan.armorUsed)} onClick={() => void apply()}>
          Apply
        </button>
      </div>
      <p id={`${id}-out`} className="cs-small m-0 italic" aria-live="polite">
        {plan
          ? `${SEVERITY_LABEL[plan.severity]}${plan.armorUsed ? " after marking an Armor Slot" : ""}: mark ${plan.marks} Hit Point${plan.marks === 1 ? "" : "s"}.`
          : "Enter a damage roll to see how many Hit Points it marks."}
      </p>
    </div>
  );
}
