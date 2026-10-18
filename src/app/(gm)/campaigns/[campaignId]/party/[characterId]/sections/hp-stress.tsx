"use client";

import "./hp-stress.css";

import { SheetBox } from "@/components/party/sheet-ui";
import { WitherCounter } from "@/components/party/wither";
import { derivedThresholds, subclassBonuses } from "@/lib/domain/characters/derived";
import { getArmor } from "@/lib/srd";

import { DamageCalculator } from "../damage-calculator";
import { Stepper, Track } from "../fields";
import { useDefense, useSheet } from "../sheet-context";
import { thresholdRanges } from "../sheet-helpers";

// Hit Points & Stress box of page 1, with the damage calculator and the Wither counter. Restyled by S3.

const MAX_SLOTS = 12;

export function HitPointsStressBox() {
  const { sheet, canEdit, update, adjust, slot } = useSheet();
  const { armorSlots } = useDefense();
  const armor = sheet.armorId ? getArmor(sheet.armorId) : undefined;
  const thresholds = derivedThresholds(sheet);
  const subclassBonus = subclassBonuses(sheet);
  const ranges = thresholdRanges(thresholds);
  return (
    <SheetBox title="Hit Points & Stress">
      <div className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["Minor", ranges.minor, 1],
            ["Major", ranges.major, 2],
            ["Severe", ranges.severe, 3],
          ] as const
        ).map(([name, range, marks]) => (
          <div key={name} className="flex flex-col gap-1">
            <span className="cs-thr-head">{name}</span>
            <span className="cs-thr-val" aria-label={`${name} damage ${range}`}>
              {range}
            </span>
            <span className="cs-small">Mark {marks} HP</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="cs-lbl">Thresholds</span>
        <strong className="cs-thr-pill" data-testid="threshold-major">
          Major {thresholds.major}
        </strong>
        <strong className="cs-thr-pill" data-testid="threshold-severe">
          Severe {thresholds.severe}
        </strong>
        <span className="cs-small italic">
          = {armor ? `${armor.name} ${armor.baseThresholds.major}/${armor.baseThresholds.severe}` : "Unarmored"} + level {sheet.level}
          {subclassBonus.thresholds ? ` + ${subclassBonus.thresholds} subclass` : ""}
          {subclassBonus.severe ? ` (+${subclassBonus.severe} Severe, subclass)` : ""}
        </span>
      </div>
      {canEdit ? <DamageCalculator thresholds={thresholds} armorFree={armorSlots - sheet.armorMarked} /> : null}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="cs-lbl">
            HP <span className="normal-case">{sheet.hp} / {sheet.hpMax}</span>
          </span>
          {canEdit ? (
            <Stepper label="Hit Point slots" value={sheet.hpMax} min={1} max={MAX_SLOTS} readOnly={false} display={<span className="sr-only">{sheet.hpMax}</span>} onChange={(hpMax) => void update({ hpMax })} />
          ) : null}
        </div>
        <Track name="Hit Point" kind="heart" slots={sheet.hpMax} marked={sheet.hp} readOnly={!canEdit} onDelta={(d) => void adjust("hp", d)} />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="cs-lbl">
            Stress <span className="normal-case">{sheet.stress} / {sheet.stressMax}</span>
          </span>
          {canEdit ? (
            <Stepper
              label="Stress slots"
              value={sheet.stressMax}
              min={1}
              max={MAX_SLOTS}
              readOnly={false}
              display={<span className="sr-only">{sheet.stressMax}</span>}
              onChange={(stressMax) => void update({ stressMax })}
            />
          ) : null}
        </div>
        <Track name="Stress" kind="diamond" slots={sheet.stressMax} marked={sheet.stress} readOnly={!canEdit} onDelta={(d) => void adjust("stress", d)} />
        {sheet.stress >= sheet.stressMax ? <span className="cs-small font-bold text-[#8e2b2b]">All Stress marked: Vulnerable.</span> : null}
      </div>
      <WitherCounter {...slot} />
    </SheetBox>
  );
}
