"use client";

import "./features.css";

import { useMutation, useQuery } from "convex/react";
import { useId, useMemo, useRef, useState } from "react";

import { EffectRow, Label, paperField, Pill, Small } from "@/components/party/sheet-ui";
import { errorMessage } from "@/lib/convex-errors";
import { rallyDieStress } from "@/lib/domain/class-features/held-dice";
import { classActions, hopeFeature } from "@/lib/domain/class-features/hooks";
import { CLASS_FEATURES, CLASS_STATE_LABELS, classFeaturesAvailable } from "@/lib/domain/class-features/index";
import type { FeatureInput, FeatureMeta } from "@/lib/domain/class-features/types";
import { currentPhase, holdsSlayer, holdsTide, slayerCapacity, slayerDice, tideCapacity, tideTokens } from "@/lib/domain/session-features";
import { characterSheetSchema } from "@/lib/validation/characters";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SlotProps } from "../slots";

// Board blocks (reference/designs/project/Party.dc.html): the Hope box's `hf` block (HopeFeatureBlock) and the
// Class Features box's `cf.rows` (FeaturesBox). Styles: ./features.css.

type Sheet = SlotProps["character"]["sheet"];

/** Runs a keyed mutation once per intent: a retry replays the same key, a finished call starts a new one. */
function useIntent() {
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(call: (idempotencyKey: string) => Promise<unknown>): Promise<boolean> {
    key.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      await call(key.current);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      key.current = null;
      setBusy(false);
    }
  }
  return { run, busy, error };
}

function costLabel(feature: FeatureMeta): string | null {
  const c = feature.cost;
  if (!c) return null;
  const parts = [c.hope ? `${c.hope} Hope` : null, c.stress ? `${c.stress} Stress` : null, c.use ? `once per ${c.use.until === "longRest" ? "long rest" : c.use.until}` : null];
  return parts.filter(Boolean).join(", ") || null;
}

