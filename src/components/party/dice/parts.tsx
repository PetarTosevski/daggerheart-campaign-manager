"use client";

import type { RolledDie, RollRecord } from "@/lib/domain/duality";
import { OUTCOME_LABEL } from "@/lib/domain/dice";

import { useDiceSettings } from "./settings";

const ROLE_LABEL: Record<RolledDie["role"], string> = {
  hope: "Hope",
  fear: "Fear",
  advantage: "Advantage",
  disadvantage: "Disadvantage",
  help: "Help",
  extra: "Extra",
  damage: "Damage",
};

const ROLE_STYLE: Record<RolledDie["role"], string> = {
  hope: "border-[#c9a227] bg-[#fff4cf] text-[#5a4300]",
  fear: "border-[#6a4fb3] bg-[#ece4ff] text-[#2f1f66]",
  advantage: "border-[#3d7a4a] bg-[#e3f4e6] text-[#1d4a27]",
  disadvantage: "border-[#a14040] bg-[#fbe4e4] text-[#5e1b1b]",
  help: "border-[#3d7a4a] bg-[#e3f4e6] text-[#1d4a27]",
  extra: "border-[#7a6a52] bg-[#f3ecdf] text-[#3b2f1e]",
  damage: "border-[#8a5a2b] bg-[#f8e8d6] text-[#4a2c10]",
};

/** The dice of a roll as small labelled faces; dropped dice are struck through. */
export function DiceFaces({ dice }: { dice: readonly RolledDie[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Dice">
      {dice.map((d, i) => (
        <li
          // Dice have no ids; their order within a stored roll never changes.
          key={`${i}-${d.role}`}
          className={`inline-flex min-w-9 items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[14px] ${ROLE_STYLE[d.role]} ${d.dropped ? "line-through opacity-60" : ""}`}
          aria-label={`${ROLE_LABEL[d.role]} d${d.sides}: ${d.value}${d.dropped ? " (not counted)" : ""}`}
        >
          {d.value}
          <span className="text-[10px] opacity-70">d{d.sides}</span>
        </li>
      ))}
    </ul>
  );
}

/** "17 with Hope · success" style headline of a roll. */
export function rollHeadline(roll: RollRecord): string {
  const outcome = roll.outcome === "none" ? "" : ` · ${OUTCOME_LABEL[roll.outcome]}`;
  const vs = roll.difficulty !== undefined ? ` vs ${roll.difficulty}` : "";
  return `${roll.total}${vs}${outcome}`;
}

/** The per-device 3D and sound toggles (decision 3). */
export function DiceSettingsToggles({ className = "" }: { className?: string }) {
  const [settings, update] = useDiceSettings();
  return (
    <div className={`flex flex-wrap items-center gap-4 text-[14px] ${className}`}>
      <label className="flex min-h-10 items-center gap-2">
        <input type="checkbox" className="size-4" checked={settings.threeD} onChange={(e) => update({ threeD: e.target.checked })} />
        3D dice
      </label>
      <label className="flex min-h-10 items-center gap-2">
        <input type="checkbox" className="size-4" checked={settings.sound} onChange={(e) => update({ sound: e.target.checked })} />
        Dice sound
      </label>
    </div>
  );
}

/** A labelled − value + stepper for small counts (advantage, help). */
export function CountStepper({ label, value, min = 0, max, onChange, disabled }: { label: string; value: number; min?: number; max: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="cs-lbl min-w-[7.5rem]">{label}</span>
      <button type="button" className="cs-pill !min-h-9 !px-3" aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output className="min-w-6 text-center font-display text-[18px]" aria-live="polite">
        {value}
      </output>
      <button type="button" className="cs-pill !min-h-9 !px-3" aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}
