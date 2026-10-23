"use client";

import { useState } from "react";

import { Modal } from "@/components/brand/modal";
import type { CardUse } from "@/lib/domain/card-effects/types";
import { TRAIT_LABEL } from "@/lib/frames/extras/common";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { useCombatTargets } from "../targets/state";

import {
  answerChoices,
  choicesOf,
  fitsSide,
  formFor,
  formProblem,
  initialValues,
  RANGE_LABEL,
  rollOf,
  type ChoiceAsk,
  type Creature,
  type FormValues,
  type HandCard,
  type HandUse,
  type RecipientKey,
} from "./model";
import { rollProblem, RollOptions, type Roller } from "./roll-options";
import type { UseRequest } from "./use-card";

/**
 * The Use dialog (plan combat-actions CA6): opens only when the card needs a choice (a grimoire spell, a number of Hope,
 * a cost option, a situation to confirm, an optional part, creatures beyond one enemy, a weapon or trait, the GM's
 * Difficulty) and fires `combatCards.useCard` once with the picks. `AfterRollDialog` answers the server's
 * `needsChoice` (a choose step or a damage split) and resubmits through `useCardActions.answer`.
 *
 * F7-H4 (dcm-bxp.99.24): every creature picked here (targets and the card's other creatures) also gets CA5's target ring
 * on the map (`toggleExtraTarget`), and a card that rolls offers the Attack bar's roll options.
 */

/** Every creature the dialog's answers name (targets and recipients), once each. */
function dialogPicks(values: FormValues): Set<string> {
  return new Set<string>([...values.targets, ...Object.values(values.recipients).flatMap((ids) => ids ?? [])]);
}

const sideWord = (side: string) => (side === "enemy" ? "enemies" : side === "ally" ? "allies" : side === "selfOrAlly" ? "you or allies" : "creatures");

