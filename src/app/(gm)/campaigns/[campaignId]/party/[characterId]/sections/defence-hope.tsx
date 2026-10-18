"use client";

import "./defence-hope.css";

import { useState } from "react";

import { HopeFeatureSlot } from "@/components/party/features";
import { HOPE_COIN_STYLE, Label, PaperNumber, Pip, SheetBox, Small } from "@/components/party/sheet-ui";
import { BASE_HOPE_MAX, hopeMax, scarsMax } from "@/lib/domain/characters";
import type { ClassDef } from "@/lib/srd";
import { cn } from "@/lib/utils";

import { useDefense, useSheet } from "../sheet-context";
import { pipDelta } from "../sheet-helpers";

// Defence | Hope row of page 1, in the board's format (Party.dc.html "Defence" and "Hope" boxes). The Hope feature
// block (HopeFeatureSlot) is S6's.

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

/** The editable base Evasion; the field re-syncs from the sheet only while it is not being edited (CL7). */
function BaseEvasionInput() {
  const { sheet, update } = useSheet();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="dh-base">
      <Label>Base Evasion</Label>
      <PaperNumber
        className="dh-base-in"
        value={draft ?? String(sheet.evasion)}
        onFocus={() => setDraft(String(sheet.evasion))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          const v = Number.parseInt(e.target.value, 10);
          setDraft(null);
          if (Number.isInteger(v) && v >= 0 && v <= 40 && v !== sheet.evasion) void update({ evasion: v });
        }}
      />
    </label>
  );
}

export function DefenceBox() {
  const { sheet, canEdit, adjust } = useSheet();
  const { defense, effectEvasion, armorSlots } = useDefense();
  const modifiers = [
    defense.evasionModifier ? `(${signed(defense.evasionModifier)} gear)` : null,
    defense.subclassEvasion ? `(+${defense.subclassEvasion} subclass)` : null,
    effectEvasion ? `(${signed(effectEvasion)} effects)` : null,
  ].filter(Boolean);
  const armorSummary = `Armor Slot: ${sheet.armorMarked} of ${armorSlots} marked`;
  return (
    <SheetBox title="Defence" className="dh-box">
      <div className="dh-def">
        <div className="dh-stat">
          <span className="sh-num dh-circle" role="img" aria-label={`Evasion ${defense.evasion}`} data-testid="evasion">
            {defense.evasion}
          </span>
          <Label>Evasion</Label>
          {modifiers.length ? <Small className="dh-mods">{modifiers.join(" ")}</Small> : null}
          {canEdit ? <BaseEvasionInput /> : null}
        </div>
        <div className="dh-stat">
          <span className="sh-num dh-circle" role="img" aria-label={`Armor Score ${armorSlots}`}>
            {armorSlots}
          </span>
          <Label>Armor</Label>
        </div>
        <div className="dh-slots">
          <Label>Armor slots</Label>
          {armorSlots > 0 ? (
            <div className="dh-armor" role={canEdit ? "group" : "img"} aria-label={armorSummary}>
              {Array.from({ length: armorSlots }, (_, k) =>
                canEdit ? (
                  <Pip
                    key={k}
                    kind="armor"
                    on={k < sheet.armorMarked}
                    label={`Armor Slot ${k + 1} of ${armorSlots}`}
                    onClick={() => void adjust("armor", pipDelta(k + 1, sheet.armorMarked))}
                  />
                ) : (
                  <Pip key={k} kind="armor" on={k < sheet.armorMarked} />
                ),
              )}
            </div>
          ) : (
            <Small className="italic">Unarmored: no Armor Slots.</Small>
          )}
        </div>
      </div>
    </SheetBox>
  );
}

/**
 * The Hope coin row: 6 coins plus Light in the Dark's 7th (gold ring), trailing slots lost to scars shown as the
 * board's split coin. Editors tap a coin to mark up to it (tapping the last marked one clears it).
 */
function HopeCoins() {
  const { sheet, canEdit, adjust } = useSheet();
  const bonus = sheet.hopeSlotBonus ?? 0;
  const slots = BASE_HOPE_MAX + bonus;
  const usable = hopeMax(sheet.scars, bonus);
  const lost = slots - usable;
  const summary = `Hope: ${sheet.hope} of ${usable} marked${lost ? `, ${lost} lost to scars` : ""}`;
  return (
    <div className="dh-coins" role={canEdit ? "group" : "img"} aria-label={summary} style={HOPE_COIN_STYLE}>
      {Array.from({ length: slots }, (_, k) => {
        const litd = k >= BASE_HOPE_MAX;
        const title = litd ? "Light in the Dark" : undefined;
        if (k >= usable) {
          return canEdit ? (
            <span key={k} className={cn("sh-pip dh-scar", litd && "dh-litd")} title={title} role="img" aria-label="Hope slot lost to a scar" />
          ) : (
            <span key={k} className={cn("sh-pip dh-scar", litd && "dh-litd")} title={title} aria-hidden="true" />
          );
        }
        const on = k < sheet.hope;
        const cls = cn("sh-pip coin", on && "on", litd && "dh-litd");
        return canEdit ? (
          <button
            key={k}
            type="button"
            className={cls}
            title={title}
            aria-label={`Hope ${k + 1} of ${usable}`}
            aria-pressed={on}
            onClick={() => void adjust("hope", pipDelta(k + 1, sheet.hope))}
          />
        ) : (
          <span key={k} className={cls} title={title} aria-hidden="true" />
        );
      })}
    </div>
  );
}

export function HopeBox({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, canEdit, adjust, slot } = useSheet();
  const bonus = sheet.hopeSlotBonus ?? 0;
  const maxHope = hopeMax(sheet.scars, bonus);
  return (
    <SheetBox title="Hope" className="dh-box">
      <div className="dh-hope-head">
        <Small>
          Hope max <strong className={cn("dh-max", sheet.scars > 0 && "scarred")}>{maxHope}</strong>
        </Small>
        <span className="dh-scars" role="group" aria-label="Scars">
          <Label className="dh-scars-lbl">Scars</Label>
          {canEdit ? (
            <button type="button" className="dh-step" aria-label="Decrease Scars" disabled={sheet.scars <= 0} onClick={() => void adjust("scars", -1)}>
              −
            </button>
          ) : null}
          <strong className="dh-scars-n" aria-live="polite">
            {sheet.scars}
          </strong>
          {canEdit ? (
            <button
              type="button"
              className="dh-step"
              aria-label="Increase Scars"
              disabled={sheet.scars >= scarsMax(bonus)}
              onClick={() => void adjust("scars", 1)}
            >
              +
            </button>
          ) : null}
        </span>
      </div>
      <HopeCoins />
      <Small as="div" className="dh-rules">
        <span>Spend a Hope to use an Experience or help an ally.</span>
        <span>Spend 3 Hope to make a tag team roll or use your class’ Hope feature.</span>
      </Small>
      {cls ? (
        <div className="dh-feat">
          <Label>Class Hope feature</Label>
          <p className="sh-ta dh-feat-text">
            <strong>{cls.hopeFeature.name}:</strong> {cls.hopeFeature.text}
          </p>
        </div>
      ) : null}
      <HopeFeatureSlot {...slot} />
    </SheetBox>
  );
}
