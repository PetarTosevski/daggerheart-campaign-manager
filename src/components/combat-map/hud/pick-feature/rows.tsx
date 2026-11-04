"use client";

import { useId } from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { askKey, type ChoiceAsk, type FormValues, type RecipientKey, type UseForm } from "../../actions/hand/model";
import { Stepper } from "../ui";

/**
 * The feature picker's extra rows (plan combat-hud H3.3), between the targets and the switches of the picking panel:
 * what a use asks before it runs (its trait, numbers, choices before the roll, cost options, a weapon, allies it affects,
 * the GM's Difficulty) and, after the roll, the server's asks (a choice, a damage split). Chips are toggle buttons
 * (`aria-pressed`); each change is the caller's `onChange` with the next state (kept in the session's data).
 */

type FormData = Omit<FormValues, "targets" | "situations" | "optionals">;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Chips<T extends string | number>({ label, items, value, onPick }: { label: string; items: readonly { id: T; label: string }[]; value: readonly T[]; onPick: (id: T) => void }) {
  return (
    <fieldset className="hud-pf-group">
      <legend>{label}</legend>
      <div className="hud-pf-chips">
        {items.map((it) => (
          <button key={String(it.id)} type="button" className="hud-pf-chip" aria-pressed={value.includes(it.id)} onClick={() => onPick(it.id)}>
            {it.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function FormRows({
  form,
  data,
  gm,
  recipients,
  onChange,
}: {
  form: UseForm;
  data: FormData;
  gm: boolean;
  recipients: (side: string) => readonly { tokenId: Id<"combatTokens">; name: string; side: string }[];
  onChange: (next: FormData) => void;
}) {
  const diffId = useId();
  return (
    <>
      {form.traits ? (
        <Chips label="Trait" items={form.traits.map((t) => ({ id: t, label: cap(t) }))} value={data.trait ? [data.trait] : []} onPick={(t) => onChange({ ...data, trait: t })} />
      ) : null}
      {form.weapon ? (
        <Chips
          label="Weapon"
          items={[
            { id: "primary" as const, label: "Primary" },
            { id: "secondary" as const, label: "Secondary" },
          ]}
          value={data.weapon ? [data.weapon] : []}
          onPick={(w) => onChange({ ...data, weapon: w })}
        />
      ) : null}
      {form.numbers.map((n) => (
        <div key={n.id} className="hud-pf-row">
          <span className="hud-pf-lbl">{n.label}</span>
          <Stepper
            label={n.label}
            value={data.numbers[n.id] ?? n.min}
            min={n.min}
            max={n.max ?? 10}
            onStep={(d) => onChange({ ...data, numbers: { ...data.numbers, [n.id]: (data.numbers[n.id] ?? n.min) + d } })}
          />
        </div>
      ))}
      {form.eithers.map((e) => (
        <Chips
          key={e.index}
          label="Pay with"
          items={e.options.map((o, i) => ({ id: i, label: o }))}
          value={[data.eithers[e.index] ?? 0]}
          onPick={(i) => onChange({ ...data, eithers: { ...data.eithers, [e.index]: i } })}
        />
      ))}
      {form.choose.map((c) => {
        const picked = data.options[c.stepId] ?? [];
        return (
          <Chips
            key={c.stepId}
            label={c.label}
            items={c.options}
            value={picked}
            onPick={(id) => {
              const max = c.count ?? c.options.length;
              const next = picked.includes(id) ? picked.filter((x) => x !== id) : max === 1 ? [id] : picked.length < max ? [...picked, id] : picked;
              onChange({ ...data, options: { ...data.options, [c.stepId]: next } });
            }}
          />
        );
      })}
      {form.recipients.map((r) => {
        const picked = data.recipients[r.key] ?? [];
        return (
          <Chips
            key={r.key}
            label={r.label}
            items={recipients(r.side).map((c) => ({ id: c.tokenId as string, label: c.side === "self" ? "You" : c.name }))}
            value={picked}
            onPick={(id) =>
              onChange({ ...data, recipients: { ...data.recipients, [r.key as RecipientKey]: picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id] } })
            }
          />
        );
      })}
      {form.gmDifficulty && gm ? (
        <div className="hud-pf-row">
          <label className="hud-pf-lbl" htmlFor={diffId}>
            Difficulty
          </label>
          <input
            id={diffId}
            className="hud-pf-num"
            type="number"
            min={1}
            value={data.difficulty ?? ""}
            onChange={(e) => onChange({ ...data, difficulty: e.target.value === "" ? undefined : Math.max(1, Math.trunc(Number(e.target.value))) })}
          />
        </div>
      ) : null}
    </>
  );
}

type AskData = { asks: readonly ChoiceAsk[]; options: Record<string, string[]>; splits: Record<string, number> };

/** The server's asks after the roll: a choice (chips), a damage split (steppers); a chain link is the target rows. */
export function AskRows<D extends AskData>({ asks, data, names, onChange }: { asks: readonly ChoiceAsk[]; data: D; names: ReadonlyMap<string, string>; onChange: (next: D) => void }) {
  return (
    <>
      {asks.map((a) => {
        if (a.kind === "followUp") return null;
        if (a.kind === "choose") {
          const key = askKey(a);
          const picked = data.options[key] ?? [];
          const who = a.chooserId ? ` (${names.get(a.chooserId) ?? "an ally"})` : "";
          return <Chips key={key} label={`${a.label}${who}`} items={a.options} value={picked} onPick={(id) => onChange({ ...data, options: { ...data.options, [key]: [id] } })} />;
        }
        return (
          <fieldset key="split" className="hud-pf-group">
            <legend>{a.label}</legend>
            {a.tokenIds.map((id) => (
              <div key={id} className="hud-pf-row">
                <span>{names.get(id) ?? "Target"}</span>
                <Stepper
                  label={`for ${names.get(id) ?? "the target"}`}
                  value={data.splits[id] ?? 0}
                  min={0}
                  max={99}
                  onStep={(d) => onChange({ ...data, splits: { ...data.splits, [id]: (data.splits[id] ?? 0) + d } })}
                />
              </div>
            ))}
          </fieldset>
        );
      })}
    </>
  );
}
