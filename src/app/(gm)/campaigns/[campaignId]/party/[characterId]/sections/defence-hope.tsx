"use client";

import "./defence-hope.css";

import { HopeFeatureSlot } from "@/components/party/features";
import { SheetBox } from "@/components/party/sheet-ui";
import { BASE_HOPE_MAX, hopeMax } from "@/lib/domain/characters";
import type { ClassDef } from "@/lib/srd";

import { FeatureText, Stepper, Track } from "../fields";
import { useDefense, useSheet } from "../sheet-context";

// Defence | Hope row of page 1. Restyled by S2; the Hope feature block (HopeFeatureSlot) is S6's.

export function DefenceBox() {
  const { sheet, canEdit, update, adjust } = useSheet();
  const { defense, effectEvasion, armorSlots } = useDefense();
  return (
    <SheetBox title="Defence">
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex flex-col items-center gap-1">
          {canEdit ? (
            <label className="flex flex-col items-center gap-1">
              <input
                key={sheet.evasion}
                className="cs-num cs-circle"
                inputMode="numeric"
                defaultValue={sheet.evasion}
                aria-label="Base Evasion"
                onBlur={(e) => {
                  const v = Number.parseInt(e.target.value, 10);
                  if (Number.isInteger(v) && v >= 0 && v <= 40 && v !== sheet.evasion) void update({ evasion: v });
                  else e.target.value = String(sheet.evasion);
                }}
              />
              <span className="cs-lbl">Base Evasion</span>
            </label>
          ) : null}
          <span className="cs-num cs-circle" aria-label={`Evasion ${defense.evasion}`} data-testid="evasion">
            {defense.evasion}
          </span>
          <span className="cs-lbl">
            Evasion
            {defense.evasionModifier ? ` (${defense.evasionModifier > 0 ? "+" : ""}${defense.evasionModifier} gear)` : ""}
            {defense.subclassEvasion ? ` (+${defense.subclassEvasion} subclass)` : ""}
            {effectEvasion ? ` (${effectEvasion > 0 ? "+" : ""}${effectEvasion} effects)` : ""}
          </span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="cs-num cs-circle" aria-label={`Armor Score ${armorSlots}`}>
            {armorSlots}
          </span>
          <span className="cs-lbl">Armor</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="cs-lbl">Armor slots</span>
          {armorSlots > 0 ? (
            <Track name="Armor Slot" kind="armor" slots={armorSlots} marked={sheet.armorMarked} readOnly={!canEdit} onDelta={(d) => void adjust("armor", d)} />
          ) : (
            <span className="cs-small italic">Unarmored: no Armor Slots.</span>
          )}
        </div>
      </div>
    </SheetBox>
  );
}

export function HopeBox({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, canEdit, adjust, slot } = useSheet();
  const hopeSlots = BASE_HOPE_MAX + (sheet.hopeSlotBonus ?? 0);
  const maxHope = hopeMax(sheet.scars, sheet.hopeSlotBonus ?? 0);
  return (
    <SheetBox title="Hope">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="cs-small">
          Hope max <strong className="font-display text-[20px]">{maxHope}</strong>
        </span>
        <span className="flex items-center gap-2">
          <span className="cs-lbl !text-[#8e2b2b]">Scars</span>
          <Stepper label="Scars" value={sheet.scars} min={0} max={6} readOnly={!canEdit} onChange={(v) => void adjust("scars", v - sheet.scars)} />
        </span>
      </div>
      <Track name="Hope" kind="coin" slots={hopeSlots} lost={hopeSlots - maxHope} marked={sheet.hope} readOnly={!canEdit} onDelta={(d) => void adjust("hope", d)} />
      <div className="cs-small grid grid-cols-1 gap-2 italic sm:grid-cols-2">
        <span>Spend a Hope to use an Experience or help an ally.</span>
        <span>Spend 3 Hope to make a tag team roll or use your class’ Hope feature.</span>
      </div>
      {cls ? (
        <div className="flex flex-col gap-1">
          <span className="cs-lbl">Class Hope feature</span>
          <FeatureText name={cls.hopeFeature.name} text={cls.hopeFeature.text} />
        </div>
      ) : null}
      <HopeFeatureSlot {...slot} />
    </SheetBox>
  );
}