const TRAIT_LABEL = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The ally picker for `target: "ally"` features and `ally` inputs; Witch's Charm and optional inputs may also pick yourself. */
function AllyPicker({
  campaignId,
  self,
  allowSelf,
  value,
  onChange,
  label = "Target",
}: {
  campaignId: Id<"campaigns">;
  self: Id<"characters">;
  allowSelf: boolean;
  value: Id<"characters"> | "";
  onChange: (v: Id<"characters"> | "") => void;
  label?: string;
}) {
  const party = useQuery(api.characters.listByCampaign, { campaignId });
  const allies = (party ?? []).filter((c) => c._id !== self && c.status === "active");
  return (
    <label className="ft-field">
      <Label>{label}</Label>
      <select className={paperField.input} value={value} onChange={(e) => onChange(allies.find((c) => c._id === e.target.value)?._id ?? "")} disabled={party === undefined}>
        {allowSelf ? <option value="">Yourself</option> : <option value="">Choose an ally</option>}
        {allies.map((c) => (
          <option key={c._id} value={c._id}>
            {c.sheet.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Held dice of one kind (Prayer Dice), picked by their order among those dice. */
function HeldDicePicker({ sheet, input, value, onChange }: { sheet: Sheet; input: Extract<FeatureInput, { kind: "heldDice" }>; value: number[]; onChange: (v: number[]) => void }) {
  const held = (sheet.heldDice ?? []).filter((d) => d.kind === input.heldKind);
  if (held.length === 0) return <Small className="italic">None held.</Small>;
  return (
    <fieldset className="ft-checks">
      <legend className="sh-lbl">{input.label} (default: the first)</legend>
      {held.map((d, i) => (
        <label key={d.id} className="ft-check">
          <input type="checkbox" checked={value.includes(i)} onChange={(e) => onChange(e.target.checked ? [...value, i] : value.filter((x) => x !== i))} />
          d{d.sides}
          {d.value !== undefined ? `: ${d.value}` : ""}
        </label>
      ))}
    </fieldset>
  );
}

/** Volatile Magic: pick damage dice of the latest damage roll to reroll. */
function DamageDicePicker({ characterId, value, onChange }: { characterId: Id<"characters">; value: number[]; onChange: (v: number[]) => void }) {
  const roll = useQuery(api.classFeatures.lastRoll, { characterId });
  if (roll === undefined) return <Small className="italic">Loading your latest roll…</Small>;
  if (roll === null || roll.kind !== "damage") return <Small className="italic">Roll damage first: your latest roll is not a damage roll.</Small>;
  return (
    <fieldset className="ft-checks">
      <legend className="sh-lbl">Dice to reroll (total {roll.total})</legend>
      {roll.dice.map((d, i) =>
        d.role === "damage" && !d.dropped ? (
          <label key={i} className="ft-check">
            <input type="checkbox" checked={value.includes(i)} onChange={(e) => onChange(e.target.checked ? [...value, i] : value.filter((x) => x !== i))} />
            d{d.sides}: {d.value}
          </label>
        ) : null,
      )}
    </fieldset>
  );
}

/** Whether an input still needs a value before the feature can be used. */
function inputMissing(input: FeatureInput, values: { choice: string; amount: string; dieIndexes: number[]; target: string }): boolean {
  switch (input.kind) {
    case "select":
      return input.required && values.choice === "";
    case "number": {
      const n = Number(values.amount);
      return values.amount === "" || !Number.isInteger(n) || n < input.min || n > input.max;
    }
    case "rollDice":
      return values.dieIndexes.length === 0;
    case "ally":
      return input.required && values.target === "";
    case "text":
    case "heldDice":
      return false;
  }
}

/**
 * One usable feature. `hope`: the Hope box's hf block (the feature text is already above it, so only the pickers,
 * the gold "✦ Use … · 3 Hope" pill and the status box). `row`: a cf row with title, text, cost and a Use pill.
 */
function FeatureCard({ feature, props, blocked, variant }: { feature: FeatureMeta; props: SlotProps; blocked: string | null; variant: "hope" | "row" }) {
  const { character, campaignId, canEdit } = props;
  const applyFeature = useMutation(api.classFeatures.use);
  const { run, busy, error } = useIntent();
  const [target, setTarget] = useState<Id<"characters"> | "">("");
  const [choice, setChoice] = useState("");
  const [amount, setAmount] = useState("");
  const [dieIndexes, setDieIndexes] = useState<number[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const inputId = useId();
  const cost = costLabel(feature);
  const short = feature.cost?.hope !== undefined && character.sheet.hope < feature.cost.hope;
  const needsTarget = feature.target === "ally" && feature.key !== "witchsCharm";
  const inputs = feature.inputs ?? [];
  const missing = (needsTarget && target === "") || inputs.some((i) => inputMissing(i, { choice, amount, dieIndexes, target }));
  // `select` options read the full sheet (loadout cards, tier); the panel's sheet is the server's view of it.
  const parsed = useMemo(() => characterSheetSchema.safeParse(character.sheet), [character.sheet]);
  const usable = canEdit && feature.use !== undefined;
  // A hard block (dead, away, unconscious) wins over the last result; the result wins over "Needs N Hope".
  const message = canEdit ? (blocked ?? done ?? (short ? `Needs ${feature.cost?.hope} Hope.` : null)) : done;
  const disabled = busy || blocked !== null || short || missing;

  async function submit() {
    setDone(null);
    const params = {
      ...(target ? { targetId: target } : {}),
      ...(choice.trim() ? { choice: choice.trim() } : {}),
      ...(amount !== "" ? { amount: Number(amount) } : {}),
      ...(dieIndexes.length ? { dieIndexes } : {}),
    };
    const ok = await run((idempotencyKey) =>
      applyFeature({ characterId: character._id, featureKey: feature.key, params, idempotencyKey }).then((r) => setDone(r.summary)),
    );
    if (ok) {
      setDieIndexes([]);
      setChoice("");
      setAmount("");
    }
  }

  function renderInput(input: FeatureInput, i: number) {
    const id = `${inputId}-${i}`;
    switch (input.kind) {
      case "text":
        return (
          <label key={id} className="ft-field">
            <Label>{input.label}</Label>
            <input className={paperField.input} maxLength={60} placeholder={input.placeholder} value={choice} onChange={(e) => setChoice(e.target.value)} />
          </label>
        );
      case "select":
        return (
          <label key={id} className="ft-field">
            <Label>{input.label}</Label>
            <select className={paperField.input} value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">{input.empty}</option>
              {(parsed.success ? input.options(parsed.data) : []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        );
      case "number":
        return (
          <label key={id} className="ft-field">
            <Label>{input.label}</Label>
            <input className={`${paperField.input} ft-number`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} />
          </label>
        );
      case "heldDice":
        return <HeldDicePicker key={id} sheet={character.sheet} input={input} value={dieIndexes} onChange={setDieIndexes} />;
      case "rollDice":
        return <DamageDicePicker key={id} characterId={character._id} value={dieIndexes} onChange={setDieIndexes} />;
      case "ally":
        return <AllyPicker key={id} campaignId={campaignId} self={character._id} allowSelf={!input.required} value={target} onChange={setTarget} label={input.label} />;
    }
  }

  const pickers =
    usable && (feature.target === "ally" || inputs.length > 0) ? (
      <div className="ft-pickers">
        {feature.target === "ally" ? <AllyPicker campaignId={campaignId} self={character._id} allowSelf={!needsTarget} value={target} onChange={setTarget} /> : null}
        {inputs.map(renderInput)}
      </div>
    ) : null;
  // Always rendered so screen readers announce the result; empty, it takes no space.
  const status = (
    <div role="status" className="ft-msg">
      {message}
    </div>
  );
  const alert = error ? (
    <p role="alert" className="ft-error">
      {error}
    </p>
  ) : null;

  if (variant === "hope") {
    if (!usable) return null;
    return (
      <div className="hf-feature" role="group" aria-label={feature.name}>
        {pickers}
        <button type="button" className="hf-use" disabled={disabled} onClick={() => void submit()}>
          <span aria-hidden="true">✦ </span>
          Use {feature.name}
          {cost ? ` · ${cost}` : ""}
        </button>
        {feature.automation === "assist" ? <Small className="italic">Reminder: the Hope is spent here; apply the effect at the table.</Small> : null}
        {status}
        {alert}
      </div>
    );
  }

  return (
    <div className="cf-row" role="group" aria-label={feature.name}>
      <div>
        <strong className="cf-title">{feature.name}</strong>
        {cost ? <span className="cf-cost">{cost}</span> : null}
        {feature.automation === "assist" ? <span className="cf-cost">reminder</span> : null}
        {feature.text ? <Small className="cf-text">{feature.text}</Small> : null}
      </div>
      {pickers}
      {usable ? (
        <div className="cf-btns">
          <Pill variant="solid" disabled={disabled} onClick={() => void submit()}>
            Use {feature.name}
          </Pill>
        </div>
      ) : null}
      {status}
      {alert}
    </div>
  );
}

/** The hf block's "Active effects": one dashed EffectRow per effect (its text states how long it lasts) with its End button, then Got hit. */
function Effects({ props }: { props: SlotProps }) {
  const { character, canEdit } = props;
  const sheet = character.sheet;
  const effects = sheet.effects ?? [];
  const endEffect = useMutation(api.classFeatures.endEffect);
  const gotHit = useMutation(api.classFeatures.gotHit);
  const { run, busy, error } = useIntent();
  if (effects.length === 0) return null;
  const hitEffects = effects.filter((e) => e.until === "hit");
  return (
    <div className="hf-effects">
      <Label>Active effects</Label>
      <ul className="ft-list" aria-label="Active effects">
        {effects.map((e) => (
          <li key={e.id}>
            <EffectRow
              disabled={busy}
              endAriaLabel={`End ${e.source}`}
              onEnd={canEdit ? () => void run((idempotencyKey) => endEffect({ characterId: character._id, effectId: e.id, idempotencyKey })) : undefined}
            >
              {e.source}: {e.text}
            </EffectRow>
          </li>
        ))}
      </ul>
      {canEdit && hitEffects.length > 0 ? (
        <div className="hf-hit">
          <button type="button" className="hf-ghost" disabled={busy} onClick={() => void run((idempotencyKey) => gotHit({ characterId: character._id, idempotencyKey }))}>
            Got hit
          </button>
          <Small className="italic">An attack succeeded against you: ends {hitEffects.map((e) => e.source).join(", ")}.</Small>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="ft-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function stateEntries(sheet: Sheet): [string, string][] {
  const state = sheet.classState ?? {};
  return (Object.keys(CLASS_STATE_LABELS) as (keyof typeof CLASS_STATE_LABELS)[]).flatMap((k): [string, string][] => {
    const value = state[k];
    if (value === undefined) return [];
    const text =
      typeof value === "object" && !Array.isArray(value)
        ? "focus" in value
          ? `${value.focus} Focus${value.active ? ` · ${value.active}` : ""}` // the Martial Artist's stances (sheet-drawer SD0, Q5)
          : `${value.value} / d${value.max}`
        : Array.isArray(value)
          ? value.join(", ") || "none"
          : typeof value === "boolean"
            ? value
              ? "yes"
              : "no"
            : String(value);
    return [[CLASS_STATE_LABELS[k], text]];
  });
}

/**
 * Session-feature chips (plan session-features U7), each only for its holder: the Slayer pool and the Know the Tide
 * tokens while any are held, the moon die while one is placed (Lunar Phases only with Hope & Fear on).
 */
function sessionChips(sheet: Sheet, hopeAndFear: boolean): { key: string; text: string }[] {
  const chips: { key: string; text: string }[] = [];
  const slayer = slayerDice(sheet);
  if (holdsSlayer(sheet) && slayer > 0) chips.push({ key: "slayer", text: `Slayer Dice ${slayer}/${slayerCapacity(sheet)}` });
  const tide = tideTokens(sheet);
  if (holdsTide(sheet) && tide > 0) chips.push({ key: "tide", text: `Tide tokens ${tide}/${tideCapacity(sheet)}` });
  const die = sheet.sessionFeatures?.moonDie;
  const phase = currentPhase(sheet, { hopeAndFear, ikonis: false });
  if (die !== undefined && phase) chips.push({ key: "moon", text: `Moon die ${die}: ${phase.name}` });
  return chips;
}

function blockedReason(props: SlotProps): string | null {
  const { character } = props;
  if (character.status === "dead") return "Dead characters can't use features.";
  if (character.status === "away") return "Away characters can't use features.";
  if ((character.sheet.conditions ?? []).includes("unconscious")) return "Unconscious: can't use features until an ally clears a Hit Point or the party finishes a long rest.";
  return null;
}

/** The Hope box's hf block: the class Hope feature's pickers, Use pill and status, then the active effects. */
export function HopeFeatureBlock(props: SlotProps) {
  const sheet = props.character.sheet;
  const hope = classFeaturesAvailable(sheet.classId, props.hopeAndFear) ? hopeFeature(sheet) : undefined;
  const showHope = hope !== undefined && props.canEdit && hope.use !== undefined;
  if (!showHope && (sheet.effects ?? []).length === 0) return null;
  return (
    <div className="hf">
      {hope ? <FeatureCard feature={hope} props={props} blocked={blockedReason(props)} variant="hope" /> : null}
      <Effects props={props} />
    </div>
  );
}

/** The Class Features box's cf rows: class actions, then held dice and conditions as chips and the class counters. */
export function FeaturesBox(props: SlotProps) {
  const sheet = props.character.sheet;
  const held = sheet.heldDice ?? [];
  // Class actions of the class and the multiclass, each offered only if its class is (Hope & Fear option);
  // a Rally Die comes from a Bard, so its action is offered to any class, but only while one is held.
  const actions = classActions(sheet).filter((f) =>
    f.key === rallyDieStress.key
      ? held.some((d) => d.kind === "rally")
      : [sheet.classId, sheet.multiclass?.classId].some((id) => id !== undefined && classFeaturesAvailable(id, props.hopeAndFear) && CLASS_FEATURES[id]?.classActions?.includes(f)),
  );
  const conditions = sheet.conditions ?? [];
  const state = stateEntries(sheet);
  const session = sessionChips(sheet, props.hopeAndFear);
  if (actions.length === 0 && conditions.length === 0 && held.length === 0 && session.length === 0 && state.length === 0) return null;
  const blocked = blockedReason(props);

  return (
    <div className="cf">
      {actions.map((f) => (
        <FeatureCard key={f.key} feature={f} props={props} blocked={blocked} variant="row" />
      ))}
      {conditions.length > 0 ? (
        <div className="cf-chips">
          <Label>Conditions</Label>
          <ul className="ft-list ft-inline" aria-label="Conditions">
            {conditions.map((c) => (
              <li key={c} className="ft-pill">
                {TRAIT_LABEL(c)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {held.length > 0 ? (
        <div className="cf-chips">
          <Label>Held dice</Label>
          <ul className="ft-list ft-inline" aria-label="Held dice">
            {held.map((d) => (
              <li key={d.id} className="ft-pill">
                {TRAIT_LABEL(d.kind)} d{d.sides}
                {d.value !== undefined ? `: ${d.value}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {session.length > 0 ? (
        <div className="cf-chips">
          <Label>Session</Label>
          <ul className="ft-list ft-inline" aria-label="Session features">
            {session.map((c) => (
              <li key={c.key} className="ft-pill" data-chip={c.key}>
                {c.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.length > 0 ? (
        <dl className="cf-state">
          {state.map(([label, text]) => (
            <div key={label} className="contents">
              <dt className="sh-lbl">{label}</dt>
              <dd className="sh-small">{text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
