"use client";

import type { CSSProperties, ReactNode } from "react";

import { assetBackground } from "@/lib/design-assets";

import { pipDelta } from "./sheet-helpers";

/**
 * A text field saved on blur. Read-only viewers get plain text. The input
 * remounts when the saved value changes, so live edits from others show up.
 */
export function TextField({
  label,
  value,
  onSave,
  readOnly,
  placeholder,
  multiline = false,
  hideLabel = false,
  maxLength,
  rows,
  labelClassName,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
  readOnly: boolean;
  placeholder?: string;
  multiline?: boolean;
  hideLabel?: boolean;
  maxLength?: number;
  rows?: number;
  labelClassName?: string;
}) {
  const labelEl = <span className={hideLabel ? "sr-only" : (labelClassName ?? "cs-lbl")}>{label}</span>;
  if (readOnly) {
    return (
      <div className="flex flex-col gap-1">
        {labelEl}
        {multiline ? (
          <p className="cs-ta m-0" style={{ resize: "none", minHeight: rows ? rows * 28 + 14 : 72 }}>
            {value || <span className="text-[#8f7a58] italic">—</span>}
          </p>
        ) : (
          <span className="cs-in cs-ro">{value || <span className="text-[#8f7a58] italic">—</span>}</span>
        )}
      </div>
    );
  }
  const save = (next: string) => {
    if (next !== value) onSave(next);
  };
  return (
    <label className="flex flex-col gap-1">
      {labelEl}
      {multiline ? (
        <textarea
          key={value}
          className="cs-ta"
          defaultValue={value}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={rows}
          onBlur={(e) => save(e.target.value)}
        />
      ) : (
        <input
          key={value}
          className="cs-in"
          defaultValue={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onBlur={(e) => save(e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      )}
    </label>
  );
}

/** "Name: text" for a class, weapon or armor feature. */
export function FeatureText({ name, text }: { name: string; text: string }) {
  return (
    <p className="cs-small m-0 whitespace-pre-line">
      <strong className="font-display text-[14px]">{name}:</strong> {text}
    </p>
  );
}

/** − value + control; read-only shows the value alone. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  readOnly,
  display,
  className = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  readOnly: boolean;
  display?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`} role="group" aria-label={label}>
      {readOnly ? null : (
        <button type="button" className="cs-step" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
      )}
      <strong className="min-w-8 text-center font-display text-[20px]" aria-live="polite">
        {display ?? value}
      </strong>
      {readOnly ? null : (
        <button type="button" className="cs-step" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      )}
    </div>
  );
}

const HOPE_COIN = { "--coin": assetBackground("adec0ee116c933de010a35432e8e5e36") } as CSSProperties;

/**
 * A track of slots (hearts, diamonds, armor, Hope coins). Tapping a slot marks
 * up to it; tapping the last marked one clears it. `lost` trailing slots are
 * shown as scarred and can't be used.
 */
export function Track({
  name,
  kind,
  slots,
  marked,
  lost = 0,
  onDelta,
  readOnly,
}: {
  name: string;
  kind: "heart" | "diamond" | "armor" | "coin";
  slots: number;
  marked: number;
  lost?: number;
  onDelta: (delta: number) => void;
  readOnly: boolean;
}) {
  const usable = slots - lost;
  const summary = `${name}: ${marked} of ${usable} marked${lost ? `, ${lost} lost to scars` : ""}`;
  const style = kind === "coin" ? HOPE_COIN : undefined;
  if (readOnly) {
    return (
      <div className="cs-slot-row" role="img" aria-label={summary} style={style}>
        {Array.from({ length: slots }, (_, k) => (
          <span key={k} aria-hidden="true" className={`cs-pip ${k >= usable ? "cs-scar" : `cs-${kind}${k < marked ? " on" : ""}`}`} />
        ))}
      </div>
    );
  }
  return (
    <div className="cs-slot-row" role="group" aria-label={summary} style={style}>
      {Array.from({ length: slots }, (_, k) => {
        if (k >= usable) {
          return <span key={k} className="cs-pip cs-scar" role="img" aria-label={`${name} slot lost to a scar`} />;
        }
        const on = k < marked;
        return (
          <button
            key={k}
            type="button"
            className={`cs-pip cs-${kind}${on ? " on" : ""}`}
            aria-label={`${name} ${k + 1} of ${usable}`}
            aria-pressed={on}
            onClick={() => onDelta(pipDelta(k + 1, marked))}
          />
        );
      })}
    </div>
  );
}
