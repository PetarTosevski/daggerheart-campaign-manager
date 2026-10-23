"use client";

import { ROLL_DICE_LIMIT } from "./model";

/**
 * The Attack bar's roll options in the card Use dialog (plan followups-7 H4, dcm-bxp.99.24: "the card Use dialog gets
 * the Attack bar's roll options (Experiences, advantage, Help) for any card that rolls"). Same controls and limits as
 * `actions/attack` (a collapsed "Roll options", Experience chips at 1 Hope each, an Advantage stepper that goes negative
 * for disadvantage, Help dice); the server applies them (`combatCards.useCard`'s `roll`).
 */

export type Roller = { experiences: readonly { id: string; name: string; value: number }[]; hope: number };

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

function Stepper({ label, value, min, max, text, onChange }: { label: string; value: number; min: number; max: number; text: string; onChange: (n: number) => void }) {
  return (
    <div className="cma-stepper" role="group" aria-label={label}>
      <span className="cm-lbl">{label}</span>
      <span className="cma-stepper-row">
        <button type="button" className="cm-btn cm-sm" aria-label={`Less ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <output className="cma-stepper-val" aria-live="polite">
          {text}
        </output>
        <button type="button" className="cm-btn cm-sm" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </span>
    </div>
  );
}

export type RollValues = { experienceIds: readonly string[]; edge: number; help: number };

/** "Not enough Hope for those Experiences." while more Experiences are picked than the character has Hope. */
export function rollProblem(roller: Roller | null, values: RollValues): string | null {
  return roller && values.experienceIds.length > roller.hope ? "Not enough Hope for those Experiences." : null;
}

export function RollOptions({ roller, values, onChange }: { roller: Roller | null; values: RollValues; onChange: (patch: Partial<RollValues>) => void }) {
  const { experienceIds, edge, help } = values;
  return (
    <details className="cma-opts cmh-field" data-testid="combat-card-roll-options">
      <summary className="cm-lbl">Roll options</summary>
      <div className="cma-opts-body">
        {roller && roller.experiences.length > 0 ? (
          <div className="cma-chips" role="group" aria-label="Experiences (1 Hope each)">
            <span className="cm-lbl">Experiences (1 Hope each)</span>
            {roller.experiences.map((e) => {
              const on = experienceIds.includes(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  className="cm-chip"
                  aria-pressed={on}
                  onClick={() => onChange({ experienceIds: on ? experienceIds.filter((id) => id !== e.id) : [...experienceIds, e.id] })}
                >
                  {e.name} ({signed(e.value)})
                </button>
              );
            })}
          </div>
        ) : null}
        <Stepper
          label="Advantage"
          value={edge}
          min={-ROLL_DICE_LIMIT}
          max={ROLL_DICE_LIMIT}
          text={edge === 0 ? "Normal" : edge > 0 ? `Advantage ×${edge}` : `Disadvantage ×${-edge}`}
          onChange={(n) => onChange({ edge: n })}
        />
        <Stepper label="Help dice" value={help} min={0} max={ROLL_DICE_LIMIT} text={String(help)} onChange={(n) => onChange({ help: n })} />
      </div>
    </details>
  );
}