function CreaturePicks({
  legend,
  creatures,
  picked,
  max,
  onChange,
}: {
  legend: string;
  creatures: readonly Creature[];
  picked: readonly string[];
  max: number | null;
  onChange: (ids: string[]) => void;
}) {
  if (creatures.length === 0) {
    return (
      <fieldset className="cmh-field">
        <legend className="cm-lbl">{legend}</legend>
        <p className="cmh-note">No one on the map fits this card.</p>
      </fieldset>
    );
  }
  const single = max === 1;
  return (
    <fieldset className="cmh-field">
      <legend className="cm-lbl">{legend}</legend>
      <div className="cmh-picks">
        {creatures.map((c) => {
          const on = picked.includes(c.tokenId);
          const full = !on && max !== null && !single && picked.length >= max;
          return (
            <button
              key={c.tokenId}
              type="button"
              className="cm-chip cmh-pick"
              aria-pressed={on}
              disabled={full}
              onClick={() => onChange(single ? (on ? [] : [c.tokenId]) : on ? picked.filter((id) => id !== c.tokenId) : [...picked, c.tokenId])}
            >
              {c.side === "self" ? "You" : c.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="cmh-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** The form of one use. Remounted (by key) when the spell changes, so its answers start fresh. */
function UseForm({
  use,
  creatures,
  pickedEnemies,
  gm,
  roller,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  use: CardUse;
  creatures: readonly Creature[];
  pickedEnemies: readonly string[];
  gm: boolean;
  roller: Roller | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (request: Omit<UseRequest, "cardId">) => void;
}) {
  const form = formFor(use);
  const [values, setValues] = useState<FormValues>(() => initialValues(form, pickedEnemies));
  const { targetTokenIds, toggleExtraTarget } = useCombatTargets();
  const problem =
    formProblem(form, values) ?? (form.gmDifficulty && gm && values.difficulty === undefined ? "Set the Difficulty." : null) ?? (form.rolls ? rollProblem(roller, values) : null);

  function set(patch: Partial<FormValues>) {
    setValues((v) => ({ ...v, ...patch }));
  }

  /** A change of picked creatures: the answers, and the map's rings follow (added ones ringed, dropped ones unringed). */
  function pick(patch: Pick<Partial<FormValues>, "targets" | "recipients">) {
    const before = dialogPicks(values);
    const after = dialogPicks({ ...values, ...patch });
    const ringed = new Set<string>(targetTokenIds);
    const tokenOf = new Map<string, Id<"combatTokens">>(creatures.map((c) => [c.tokenId, c.tokenId]));
    for (const id of after) if (!before.has(id) && !ringed.has(id)) toggle(id);
    for (const id of before) if (!after.has(id) && ringed.has(id)) toggle(id);
    set(patch);

    function toggle(id: string) {
      const tokenId = tokenOf.get(id);
      if (tokenId) toggleExtraTarget(tokenId);
    }
  }

  function submit() {
    if (problem) return;
    const roll = rollOf(form, values, gm);
    onSubmit({
      spell: use.id,
      targetTokenIds: values.targets as UseRequest["targetTokenIds"],
      choices: choicesOf(form, values),
      ...(roll ? { roll } : {}),
    });
  }

  const t = form.targets;
  return (
    <div className="cmh-form">
      {t ? (
        <CreaturePicks
          legend={`${t.max === 1 ? "Target" : t.max === null ? "Targets" : `Targets (up to ${t.max})`} · ${sideWord(t.side)} · ${RANGE_LABEL[t.range] ?? t.range}`}
          creatures={creatures.filter((c) => fitsSide(c, t.side))}
          picked={values.targets}
          max={t.max}
          onChange={(targets) => pick({ targets })}
        />
      ) : null}
      {form.numbers.map((n) => (
        <label key={n.id} className="cmh-field">
          <span className="cm-lbl">{n.label}</span>
          <input
            type="number"
            className="cm-in cmh-num"
            min={n.min}
            {...(n.max !== null ? { max: n.max } : {})}
            value={values.numbers[n.id] ?? n.min}
            onChange={(e) => set({ numbers: { ...values.numbers, [n.id]: Math.max(n.min, Number(e.target.value) || n.min) } })}
          />
        </label>
      ))}
      {form.eithers.map((e) => (
        <fieldset key={e.index} className="cmh-field">
          <legend className="cm-lbl">Pay with</legend>
          {e.options.map((label, i) => (
            <label key={label} className="cmh-check">
              <input type="radio" name={`either-${e.index}`} checked={(values.eithers[e.index] ?? 0) === i} onChange={() => set({ eithers: { ...values.eithers, [e.index]: i } })} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      ))}
      {form.situations.length > 0 ? (
        <fieldset className="cmh-field">
          <legend className="cm-lbl">Confirm</legend>
          {form.situations.map((s) => (
            <Check key={s} label={s} checked={values.situations.includes(s)} onChange={(on) => set({ situations: on ? [...values.situations, s] : values.situations.filter((x) => x !== s) })} />
          ))}
        </fieldset>
      ) : null}
      {form.optionals.length > 0 ? (
        <fieldset className="cmh-field">
          <legend className="cm-lbl">Also</legend>
          {form.optionals.map((o) => (
            <Check key={o.id} label={o.label} checked={values.optionals[o.id] ?? o.defaultOn} onChange={(on) => set({ optionals: { ...values.optionals, [o.id]: on } })} />
          ))}
        </fieldset>
      ) : null}
      {form.recipients.map((r) => (
        <CreaturePicks
          key={r.key}
          legend={r.label}
          creatures={creatures.filter((c) => fitsSide(c, r.side))}
          picked={values.recipients[r.key] ?? []}
          max={null}
          onChange={(ids) => pick({ recipients: { ...values.recipients, [r.key as RecipientKey]: ids } })}
        />
      ))}
      {form.choose.map((c) => (
        <fieldset key={c.stepId} className="cmh-field">
          <legend className="cm-lbl">{c.label}</legend>
          {c.options.map((o) => {
            const picked = values.options[c.stepId] ?? [];
            return (
              <Check
                key={o.id}
                label={o.label}
                checked={picked.includes(o.id)}
                onChange={(on) => set({ options: { ...values.options, [c.stepId]: c.count === 1 ? (on ? [o.id] : []) : on ? [...picked, o.id] : picked.filter((x) => x !== o.id) } })}
              />
            );
          })}
        </fieldset>
      ))}
      {form.weapon ? (
        <fieldset className="cmh-field">
          <legend className="cm-lbl">Weapon</legend>
          {(["primary", "secondary"] as const).map((w) => (
            <label key={w} className="cmh-check">
              <input type="radio" name="weapon" checked={values.weapon === w} onChange={() => set({ weapon: w })} />
              <span>{w === "primary" ? "Primary weapon" : "Secondary weapon"}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {form.traits ? (
        <label className="cmh-field">
          <span className="cm-lbl">Trait</span>
          <select className="cm-in" value={values.trait} onChange={(e) => set({ trait: e.target.value as FormValues["trait"] })}>
            {form.traits.map((tr) => (
              <option key={tr} value={tr}>
                {TRAIT_LABEL[tr]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {form.gmDifficulty ? (
        gm ? (
          <label className="cmh-field">
            <span className="cm-lbl">Difficulty (the card names none)</span>
            <input
              type="number"
              className="cm-in cmh-num"
              min={1}
              value={values.difficulty ?? ""}
              onChange={(e) => set({ difficulty: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </label>
        ) : (
          <p className="cmh-note">The card names no Difficulty: the GM decides how the roll lands.</p>
        )
      ) : null}
      {form.rolls ? <RollOptions roller={roller} values={values} onChange={set} /> : null}
      <p aria-live="polite" className="cma-error">
        {error ?? ""}
      </p>
      <div className="cma-row">
        <button type="button" className="cm-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="cm-go" disabled={pending || problem !== null} aria-busy={pending} onClick={submit}>
          {pending ? "Using…" : problem ?? `Use ${use.name}`}
        </button>
      </div>
    </div>
  );
}

/** The dialog for one card: the spell list (a grimoire), then that spell's form. */
export function UseDialog({
  card,
  uses,
  effectUses,
  creatures,
  pickedEnemies,
  gm,
  roller = null,
  open,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  card: HandCard;
  uses: readonly HandUse[];
  effectUses: readonly CardUse[];
  creatures: readonly Creature[];
  pickedEnemies: readonly string[];
  gm: boolean;
  /** The acting character's Experiences and Hope, for the roll options (null while unknown: no Experience chips). */
  roller?: Roller | null;
  open: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (request: UseRequest) => void;
}) {
  const firstReady = uses.find((u) => u.ready) ?? uses[0];
  const [useId, setUseId] = useState(firstReady?.useId ?? "");
  const use = effectUses.find((u) => u.id === useId);
  return (
    <Modal open={open} onClose={onClose} title={card.name}>
      {uses.length > 1 ? (
        <fieldset className="cmh-field">
          <legend className="cm-lbl">Spell</legend>
          <div className="cmh-picks">
            {uses.map((u) => (
              <button key={u.useId} type="button" className="cm-chip cmh-pick" aria-pressed={u.useId === useId} disabled={!u.ready} onClick={() => setUseId(u.useId)}>
                {u.name}
                {u.ready ? (u.usesLeft !== null ? ` (${u.usesLeft} left)` : "") : ` · Used · ${u.resetLabel ?? "Back after a rest"}`}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {use ? (
        <UseForm
          key={use.id}
          use={use}
          creatures={creatures}
          pickedEnemies={pickedEnemies}
          gm={gm}
          roller={roller}
          pending={pending}
          error={error}
          onCancel={onClose}
          onSubmit={(request) => onSubmit({ cardId: card.cardId, ...request })}
        />
      ) : (
        <p className="cmh-note">This card has nothing to use from the Hand.</p>
      )}
    </Modal>
  );
}

/** The server asked for a choice after the roll (a choose step, a damage split): answer and resubmit. */
export function AfterRollDialog({
  cardName,
  asks,
  names,
  pending,
  error,
  onCancel,
  onAnswer,
}: {
  cardName: string;
  asks: readonly ChoiceAsk[];
  names: ReadonlyMap<string, string>;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onAnswer: (choices: ReturnType<typeof answerChoices>) => void;
}) {
  const [options, setOptions] = useState<Record<string, string[]>>({});
  const [splits, setSplits] = useState<Record<string, number>>({});
  const missing = asks.some((a) => a.kind === "choose" && (options[a.stepId] ?? []).length === 0);
  return (
    <Modal open onClose={onCancel} title={cardName}>
      {asks.map((a, i) =>
        a.kind === "choose" ? (
          <fieldset key={a.stepId} className="cmh-field">
            <legend className="cm-lbl">{a.label}</legend>
            {a.options.map((o) => {
              const picked = options[a.stepId] ?? [];
              return (
                <Check
                  key={o.id}
                  label={o.label}
                  checked={picked.includes(o.id)}
                  onChange={(on) => setOptions((all) => ({ ...all, [a.stepId]: on ? [...picked, o.id] : picked.filter((x) => x !== o.id) }))}
                />
              );
            })}
          </fieldset>
        ) : (
          <fieldset key={`split-${i}`} className="cmh-field">
            <legend className="cm-lbl">{a.label}</legend>
            {a.tokenIds.map((id) => (
              <label key={id} className="cmh-split">
                <span>{names.get(id) ?? "Target"}</span>
                <input
                  type="number"
                  className="cm-in cmh-num"
                  min={0}
                  value={splits[id] ?? 0}
                  onChange={(e) => setSplits((all) => ({ ...all, [id]: Math.max(0, Number(e.target.value) || 0) }))}
                />
              </label>
            ))}
          </fieldset>
        ),
      )}
      <p aria-live="polite" className="cma-error">
        {error ?? ""}
      </p>
      <div className="cma-row">
        <button type="button" className="cm-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="cm-go" disabled={pending || missing} aria-busy={pending} onClick={() => onAnswer(answerChoices(asks, options, splits))}>
          {pending ? "Using…" : "Continue"}
        </button>
      </div>
    </Modal>
  );
}
