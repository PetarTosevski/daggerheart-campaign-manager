"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { Modal } from "@/components/brand/modal";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  LIST_KEYS,
  LIST_LABEL,
  askFear,
  capOf,
  choiceArgs,
  creaturesFor,
  initialAnswers,
  missing,
  pick,
  pickable,
  pickableUses,
  type Answers,
  type Creature,
  type FeatureAsk,
} from "./ask";

const RANGE_LABEL: Record<string, string> = { melee: "Melee", veryClose: "Very Close", close: "Close", far: "Far", veryFar: "Very Far", weapon: "weapon range", unlimited: "any range" };
const USE_LABEL = { action: "Action", reaction: "Reaction", auto: "Automatic", passive: "Passive" } as const;

export type ChoiceArgs = ReturnType<typeof choiceArgs>;

function countText(cap: number | null, count: string): string {
  if (count === "one") return "pick one";
  return cap === null ? "pick any" : `pick up to ${cap}`;
}

/** One check box per creature of a list (a one-pick list swaps its pick). */
function CreatureList({ legend, creatures, value, cap, onChange }: { legend: string; creatures: readonly Creature[]; value: readonly string[]; cap: number | null; onChange: (ids: string[]) => void }) {
  return (
    <fieldset className="trk-ask-set">
      <legend>{legend}</legend>
      {creatures.length === 0 ? <p className="trk-ask-note">No one to pick.</p> : null}
      {creatures.map((c) => (
        <label key={c.id} className="trk-ask-opt">
          <input
            type={cap === 1 ? "radio" : "checkbox"}
            name={legend}
            checked={value.includes(c.id)}
            disabled={!value.includes(c.id) && cap !== null && cap !== 1 && value.length >= cap}
            onChange={() => onChange(pick(value, c.id, cap))}
          />
          <span>{c.name}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** The form for one use; its own component so picking another use starts its answers fresh. */
function ChoicesForm({
  ask,
  actor,
  self,
  creatures,
  panelTargets,
  fear,
  pending,
  onUse,
  onCancel,
}: {
  ask: FeatureAsk;
  actor: string;
  self: string;
  creatures: readonly Creature[];
  panelTargets: readonly string[];
  fear: number;
  pending: boolean;
  onUse: (args: ChoiceArgs) => void;
  onCancel: () => void;
}) {
  const [a, setA] = useState<Answers>(() => initialAnswers(ask, panelTargets));
  const set = (patch: Partial<Answers>) => setA({ ...a, ...patch });
  const nameOf = (id: string) => creatures.find((c) => c.id === id)?.name ?? "someone";
  const todo = missing(ask, a);
  const total = askFear(ask, a);
  const t = ask.trigger;

  return (
    <form
      className="trk-dialog trk-ask"
      onSubmit={(e) => {
        e.preventDefault();
        if (todo.length === 0) onUse(choiceArgs(ask, a, panelTargets));
      }}
    >
      {!ask.automated && ask.text ? <p className="trk-muted">{ask.text}</p> : null}
      {t?.text ? <p className="trk-ask-trigger">When: {t.text}</p> : null}

      {LIST_KEYS.map((key) => {
        const list = ask[key];
        if (list === null) return null;
        if (list.count === "all") {
          return (
            <p key={key} className="trk-ask-note">
              {LIST_LABEL[key]}: every PC within {RANGE_LABEL[list.range] ?? list.range}.
            </p>
          );
        }
        if (!pickable(list)) return null;
        const cap = capOf(list);
        return (
          <CreatureList
            key={key}
            legend={`${LIST_LABEL[key]} (${countText(cap, list.count)}, ${RANGE_LABEL[list.range] ?? list.range})`}
            creatures={creaturesFor(list, creatures, self)}
            value={a[key]}
            cap={cap}
            onChange={(ids) => set({ [key]: ids })}
          />
        );
      })}

      {t && (t.source || t.subject) ? (
        <div className="trk-ask-row">
          {(["source", "subject"] as const)
            .filter((k) => t[k])
            .map((k) => (
              <label key={k} className="trk-ask-field">
                <span>{k === "source" ? "Who set it off" : "Who it's about"}</span>
                <select
                  className="trk-in"
                  value={k === "source" ? a.trigger.sourceId : a.trigger.subjectId}
                  onChange={(e) => set({ trigger: { ...a.trigger, [k === "source" ? "sourceId" : "subjectId"]: e.target.value } })}
                >
                  <option value="">Nobody named</option>
                  {creatures.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
      ) : null}
      {t?.amount ? (
        <label className="trk-ask-field">
          <span>Trigger amount</span>
          <input className="trk-in trk-in-num" type="number" min={0} inputMode="numeric" value={a.trigger.amount} onChange={(e) => set({ trigger: { ...a.trigger, amount: e.target.value } })} />
        </label>
      ) : null}

      {ask.options.map((o) => {
        const cap = o.count;
        const value = a.options[o.id] ?? [];
        return (
          <fieldset key={o.id} className="trk-ask-set">
            <legend>
              {o.label} ({cap === null ? "decided as it runs; pick any" : cap === 1 ? "pick one" : `pick ${cap}`})
            </legend>
            {o.options.map((opt) => (
              <label key={opt.id} className="trk-ask-opt">
                <input
                  type={cap === 1 ? "radio" : "checkbox"}
                  name={`option-${o.id}`}
                  checked={value.includes(opt.id)}
                  disabled={!value.includes(opt.id) && cap !== null && cap !== 1 && value.length >= cap}
                  onChange={() => set({ options: { ...a.options, [o.id]: pick(value, opt.id, cap) } })}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </fieldset>
        );
      })}

      {ask.eitherCosts.map((entry, i) => (
        <fieldset key={entry.index} className="trk-ask-set">
          <legend>Pay one</legend>
          {entry.options.map((opt) => (
            <label key={opt.index} className="trk-ask-opt">
              <input type="radio" name={`either-${entry.index}`} checked={a.eitherCosts[i] === opt.index} onChange={() => set({ eitherCosts: a.eitherCosts.map((x, j) => (j === i ? opt.index : x)) })} />
              <span>{opt.label}</span>
            </label>
          ))}
        </fieldset>
      ))}

      {ask.splits.map((s, i) => {
        const ids = s.among === "targets" ? (pickable(ask.targets) ? a.targets : panelTargets) : LIST_KEYS.includes(s.among as never) ? a[s.among as keyof Pick<Answers, "picked" | "allies" | "followUp">] : [];
        return (
          <fieldset key={i} className="trk-ask-set">
            <legend>{s.what === "damage" ? "Divide the damage" : `Divide the ${s.track ?? "marks"} cleared`} (rolled as it runs; leave empty to split later)</legend>
            {ids.length === 0 ? <p className="trk-ask-note">Pick the {s.among} first.</p> : null}
            {ids.map((id) => (
              <label key={id} className="trk-ask-field">
                <span>{nameOf(id)}</span>
                <input
                  className="trk-in trk-in-num"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={a.splits[id] ?? ""}
                  onChange={(e) => set({ splits: { ...a.splits, [id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) } })}
                />
              </label>
            ))}
          </fieldset>
        );
      })}

      {ask.optionals.length > 0 ? (
        <fieldset className="trk-ask-set">
          <legend>Optional (off unless ticked)</legend>
          {ask.optionals.map((o) => (
            <label key={o.id} className="trk-ask-opt">
              <input type="checkbox" checked={a.optionals.includes(o.id)} onChange={() => set({ optionals: pick(a.optionals, o.id, null) })} />
              <span>
                {o.label}
                {o.fear ? ` (${o.fear} Fear)` : ""}
                {o.stress ? ` (${o.stress} Stress)` : ""}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {ask.situations.length > 0 ? (
        <fieldset className="trk-ask-set">
          <legend>True right now?</legend>
          {ask.situations.map((s) => (
            <label key={`${s.feature}-${s.text}`} className="trk-ask-opt">
              <input type="checkbox" checked={a.situations.includes(s.text)} onChange={() => set({ situations: pick(a.situations, s.text, null) })} />
              <span>
                {s.text}
                {s.feature !== ask.feature ? ` (${s.feature})` : ""}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <p className="trk-ask-cost" data-testid="feature-ask-cost">
        {total > 0 ? `Asks ${total} Fear (you hold ${fear}).` : "No Fear up front."}
        {ask.stress > 0 ? ` ${actor} marks ${ask.stress} Stress.` : ""}
        {ask.needsSpotlight && !ask.spotlit ? " Takes the spotlight." : ""}
      </p>
      {todo.length > 0 ? (
        <p className="trk-ask-note" role="status">
          {todo.join(". ")}.
        </p>
      ) : null}
      <div className="trk-ask-row">
        <button type="submit" className="trk-btn trk-btn-attack" disabled={pending || todo.length > 0}>
          Use {ask.feature}
        </button>
        <button type="button" className="trk-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The GM's choices for one feature use, asked before `useFeature` (plan combat-actions AA3b; user answer 2026-10-22:
 * "features that need choices ask in a dialog built from featureAsk"). Built from AA2c's `featureAsk`: the use (for a
 * feature with more than one), the creature lists, one group per `choose` step, `either` costs, damage splits, the
 * hand-fired trigger, optional steps (off: Q19 default No) and situations to confirm. "Use" sends the answers; a Fear
 * cost is still asked by the panel's "Spend N Fear?" question afterwards.
 */
export function FeatureChoices({
  campaignId,
  instanceId,
  actor,
  first,
  creatures,
  panelTargets,
  fear,
  pending,
  onUse,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  instanceId: string;
  actor: string;
  /** The row's featureAsk for the default use (shown while another use loads). */
  first: FeatureAsk;
  creatures: readonly Creature[];
  panelTargets: readonly string[];
  fear: number;
  pending: boolean;
  onUse: (args: ChoiceArgs) => void;
  onClose: () => void;
}) {
  const [useId, setUseId] = useState(first.useId);
  const other = useQuery(api.adversaryActions.featureAsk, useId === first.useId ? "skip" : { campaignId, instanceId, feature: first.feature, use: useId });
  const ask = useId === first.useId ? first : other;
  const uses = pickableUses(first);

  return (
    <Modal open onClose={onClose} title={`${actor}: ${first.feature}`}>
      {uses.length > 1 ? (
        <fieldset className="trk-ask-set trk-dialog">
          <legend>Which use</legend>
          {uses.map((u, i) => (
            <label key={u.id} className="trk-ask-opt">
              <input type="radio" name="feature-use" checked={useId === u.id} onChange={() => setUseId(u.id)} />
              <span>
                {USE_LABEL[u.activation]} {i + 1}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {ask === undefined ? (
        <p role="status" className="trk-muted">
          Loading the choices…
        </p>
      ) : !ask.available ? (
        <p className="trk-ask-err">{ask.unavailable.join(". ")}</p>
      ) : (
        <ChoicesForm key={ask.useId} ask={ask} actor={actor} self={instanceId} creatures={creatures} panelTargets={panelTargets} fear={fear} pending={pending} onUse={onUse} onCancel={onClose} />
      )}
    </Modal>
  );
}
