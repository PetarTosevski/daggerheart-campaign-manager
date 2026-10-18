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

/** A labelled − value + stepper for small counts (help dice), in the board's Adv / Dis stepper style. */
export function CountStepper({ label, value, min = 0, max, onChange, disabled }: { label: string; value: number; min?: number; max: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="dc-stepper" role="group" aria-label={label}>
      <span className="sh-lbl">{label}</span>
      <button type="button" className="dc-step" aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output className="dc-step-val" aria-live="polite">
        {value}
      </output>
      <button type="button" className="dc-step" aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

/**
 * The board's Adv / Dis stepper: one net value, + for advantage and − for disadvantage. The rules only see the
 * net (advantage and disadvantage cancel one for one in `advantagePlan`), so the box sends max(0, ±value).
 */
export function AdvantageStepper({ value, limit, onChange }: { value: number; limit: number; onChange: (n: number) => void }) {
  const text = value === 0 ? "Normal" : value > 0 ? `Advantage ×${value}` : `Disadvantage ×${-value}`;
  return (
    <div className="dc-field dc-adv" role="group" aria-label="Advantage or disadvantage">
      <span className="sh-lbl" aria-hidden="true">
        Adv / Dis
      </span>
      <span className="dc-adv-row">
        <button type="button" className="dc-step" aria-label="More disadvantage" disabled={value <= -limit} onClick={() => onChange(value - 1)}>
          −
        </button>
        <output className="sh-small dc-adv-val" aria-live="polite">
          {text}
        </output>
        <button type="button" className="dc-step" aria-label="More advantage" disabled={value >= limit} onClick={() => onChange(value + 1)}>
          +
        </button>
      </span>
    </div>
  );
}

const TILE_CLASS: Record<RolledDie["role"], string> = {
  hope: "hope",
  fear: "fear",
  advantage: "adv",
  disadvantage: "dis",
  help: "adv",
  extra: "extra",
  damage: "dmg",
};

/** Whether this Duality Die decided the roll (both on a critical): the board rings it. */
function decided(role: RolledDie["role"], outcome: RollRecord["outcome"]): boolean {
  if (outcome === "critical") return role === "hope" || role === "fear";
  if (role === "hope") return outcome === "successHope" || outcome === "failHope";
  if (role === "fear") return outcome === "successFear" || outcome === "failFear";
  return false;
}

/**
 * The dice of a roll as the board's die tiles: big gold Hope and purple Fear dice (ringed when they decided the
 * roll) and smaller tiles for the rest. Same list semantics as DiceFaces: one labelled item per die.
 */
export function DiceTiles({ roll }: { roll: RollRecord }) {
  return (
    <ul className="dc-tiles" aria-label="Dice">
      {roll.dice.map((d, i) => (
        <li
          // Dice have no ids; their order within a stored roll never changes.
          key={`${i}-${d.role}`}
          className={`dc-tile ${TILE_CLASS[d.role]}${decided(d.role, roll.outcome) ? " decided" : ""}${d.dropped ? " dropped" : ""}`}
          aria-label={`${ROLE_LABEL[d.role]} d${d.sides}: ${d.value}${d.dropped ? " (not counted)" : ""}`}
          title={`${ROLE_LABEL[d.role]} d${d.sides}`}
        >
          {d.value}
          {d.role === "hope" || d.role === "fear" ? null : <span className="dc-tile-sides">d{d.sides}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The board's 3D and sound toggles (decision 3): a "3D dice: on" pill and a speaker button, both real checkboxes. */
export function BoardDiceToggles() {
  const [settings, update] = useDiceSettings();
  return (
    <>
      <label className="dc-toggle" title="Throw 3D dice across the screen">
        <input type="checkbox" checked={settings.threeD} onChange={(e) => update({ threeD: e.target.checked })} />
        3D dice<span aria-hidden="true">{settings.threeD ? ": on" : ": off"}</span>
      </label>
      <label className="dc-toggle dc-sound" title={settings.sound ? "Dice sounds on" : "Dice sounds off"}>
        <input type="checkbox" aria-label="Dice sound" checked={settings.sound} onChange={(e) => update({ sound: e.target.checked })} />
        <span aria-hidden="true">{settings.sound ? "🔊" : "🔇"}</span>
      </label>
    </>
  );
}
