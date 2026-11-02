"use client";

import { useId, useState } from "react";

import { Modal } from "@/components/brand/modal";
import type { CardUse, Step } from "@/lib/domain/card-effects/types";
import { TRAIT_LABEL } from "@/lib/frames/extras/common";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { useCombatTargets } from "../targets/state";

import {
  answerChoices,
  askKey,
  choicesOf,
  fitsSide,
  formFor,
  formProblem,
  initialValues,
  outOfRange,
  RANGE_LABEL,
  rollOf,
  type ChoiceAsk,
  type Creature,
  type FormValues,
  type HandCard,
  type HandUse,
  type RecipientKey,
} from "./model";
import { NO_ROLL_OPTIONS, rollProblem, rollSummary, type Roller, type RollValues } from "../roll-controls";
import type { UseRequest } from "./use-card";

/**
 * Plan lanes-2 E3.3 (dcm-aw16 (1), dcm-u4pq): a vault card the dialog can swap in (Codex-Touched, CB p.333: "replace
 * this card with any card from your vault without paying its Recall Cost"). The Hand passes the vault cards at or under
 * the character's level; the server checks both again (`combatCards.useCard` refuses INVALID otherwise).
 */
export type VaultPick = { cardId: string; name: string; level: number };

/** E3.3: what the dialog sends: a use request plus the vault card a `swapWithVault` step brings in. */
export type DialogRequest = UseRequest & { swapWith?: string };

/** E3.3 (dcm-aw16 (1)): whether the use has a `loadout` `swapWithVault` step, at any depth. */
export function swapsWithVault(use: CardUse): boolean {
  return someStep(use.steps, (s) => s.kind === "loadout" && s.op === "swapWithVault");
}

/**
 * E3.3 (dcm-aw16 (2), dcm-86z): whether the use deals "the same damage" as its trigger (Encore, CB p.335: "you deal the
 * same damage to the target that your ally dealt"): the dialog then asks the type of that damage (`triggerDamageType`).
 */
export function asksTriggerDamageType(use: CardUse): boolean {
  return someStep(use.steps, (s) => s.kind === "damage" && s.roll.kind === "sameAsTrigger");
}

function someStep(steps: readonly Step[], test: (s: Step) => boolean): boolean {
  for (const step of steps) {
    if (test(step)) return true;
    const inner =
      step.kind === "choose"
        ? step.options.flatMap((o) => o.steps)
        : step.kind === "optional" || step.kind === "followUp"
          ? step.steps
          : step.kind === "save"
            ? [...step.onFail, ...step.onSuccess]
            : step.kind === "check"
              ? [...step.then, ...step.otherwise, ...(step.table ?? []).flatMap((r) => r.steps)]
              : [];
    if (inner.length > 0 && someStep(inner, test)) return true;
  }
  return false;
}

/**
 * The Use dialog (plan combat-actions CA6): opens only when the card needs a choice (a grimoire spell, a number of Hope,
 * a cost option, a situation to confirm, an optional part, creatures beyond one enemy, a weapon or trait, the GM's
 * Difficulty) and fires `combatCards.useCard` once with the picks. `AfterRollDialog` answers the server's
 * `needsChoice` (a choose step or a damage split) and resubmits through `useCardActions.answer`.
 *
 * F7-H4 (dcm-bxp.99.24): every creature picked here (targets and the card's other creatures) also gets CA5's target ring
 * on the map (`toggleExtraTarget`). F8-I1 (dcm-bxp.99.28): a rolling card uses the Hand's roll-options strip; the dialog
 * only names what the strip holds.
 */

/** Every creature the dialog's answers name (targets and recipients), once each. */
function dialogPicks(values: FormValues): Set<string> {
  return new Set<string>([...values.targets, ...Object.values(values.recipients).flatMap((ids) => ids ?? [])]);
}

/** The label of a creature out of the card's range (user answer 2026-10-30): picking it still sends the use (Q1). */
export const OUT_OF_RANGE = "Out of range - GM approves";

const sideWord =(side: string) => (side === "enemy" ? "enemies" : side === "ally" ? "allies" : side === "selfOrAlly" ? "you or allies" : "creatures");

