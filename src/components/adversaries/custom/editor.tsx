"use client";

import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useState, type FormEvent, type ReactNode } from "react";

import { Modal } from "@/components/brand/modal";
import {
  blank,
  changedFields,
  IMPROVISED,
  RANGES,
  validateCustom,
  withImprovisedStats,
  type CustomAdversaryInput,
  type CustomFeature,
  type CustomTier,
} from "@/lib/adversaries/custom";
import { errorMessage } from "@/lib/convex-errors";
import { RuleError } from "@/lib/errors/app-error";
import { ADVERSARY_TYPES, type AdversaryFeatureKind, type AdversaryType } from "@/lib/srd/types";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { StatBlock } from "../catalogue/stat-block";

/** What the editor opens on: a new block (a duplicate or a blank one) or an existing custom adversary. */
export type EditorTarget =
  | { mode: "new"; initial: CustomAdversaryInput; basedOn?: string; blank?: boolean }
  | { mode: "edit"; customId: Id<"customAdversaries">; initial: CustomAdversaryInput };

const TIERS: readonly CustomTier[] = [1, 2, 3, 4];
const KINDS: readonly { id: AdversaryFeatureKind; label: string }[] = [
  { id: "passive", label: "Passive" },
  { id: "action", label: "Action" },
  { id: "reaction", label: "Reaction" },
  { id: "evolution", label: "Evolution" },
];

/** The improvised numbers a blank block of `tier` and `type` starts with (to tell whether the GM changed them). */
function prefillOf(draft: Pick<CustomAdversaryInput, "tier" | "type">) {
  const b = blank(draft.tier as CustomTier, draft.type);
  return JSON.stringify([b.difficulty, b.thresholds, b.hp, b.stress, b.attack, b.hordePerHp]);
}
const numbersOf = (d: CustomAdversaryInput) => JSON.stringify([d.difficulty, d.thresholds, d.hp, d.stress, d.attack, d.hordePerHp]);

/** A whole-number input; blank means `null` where `nullable` (thresholds "None", no Fear cost, no countdown). */
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  nullable,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  nullable?: boolean;
}) {
  return (
    <label className="adx-field">
      <span className="adx-lbl">{label}</span>
      <input
        className="adx-in"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value === null || value === undefined || Number.isNaN(value) ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? (nullable ? null : Number.NaN) : Number(e.target.value))}
      />
    </label>
  );
}

