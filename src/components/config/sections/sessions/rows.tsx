"use client";

import type { ReactNode } from "react";

import { glassButtonClass } from "@/components/brand/glass-button";

/**
 * The board's text for the Sessions rows (reference/designs/config/Settings.dc.html, `.s-session`). No 'Day and night
 * clock' row: the user kept the clock manual (config Q4 d), and a row with one choice is not a setting.
 */
export const SESSIONS_TEXT = {
  fearAtStart: {
    label: "GM Fear at the start of a session",
    hint: "Fear carries over between sessions by default.",
    choices: { carry: "Carry over", pcs: "Reset to number of PCs" },
  },
  opensOn: {
    label: "A new session opens on",
    choices: { journal: "Journal", combatMap: "Combat Map" },
  },
  sessionLog: {
    label: "Write the session log from the Combat Map",
    hint: "Rolls, hits, Fear spent and defeats, with times.",
  },
  archive: {
    label: "Archive this campaign",
    hint: "Keeps everything read-only. You can restore it later.",
    button: "Archive…",
  },
} as const;

/** A row's label and its optional hint (the design's `.row-t`). */
export function RowText({ label, hint }: { label: string; hint?: string }): ReactNode {
  return (
    <div className="cfg-row-t">
      <b>{label}</b>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}

/**
 * A segmented choice row (the design's `.row.col` + `.seg2`): glass neutral buttons with `aria-pressed`. Clicking the
 * current choice writes nothing.
 */
export function ChoiceRow<T extends string>({
  label,
  hint,
  choices,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  choices: Readonly<Record<T, string>>;
  value: T;
  onChange: (next: T) => void;
}): ReactNode {
  return (
    <div className="cfg-row cfg-col">
      <RowText label={label} hint={hint} />
      <div className="cfg-seg" role="group" aria-label={label}>
        {(Object.keys(choices) as T[]).map((choice) => (
          <button
            key={choice}
            type="button"
            className={glassButtonClass({ role: "neutral" })}
            aria-pressed={value === choice}
            onClick={() => {
              if (value !== choice) onChange(choice);
            }}
          >
            {choices[choice]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A switch row (the design's `.row` + `.sw`): `<button role="switch" aria-checked>` with the shared `cfg-sw` class. */
export function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (next: boolean) => void }): ReactNode {
  return (
    <div className="cfg-row">
      <RowText label={label} hint={hint} />
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="cfg-sw" onClick={() => onChange(!checked)}>
        <i />
      </button>
    </div>
  );
}