function CreaturePicks({
  legend,
  creatures,
  picked,
  max,
  away,
  onChange,
}: {
  legend: string;
  creatures: readonly Creature[];
  picked: readonly string[];
  max: number | null;
  /** Out of the card's range (DA6): listed greyed with "Out of range - GM approves", still pickable (Q1). */
  away?: (c: Creature) => boolean;
  onChange: (ids: string[]) => void;
}) {
  const awayId = useId();
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
      <span id={awayId} hidden>
        {OUT_OF_RANGE}
      </span>
      <div className="cmh-picks">
        {creatures.map((c) => {
          const on = picked.includes(c.tokenId);
          const full = !on && max !== null && !single && picked.length >= max;
          const far = away?.(c) ?? false;
          const name = c.side === "self" ? "You" : c.name;
          return (
            <button
              key={c.tokenId}
              type="button"
              className="cm-chip cmh-pick"
              aria-pressed={on}
              disabled={full}
              data-away={far ? "true" : undefined}
              aria-describedby={far ? awayId : undefined}
              onClick={() => onChange(single ? (on ? [] : [c.tokenId]) : on ? picked.filter((id) => id !== c.tokenId) : [...picked, c.tokenId])}
            >
              <span>{name}</span>
              {far ? (
                <span className="cmh-pick-away" aria-hidden="true">
                  {OUT_OF_RANGE}
                </span>
              ) : null}
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

/** E3 (dcm-uyc): the values a `NumberChoice` lists, or null. */
export function listedValues(use: CardUse, id: string): readonly number[] | null {
  const values = use.choices?.find((c) => c.id === id)?.values;
  return values && values.length > 0 ? values : null;
}

/** E3 (dcm-uyc): a listed number starts at its first listed value at or above its minimum (the runner's default). */
export function withListedNumbers(use: CardUse, values: FormValues): FormValues {
  const numbers = { ...values.numbers };
  for (const c of use.choices ?? []) {
    const listed = listedValues(use, c.id);
    if (listed && !listed.includes(numbers[c.id] ?? c.min)) numbers[c.id] = listed.find((n) => n >= c.min) ?? listed[0]!;
  }
  return { ...values, numbers };
}

/** E3 (dcm-40m): the choose step (by id) whose pick this one must not repeat, at any depth of the use's steps. */
export function distinctFromOf(use: CardUse, stepId: string): string | undefined {
  const find = (steps: readonly Step[]): string | undefined => {
    for (const step of steps) {
      if (step.kind === "choose") {
        if (step.id === stepId) return step.distinctFrom;
        for (const o of step.options) {
          const inner = find(o.steps);
          if (inner) return inner;
        }
      } else if (step.kind === "optional" || step.kind === "followUp") {
        const inner = find(step.steps);
        if (inner) return inner;
      } else if (step.kind === "save") {
        const inner = find(step.onFail) ?? find(step.onSuccess);
        if (inner) return inner;
      } else if (step.kind === "check") {
        const inner = find(step.then) ?? find(step.otherwise);
        if (inner) return inner;
      }
    }
    return undefined;
  };
  return find(use.steps);
}

/** The form of one use. Remounted (by key) when the spell changes, so its answers start fresh. */
function UseForm({
  use,
  creatures,
  pickedEnemies,
  gm,
  roller,
  rollOptions,
  vault,
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
  rollOptions: RollValues;
  vault: readonly VaultPick[];
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (request: Omit<DialogRequest, "cardId">) => void;
}) {
  const form = formFor(use);
  const [values, setValues] = useState<FormValues>(() => withListedNumbers(use, initialValues(form, pickedEnemies)));
  const { targetTokenIds, toggleExtraTarget } = useCombatTargets();
  const swaps = swapsWithVault(use);
  const asksType = asksTriggerDamageType(use);
  const [swapWith, setSwapWith] = useState<string>("");
  const [triggerType, setTriggerType] = useState<"physical" | "magic">("physical");
  const problem =
    formProblem(form, values) ??
    (form.gmDifficulty && gm && values.difficulty === undefined ? "Set the Difficulty." : null) ??
    (swaps && swapWith === "" ? "Pick a vault card." : null) ??
    (form.rolls ? rollProblem(roller, rollOptions) : null);
  const rollNote = form.rolls ? rollSummary(rollOptions) : null;

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
    const roll = rollOf(form, values, gm, rollOptions);
    onSubmit({
      spell: use.id,
      targetTokenIds: values.targets as UseRequest["targetTokenIds"],
      choices: [...choicesOf(form, values), ...(asksType ? [{ id: "triggerDamageType", value: triggerType }] : [])],
      ...(roll ? { roll } : {}),
      ...(swaps && swapWith !== "" ? { swapWith } : {}),
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
          away={(c) => outOfRange(t, creatures, values.targets, c)}
          onChange={(targets) => pick({ targets })}
        />
      ) : null}
      {form.numbers.map((n) => {
        // E3 (dcm-uyc, Teleport, CB p.333): a number with listed values is picked from them.
        const listed = listedValues(use, n.id);
        return listed ? (
          <label key={n.id} className="cmh-field">
            <span className="cm-lbl">{n.label}</span>
            <select className="cm-in" value={values.numbers[n.id] ?? listed[0]} onChange={(e) => set({ numbers: { ...values.numbers, [n.id]: Number(e.target.value) } })}>
              {listed.map((v) => (
                <option key={v} value={v}>
                  {v > 0 ? `+${v}` : v}
                </option>
              ))}
            </select>
          </label>
        ) : (
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
        );
      })}
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
            // E3 (dcm-40m, Twin Fang, HF p.9): an option picked in the step this one must differ from is not offered.
            const other = distinctFromOf(use, c.stepId);
            if (other && (values.options[other] ?? []).includes(o.id) && !picked.includes(o.id)) return null;
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
      {swaps ? (
        vault.length > 0 ? (
          <label className="cmh-field">
            <span className="cm-lbl">Swap in from the vault</span>
            <select className="cm-in" value={swapWith} onChange={(e) => setSwapWith(e.target.value)}>
              <option value="">Pick a card</option>
              {vault.map((c) => (
                <option key={c.cardId} value={c.cardId}>
                  {c.name} (level {c.level})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="cmh-note">No vault card at or under your level to swap in.</p>
        )
      ) : null}
      {asksType ? (
        <fieldset className="cmh-field">
          <legend className="cm-lbl">Your ally&apos;s damage was</legend>
          {(["physical", "magic"] as const).map((t) => (
            <label key={t} className="cmh-check">
              <input type="radio" name="trigger-damage-type" checked={triggerType === t} onChange={() => setTriggerType(t)} />
              <span>{t === "physical" ? "Physical" : "Magic"}</span>
            </label>
          ))}
        </fieldset>
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
      {rollNote ? (
        <p className="cmh-note" data-testid="combat-card-roll-note">
          Roll options from the Hand: {rollNote}
        </p>
      ) : null}
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
  rollOptions = NO_ROLL_OPTIONS,
  vault = [],
  open,
  pending,
  error,
  onClose,
  onSpell,
  onSubmit,
}: {
  card: HandCard;
  uses: readonly HandUse[];
  effectUses: readonly CardUse[];
  creatures: readonly Creature[];
  pickedEnemies: readonly string[];
  gm: boolean;
  /** The acting character's Experiences and Hope, for the Hope check (null while unknown). */
  roller?: Roller | null;
  /** The Hand's roll-options strip, applied when the use rolls (F8-I1). */
  rollOptions?: RollValues;
  /** E3.3 (dcm-u4pq): the vault cards a Codex-Touched swap may bring in (at or under the character's level). */
  vault?: readonly VaultPick[];
  open: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  /** Another spell was picked: its form starts with no picks, so the rings of the last one's picks go (DA6). */
  onSpell?: () => void;
  onSubmit: (request: DialogRequest) => void;
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
              <button key={u.useId} type="button" className="cm-chip cmh-pick" aria-pressed={u.useId === useId} disabled={!u.ready} onClick={() => {
                  if (u.useId === useId) return;
                  onSpell?.();
                  setUseId(u.useId);
                }}
              >
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
          rollOptions={rollOptions}
          vault={vault}
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
  const missing = asks.some((a) => a.kind === "choose" && (options[askKey(a)] ?? []).length === 0);
  return (
    <Modal open onClose={onCancel} title={cardName}>
      {asks.map((a, i) =>
        a.kind === "choose" ? (
          <fieldset key={askKey(a)} className="cmh-field">
            {/* Plan lanes-2 E1.4a (dcm-tn8u): a per-chooser pick names its chooser (Critical Inspiration's allies). */}
            <legend className="cm-lbl">{a.chooserId !== undefined ? `${names.get(a.chooserId) ?? "An ally"}: ${a.label}` : a.label}</legend>
            {a.options.map((o) => {
              const key = askKey(a);
              const picked = options[key] ?? [];
              return (
                <Check
                  key={o.id}
                  label={o.label}
                  checked={picked.includes(o.id)}
                  onChange={(on) => setOptions((all) => ({ ...all, [key]: on ? [...picked, o.id] : picked.filter((x) => x !== o.id) }))}
                />
              );
            })}
          </fieldset>
        ) : a.kind === "followUp" ? (
          // dcm-tn8u: the creatures of a repeating follow-up's next link (a chain link), picked by check box.
          <fieldset key={askKey(a)} className="cmh-field">
            <legend className="cm-lbl">{a.label}</legend>
            {a.tokenIds.map((id) => {
              const key = askKey(a);
              const picked = options[key] ?? [];
              return (
                <Check
                  key={id}
                  label={names.get(id) ?? "Target"}
                  checked={picked.includes(id)}
                  onChange={(on) => setOptions((all) => ({ ...all, [key]: on ? [...picked, id] : picked.filter((x) => x !== id) }))}
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
