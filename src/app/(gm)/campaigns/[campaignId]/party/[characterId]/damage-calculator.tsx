"use client";

import { useId, useState } from "react";

import { Label, PaperInput, Pill, Small } from "@/components/party/sheet-ui";
import type { Thresholds } from "@/lib/domain/characters";
import { frameHasMechanic } from "@/lib/frames";
import { useIntent } from "@/lib/use-intent";

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
  // Keyed (review L2): one idempotency key per click.
  const witheredDamage = useIntent(api.characters.applyDamage);
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
    const result = await witheredDamage.fire({ characterId: character._id, damage, useArmorSlot: armorUsed, withered: true });
    if (result === undefined) return false;
    setOutcome(result.wither ? witherLine(result.wither) : null);
    return true;
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
    <div className="hp-take" role="group" aria-labelledby={`${id}-h`}>
      <Label id={`${id}-h`}>Take damage</Label>
      <label>
        <span className="sr-only">Damage roll</span>
        <PaperInput
          className="hp-take-in"
          inputMode="numeric"
          placeholder="Roll"
          value={raw}
          onChange={(e) => setRaw(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          aria-describedby={`${id}-out`}
        />
      </label>
      <label className="hp-toggle">
        <input type="checkbox" checked={useArmor} disabled={armorFree <= 0} onChange={(e) => setUseArmor(e.target.checked)} />
        Use an Armor Slot{armorFree <= 0 ? <span className="italic"> (none free)</span> : null}
      </label>
      {witherwild ? (
        <label className="hp-toggle">
          <input type="checkbox" checked={withered} onChange={(e) => setWithered(e.target.checked)} />
          Withered source
        </label>
      ) : null}
      <Pill disabled={!plan || busy || (plan.marks === 0 && !plan.armorUsed)} onClick={() => void apply()}>
        Apply
      </Pill>
      <Small as="p" id={`${id}-out`} className="hp-take-out italic" aria-live="polite">
        {plan
          ? `${SEVERITY_LABEL[plan.severity]}${plan.armorUsed ? " after marking an Armor Slot" : ""}: mark ${plan.marks} Hit Point${plan.marks === 1 ? "" : "s"}.${
              withered && plan.severity === "severe" ? " Withered: gain a Wither token and roll the Fear Die." : ""
            }`
          : (outcome ?? witheredDamage.error ?? "Enter a damage roll to see how many Hit Points it marks.")}
      </Small>
    </div>
  );
}