function TextField({ label, value, onChange, maxLength }: { label: string; value: string; onChange: (value: string) => void; maxLength: number }) {
  return (
    <label className="adx-field">
      <span className="adx-lbl">{label}</span>
      <input className="adx-in" type="text" value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="adx-fs">
      <legend className="adx-legend">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** The parchment editor: the stat block's sections as inputs, with a live preview. Saves only on "Save". */
export function CustomEditor({
  campaignId,
  target,
  onClose,
  onSaved,
}: {
  campaignId: Id<"campaigns">;
  target: EditorTarget | null;
  onClose: () => void;
  onSaved?: (customId: Id<"customAdversaries">) => void;
}) {
  const title = target === null ? "Custom adversary" : target.mode === "edit" ? `Edit ${target.initial.name}` : "New custom adversary";
  return (
    <Modal open={target !== null} onClose={onClose} title={title} className="max-w-[1180px] p-4 sm:p-7">
      {target ? <EditorForm campaignId={campaignId} target={target} onClose={onClose} onSaved={onSaved} /> : null}
    </Modal>
  );
}

function EditorForm({
  campaignId,
  target,
  onClose,
  onSaved,
}: {
  campaignId: Id<"campaigns">;
  target: EditorTarget;
  onClose: () => void;
  onSaved?: (customId: Id<"customAdversaries">) => void;
}) {
  const [draft, setDraft] = useState<CustomAdversaryInput>(target.initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const create = useIntent(api.customAdversaries.create);
  const update = useMutation(api.customAdversaries.update);

  const set = <K extends keyof CustomAdversaryInput>(key: K, value: CustomAdversaryInput[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setAttack = (patch: Partial<CustomAdversaryInput["attack"]>) => setDraft((d) => ({ ...d, attack: { ...d.attack, ...patch } }));
  const setFeature = (i: number, patch: Partial<CustomFeature>) =>
    setDraft((d) => ({ ...d, features: d.features.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const moveFeature = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      const features = [...d.features];
      const [f] = features.splice(i, 1);
      features.splice(i + by, 0, f!);
      return { ...d, features };
    });

  /** Tier and type: a blank block still on its improvised numbers takes the new tier's (and type's) numbers. */
  function retier(patch: { tier?: CustomTier; type?: AdversaryType }) {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (next.type !== "Horde") delete next.hordePerHp;
      else if (next.hordePerHp === undefined) next.hordePerHp = 2;
      if (target.mode !== "new" || !target.blank || numbersOf(d) !== prefillOf(d)) return next;
      const b = blank(next.tier as CustomTier, next.type);
      return { ...next, difficulty: b.difficulty, thresholds: b.thresholds, hp: b.hp, stress: b.stress, attack: b.attack, hordePerHp: b.hordePerHp };
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    let checked: CustomAdversaryInput;
    try {
      checked = validateCustom(draft);
    } catch (e) {
      if (e instanceof RuleError) return setError(e.message);
      throw e;
    }
    setError(null);
    if (target.mode === "new") {
      const done = await create.fire({ campaignId, adversary: checked, ...(target.basedOn ? { basedOn: target.basedOn } : {}) });
      if (!done) return;
      onSaved?.(done.customId);
      onClose();
      return;
    }
    // CL3: only the fields this edit changed; hordePerHp null clears it.
    const before = validateCustom(target.initial);
    const fields = changedFields(before, checked);
    if (fields.length === 0) return onClose();
    const patch: FunctionArgs<typeof api.customAdversaries.update>["patch"] = {};
    for (const field of fields) (patch as Record<string, unknown>)[field] = checked[field] ?? null;
    setSaving(true);
    try {
      await update({ campaignId, customId: target.customId, patch });
      onSaved?.(target.customId);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const improvised = IMPROVISED[(TIERS.includes(draft.tier as CustomTier) ? draft.tier : 1) as CustomTier];
  const shownError = error ?? create.error;

  return (
    <form className="adx-editor" noValidate onSubmit={(e) => void save(e)} aria-label="Custom adversary editor">
      <div className="adx-form">
        <Fieldset legend="Name and type">
          <TextField label="Name" value={draft.name} maxLength={80} onChange={(v) => set("name", v)} />
          <div className="adx-row">
            <label className="adx-field">
              <span className="adx-lbl">Tier</span>
              <select className="adx-in" value={draft.tier} onChange={(e) => retier({ tier: Number(e.target.value) as CustomTier })}>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    Tier {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="adx-field">
              <span className="adx-lbl">Type</span>
              <select className="adx-in" value={draft.type} onChange={(e) => retier({ type: e.target.value as AdversaryType })}>
                {ADVERSARY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {draft.type === "Horde" ? (
              <NumberField label="Creatures per HP" value={draft.hordePerHp} min={1} max={30} onChange={(v) => set("hordePerHp", v ?? undefined)} />
            ) : null}
          </div>
          <label className="adx-field">
            <span className="adx-lbl">Description</span>
            <textarea className="adx-ta" rows={2} maxLength={2000} value={draft.description} onChange={(e) => set("description", e.target.value)} />
          </label>
          <label className="adx-field">
            <span className="adx-lbl">Motives &amp; Tactics</span>
            <input className="adx-in" type="text" maxLength={2000} value={draft.motives} onChange={(e) => set("motives", e.target.value)} />
          </label>
        </Fieldset>

        <Fieldset legend="Statistics">
          <div className="adx-row">
            <NumberField label="Difficulty" value={draft.difficulty} min={1} max={40} onChange={(v) => set("difficulty", v ?? Number.NaN)} />
            <NumberField
              label="Major threshold"
              nullable
              value={draft.thresholds.major}
              min={1}
              max={200}
              onChange={(v) => set("thresholds", { ...draft.thresholds, major: v })}
            />
            <NumberField
              label="Severe threshold"
              nullable
              value={draft.thresholds.severe}
              min={1}
              max={200}
              onChange={(v) => set("thresholds", { ...draft.thresholds, severe: v })}
            />
            <NumberField label="HP" value={draft.hp} min={1} max={30} onChange={(v) => set("hp", v ?? Number.NaN)} />
            <NumberField label="Stress" value={draft.stress} min={0} max={20} onChange={(v) => set("stress", v ?? Number.NaN)} />
          </div>
          <p className="adx-hint">Leave a threshold blank for None. Improvised statistics for Tier {draft.tier} (Core Rulebook p. 208): attack +{improvised.modifier}, damage {improvised.damageRange}, Difficulty {improvised.difficulty}, thresholds {improvised.major}/{improvised.severe}.</p>
          <div>
            <button type="button" className="adx-btn" onClick={() => setDraft((d) => withImprovisedStats(d, (TIERS.includes(d.tier as CustomTier) ? d.tier : 1) as CustomTier))}>
              Use Tier {draft.tier} improvised statistics
            </button>
          </div>
        </Fieldset>

        <Fieldset legend="Attack">
          <div className="adx-row">
            <NumberField label="Attack modifier" value={draft.attack.modifier} min={-10} max={20} onChange={(v) => setAttack({ modifier: v ?? Number.NaN })} />
            <TextField label="Attack name" value={draft.attack.name} maxLength={80} onChange={(v) => setAttack({ name: v })} />
            <label className="adx-field">
              <span className="adx-lbl">Range</span>
              <select className="adx-in" value={draft.attack.range} onChange={(e) => setAttack({ range: e.target.value })}>
                {RANGES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <TextField label="Damage" value={draft.attack.damage} maxLength={40} onChange={(v) => setAttack({ damage: v })} />
          </div>
        </Fieldset>

        <Fieldset legend="Experiences">
          {draft.experiences.map((exp, i) => (
            <div key={i} className="adx-exp">
              <TextField
                label={`Experience ${i + 1}`}
                value={exp.name}
                maxLength={60}
                onChange={(v) => set("experiences", draft.experiences.map((e, j) => (j === i ? { ...e, name: v } : e)))}
              />
              <NumberField
                label="Bonus"
                value={exp.value}
                min={-10}
                max={20}
                onChange={(v) => set("experiences", draft.experiences.map((e, j) => (j === i ? { ...e, value: v ?? Number.NaN } : e)))}
              />
              <button type="button" className="adx-btn adx-danger" onClick={() => set("experiences", draft.experiences.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          {draft.experiences.length < 6 ? (
            <div>
              <button type="button" className="adx-btn" onClick={() => set("experiences", [...draft.experiences, { name: "", value: 2 }])}>
                + Add Experience
              </button>
            </div>
          ) : null}
        </Fieldset>

        <Fieldset legend="Features">
          {draft.features.map((feature, i) => (
            <div key={i} className="adx-item" role="group" aria-label={`Feature ${i + 1}`}>
              <div className="adx-row">
                <TextField label="Feature name" value={feature.name} maxLength={80} onChange={(v) => setFeature(i, { name: v })} />
                <label className="adx-field">
                  <span className="adx-lbl">Kind</span>
                  <select className="adx-in" value={feature.kind} onChange={(e) => setFeature(i, { kind: e.target.value as AdversaryFeatureKind })}>
                    {KINDS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField label="Fear cost" nullable value={feature.fearCost} min={1} max={12} onChange={(v) => setFeature(i, { fearCost: v ?? undefined })} />
                <NumberField label="Countdown" nullable value={feature.countdown} min={1} max={100} onChange={(v) => setFeature(i, { countdown: v ?? undefined })} />
              </div>
              <label className="adx-field">
                <span className="adx-lbl">Feature text</span>
                <textarea className="adx-ta" rows={3} maxLength={2000} value={feature.text} onChange={(e) => setFeature(i, { text: e.target.value })} />
              </label>
              <div className="adx-item-tools">
                <button type="button" className="adx-btn" disabled={i === 0} onClick={() => moveFeature(i, -1)} aria-label={`Move ${feature.name || "feature"} up`}>
                  ↑
                </button>
                <button
                  type="button"
                  className="adx-btn"
                  disabled={i === draft.features.length - 1}
                  onClick={() => moveFeature(i, 1)}
                  aria-label={`Move ${feature.name || "feature"} down`}
                >
                  ↓
                </button>
                <button type="button" className="adx-btn adx-danger" onClick={() => set("features", draft.features.filter((_, j) => j !== i))}>
                  Remove feature
                </button>
              </div>
            </div>
          ))}
          {draft.features.length < 20 ? (
            <div>
              <button type="button" className="adx-btn" onClick={() => set("features", [...draft.features, { name: "", kind: "passive", text: "" }])}>
                + Add feature
              </button>
            </div>
          ) : null}
        </Fieldset>

        {shownError ? (
          <p role="alert" className="adx-error">
            {shownError}
          </p>
        ) : null}
        <div className="adx-actions">
          <button type="button" className="adx-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="adx-primary" disabled={create.pending || saving}>
            Save adversary
          </button>
        </div>
      </div>
      <div className="adx-preview">
        <p className="adx-preview-lbl">Preview</p>
        <StatBlock adversary={{ ...draft, tier: draft.tier as CustomTier, name: draft.name.trim() || "Unnamed adversary" }} />
      </div>
    </form>
  );
}
