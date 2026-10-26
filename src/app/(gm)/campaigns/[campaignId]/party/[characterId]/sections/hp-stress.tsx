"use client";

import "./hp-stress.css";

import { Label, Pip, SheetBox, SlotRow, Small } from "@/components/party/sheet-ui";
import { WitherCounter } from "@/components/party/wither";
import { derivedThresholds, subclassBonuses } from "@/lib/domain/characters/derived";
import { getArmor } from "@/lib/srd";

import { DamageCalculator } from "../damage-calculator";
import { useDefense, useSheet } from "../sheet-context";
import { pipDelta, thresholdRanges } from "../sheet-helpers";

// Hit Points & Stress box of page 1 (board: Party.dc.html, "Hit Points & Stress"): threshold heads, threshold
// pills with their parts, the Take damage row, 12-column heart and diamond rows, and the Wither counter.

const MAX_SLOTS = 12;

/**
 * One slot row: `slots` usable pips (tap marks up to it, tapping the last marked clears it), padded to 12 with
 * faded unused slots like the board. Read-only renders the same pips as one image.
 */
function SlotTrack({
  name,
  kind,
  slots,
  marked,
  readOnly,
  onDelta,
}: {
  name: string;
  kind: "heart" | "diamond";
  slots: number;
  marked: number;
  readOnly: boolean;
  onDelta: (delta: number) => void;
}) {
  const summary = `${name}: ${marked} of ${slots} marked`;
  const unused = Array.from({ length: Math.max(0, MAX_SLOTS - slots) }, (_, k) => <Pip key={`off-${k}`} kind={kind} className="hp-off" />);
  if (readOnly) {
    return (
      <SlotRow role="img" aria-label={summary} className="hp-slots">
        {Array.from({ length: slots }, (_, k) => (
          <Pip key={k} kind={kind} on={k < marked} />
        ))}
        {unused}
      </SlotRow>
    );
  }
  return (
    <SlotRow role="group" aria-label={summary} className="hp-slots">
      {Array.from({ length: slots }, (_, k) => (
        <Pip key={k} kind={kind} on={k < marked} label={`${name} ${k + 1} of ${slots}`} onClick={() => onDelta(pipDelta(k + 1, marked))} />
      ))}
      {unused}
    </SlotRow>
  );
}

/** The board's 32 px paper −/+ beside a slot row (44 px at phone width). */
function SlotSteppers({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  return (
    <span className="hp-steps" role="group" aria-label={label}>
      <button type="button" className="hp-step" aria-label={`Decrease ${label}`} disabled={value <= 1} onClick={() => onChange(value - 1)}>
        −
      </button>
      <button type="button" className="hp-step" aria-label={`Increase ${label}`} disabled={value >= MAX_SLOTS} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  );
}

export function HitPointsStressBox() {
  const { sheet, canEdit, update, adjust, slot } = useSheet();
  const { armorSlots } = useDefense();
  const armor = sheet.armorId ? getArmor(sheet.armorId) : undefined;
  const thresholds = derivedThresholds(sheet);
  const subclassBonus = subclassBonuses(sheet);
  const ranges = thresholdRanges(thresholds);
  const parts = [
    armor ? `${armor.name} ${armor.baseThresholds.major}/${armor.baseThresholds.severe}` : "Unarmored",
    `Level +${sheet.level}`,
    subclassBonus.thresholds ? `Subclass +${subclassBonus.thresholds}` : null,
    subclassBonus.severe ? `Subclass +${subclassBonus.severe} Severe` : null,
  ].filter((part): part is string => part !== null);
  return (
    <SheetBox title="Hit Points & Stress" className="hp-box">
      <div className="hp-heads">
        {(
          [
            ["Minor", ranges.minor, 1],
            ["Major", ranges.major, 2],
            ["Severe", ranges.severe, 3],
          ] as const
        ).map(([name, range, marks]) => (
          <div key={name} className="hp-head">
            <span className="hp-head-name">{name} Damage</span>
            <span className="hp-head-val" aria-label={`${name} damage ${range}`}>
              {range}
            </span>
            <Small>Mark {marks} HP</Small>
          </div>
        ))}
      </div>
      <div className="hp-break">
        <Label className="mr-1">Thresholds</Label>
        <strong className="hp-thr-pill" data-testid="threshold-major">
          Major {thresholds.major}
        </strong>
        <strong className="hp-thr-pill" data-testid="threshold-severe">
          Severe {thresholds.severe}
        </strong>
        <Small className="italic">=</Small>
        {parts.map((part) => (
          <span key={part} className="hp-thr-part">
            {part}
          </span>
        ))}
      </div>
      {canEdit ? <DamageCalculator thresholds={thresholds} armorFree={armorSlots - sheet.armorMarked} /> : null}
      <div className="hp-row">
        <Label className="hp-row-lbl">
          HP
        </Label>
        <SlotTrack name="Hit Point" kind="heart" slots={sheet.hpMax} marked={sheet.hp} readOnly={!canEdit} onDelta={(d) => void adjust("hp", d)} />
        {canEdit ? <SlotSteppers label="Hit Point slots" value={sheet.hpMax} onChange={(hpMax) => void update({ hpMax })} /> : null}
      </div>
      <div className="hp-row">
        <Label className="hp-row-lbl">
          Stress
        </Label>
        <SlotTrack name="Stress" kind="diamond" slots={sheet.stressMax} marked={sheet.stress} readOnly={!canEdit} onDelta={(d) => void adjust("stress", d)} />
        {canEdit ? <SlotSteppers label="Stress slots" value={sheet.stressMax} onChange={(stressMax) => void update({ stressMax })} /> : null}
      </div>
      {sheet.stress >= sheet.stressMax ? <Small className="font-bold text-[#8e2b2b]">All Stress marked: Vulnerable.</Small> : null}
      <WitherCounter {...slot} />
    </SheetBox>
  );
}
