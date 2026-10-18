"use client";

import { useMutation } from "convex/react";
import { useId, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import type { Thresholds } from "@/lib/domain/characters";
import { frameHasMechanic } from "@/lib/frames";

import { api } from "../../../../../../../convex/_generated/api";
import { useCampaign } from "../../campaign-shell";
import { useSheet } from "./sheet-context";
import { planDamage, SEVERITY_LABEL } from "./sheet-helpers";

type WitherResult = { tokens: number; fearDie: number; scarred: boolean; journeyEnds: boolean };

/** What the Fear Die did after Severe Withered damage (CB 261). */
function witherLine(w: WitherResult): string {
  if (!w.scarred) return `Withered: Wither token ${w.tokens}. Fear Die ${w.fearDie}, above ${w.tokens}: no scar.`;
  return `Withered: Fear Die ${w.fearDie}, at or below ${w.tokens} tokens: a scar, tokens cleared.${w.journeyEnds ? " The last Hope slot is gone." : ""}`;
}

/** "Take damage": enter a damage roll, see its severity and the Hit Points it marks, then apply. */
export function DamageCalculator({ thresholds, armorFree }: { thresholds: Thresholds; armorFree: number }) {
  const { applyDamage, character } = useSheet();
  const campaign = useCampaign();
  // tests/unit/sheet-render.test.ts mocks a campaign without `frameId`.
  const witherwild = frameHasMechanic(campaign.frameId, "witherTokens");
  const witheredDamage = useMutation(api.characters.applyDamage);
  const id = useId();
  const [raw, setRaw] = useState("");
  const [useArmor, setUseArmor] = useState(false);
  const [withered, setWithered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const damage = Number.parseInt(raw, 10);
  const valid = Number.isFinite(damage) && damage > 0;
  const plan = valid ? planDamage(damage, thresholds, useArmor, armorFree) : null;

  /** Withered damage goes straight to the mutation to read back the Fear Die. */
  async function applyWithered(armorUsed: boolean): Promise<boolean> {
    try {
      const result = await witheredDamage({ characterId: character._id, damage, useArmorSlot: armorUsed, withered: true });
      setOutcome(result.wither ? witherLine(result.wither) : null);
      return true;
    } catch (e) {
      setOutcome(errorMessage(e));
      return false;
    }
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    setOutcome(null);
    const ok = witherwild && withered ? await applyWithered(plan.armorUsed) : await applyDamage(damage, plan.armorUsed);
    setBusy(false);
    if (ok) {
      setRaw("");
      setUseArmor(false);
      setWithered(false);
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
        {witherwild ? (
          <label className="flex min-h-11 items-center gap-2 text-[16px]">
            <input type="checkbox" className="size-5 accent-[#6b5a45]" checked={withered} onChange={(e) => setWithered(e.target.checked)} />
            Withered source
          </label>
        ) : null}
        <button type="button" className="cs-pill cs-solid ml-auto" disabled={!plan || busy || (plan.marks === 0 && !plan.armorUsed)} onClick={() => void apply()}>
          Apply
        </button>
      </div>
      <p id={`${id}-out`} className="cs-small m-0 italic" aria-live="polite">
        {plan
          ? `${SEVERITY_LABEL[plan.severity]}${plan.armorUsed ? " after marking an Armor Slot" : ""}: mark ${plan.marks} Hit Point${plan.marks === 1 ? "" : "s"}.${
              withered && plan.severity === "severe" ? " Withered: gain a Wither token and roll the Fear Die." : ""
            }`
          : (outcome ?? "Enter a damage roll to see how many Hit Points it marks.")}
      </p>
    </div>
  );
}
