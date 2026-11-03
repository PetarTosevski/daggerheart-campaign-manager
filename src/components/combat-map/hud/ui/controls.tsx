"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { hudButtonClass } from "./popup";

/**
 * Interactive HUD primitives (boards CmpPromptsPlayer / CmpPicking): Stepper (`.step`), Toggle (`.pk-tog` rows),
 * ChoiceRow (`.opt` with a radio or a box) and TwoTapButton (`.twotap`). Each reports an intent (a step of ±1, the new
 * checked value, a select, a confirmed press); the caller owns the value (CL3, CL7).
 */

export type StepperProps = {
  value: number;
  min: number;
  max: number;
  /** One step down (-1) or up (+1); never called past min / max. */
  onStep: (delta: -1 | 1) => void;
  /** What the number counts ("Hope to spend"): names the group and the two buttons. */
  label: string;
  disabled?: boolean;
};

export function Stepper({ value, min, max, onStep, label, disabled = false }: StepperProps) {
  return (
    <span className="hud-step" role="group" aria-label={label}>
      <button type="button" aria-label={`Less ${label}`} disabled={disabled || value <= min} onClick={() => onStep(-1)}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label={`More ${label}`} disabled={disabled || value >= max} onClick={() => onStep(1)}>
        +
      </button>
    </span>
  );
}

export type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The option ("If it hits, also Restrain the Bandit"). */
  label: ReactNode;
  /** A muted line under the label ("Very Close to the Lieutenant"). */
  note?: ReactNode;
  /** Right of the label: usually a CostPill. */
  end?: ReactNode;
  disabled?: boolean;
};

/** A switch row: the whole row is the switch, so the label is its accessible name. */
export function Toggle({ checked, onChange, label, note, end, disabled = false }: ToggleProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="hud-tog" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="hud-tog-track" aria-hidden="true">
        <i />
      </span>
      <span className="hud-tog-text">
        {label}
        {note ? <small>{note}</small> : null}
      </span>
      {end}
    </button>
  );
}

export type ChoiceRowProps = {
  /** radio: one of a group (wrap the rows in role="radiogroup"); checkbox: any number. */
  type: "radio" | "checkbox";
  checked: boolean;
  onSelect: () => void;
  label: ReactNode;
  /** Right-aligned muted note ("3 Hope", "auto", "once per scene"). */
  note?: ReactNode;
  disabled?: boolean;
};

export function ChoiceRow({ type, checked, onSelect, label, note, disabled = false }: ChoiceRowProps) {
  return (
    <button type="button" role={type} aria-checked={checked} className="hud-opt" disabled={disabled} onClick={onSelect}>
      <span className={cn("hud-opt-mark", type === "checkbox" && "hud-opt-box")} aria-hidden="true">
        {type === "checkbox" && checked ? (
          <svg viewBox="0 0 12 12">
            <path d="M2.5 6.2 5 8.6 9.6 3.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      <span className="hud-opt-label">{label}</span>
      {note ? <small>{note}</small> : null}
    </button>
  );
}

export type TwoTapButtonProps = {
  /** The resting label ("Clear all targets"). */
  label: string;
  /** The armed label ("Click again to clear"). */
  confirmLabel: string;
  /** Called on the second press only. */
  onConfirm: () => void;
  disabled?: boolean;
};

/**
 * A destructive one-tap action that asks for a second tap instead of a dialog (CmpPromptsPlayer "Two-tap actions").
 * The first press arms it; the second fires. Leaving the button (blur) or Escape disarms it; no timers.
 */
export function TwoTapButton({ label, confirmLabel, onConfirm, disabled = false }: TwoTapButtonProps) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className={cn(hudButtonClass("danger"), "hud-twotap")}
      data-armed={armed}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      onBlur={() => setArmed(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && armed) {
          event.stopPropagation();
          setArmed(false);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
