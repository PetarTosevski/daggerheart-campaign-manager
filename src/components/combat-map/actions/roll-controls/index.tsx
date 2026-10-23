"use client";

/**
 * The duality roll controls shared by the Attack bar (`actions/attack`) and the Hand's roll-options strip
 * (`actions/hand`) (plan followups-8 I1, dcm-bxp.99.27: one component instead of the copy F7-H4 made). A collapsed
 * "Roll options" holds the Experience chips (1 Hope each, CB p.90), an Advantage stepper that goes negative for
 * disadvantage, and Help dice; the server applies them. `Stepper` is also the Minion pick dialog's counter.
 */

/** The most advantage, disadvantage or Help dice the controls offer (the dice box's limit). */
export const ROLL_DICE_LIMIT = 6;

/** "+2", "−1". */
export const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

/** The acting character's Experiences and Hope (null while unknown: no Experience chips, no Hope check). */
export type Roller = { experiences: readonly { id: string; name: string; value: number }[]; hope: number };

/** The controls' values: Experiences used, advantage (negative: disadvantage), Help dice. */
export type RollValues = { experienceIds: readonly string[]; edge: number; help: number };

export const NO_ROLL_OPTIONS: RollValues = { experienceIds: [], edge: 0, help: 0 };

/** "Not enough Hope for those Experiences." while more Experiences are picked than the character has Hope. */
export function rollProblem(roller: Roller | null, values: RollValues): string | null {
  return roller && values.experienceIds.length > roller.hope ? "Not enough Hope for those Experiences." : null;
}

/** "Advantage ×2", "Disadvantage ×1", "Normal". */
export function edgeLabel(edge: number): string {
  return edge === 0 ? "Normal" : edge > 0 ? `Advantage ×${edge}` : `Disadvantage ×${-edge}`;
}

/** "Advantage ×1 · 2 Experiences · 1 Help die", or null when nothing is set. */
export function rollSummary(values: RollValues): string | null {
  const parts: string[] = [];
  if (values.edge !== 0) parts.push(edgeLabel(values.edge));
  const n = values.experienceIds.length;
  if (n > 0) parts.push(`${n} Experience${n === 1 ? "" : "s"}`);
  if (values.help > 0) parts.push(`${values.help} Help ${values.help === 1 ? "die" : "dice"}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** A labelled − n + stepper in the map's style (advantage, help dice, Minions). */
export function Stepper({ label, value, min, max, text, onChange }: { label: string; value: number; min: number; max: number; text: string; onChange: (n: number) => void }) {
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

/** The collapsed "Roll options": Experience chips, Advantage and Help dice. */
export function RollOptions({
  roller,
  values,
  onChange,
  className,
  testId,
  hint,
}: {
  roller: Roller | null;
  values: RollValues;
  onChange: (patch: Partial<RollValues>) => void;
  /** Extra classes on the `<details>`. */
  className?: string;
  testId?: string;
  /** A line inside, under the controls (the Hand: "Applies to the next card that rolls."). */
  hint?: string;
}) {
  const { experienceIds, edge, help } = values;
  const summary = rollSummary(values);
  return (
    <details className={className ? `cma-opts ${className}` : "cma-opts"} data-testid={testId}>
      <summary className="cm-lbl">
        Roll options{summary ? <span className="cma-opts-set"> · {summary}</span> : null}
      </summary>
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
        <Stepper label="Advantage" value={edge} min={-ROLL_DICE_LIMIT} max={ROLL_DICE_LIMIT} text={edgeLabel(edge)} onChange={(n) => onChange({ edge: n })} />
        <Stepper label="Help dice" value={help} min={0} max={ROLL_DICE_LIMIT} text={String(help)} onChange={(n) => onChange({ help: n })} />
        {hint ? <p className="cm-muted cma-small cma-note">{hint}</p> : null}
      </div>
    </details>
  );
}
