"use client";

import { useState } from "react";

import { companionStats, COMPANION_EXPERIENCE_VALUE, TRAINING, type CompanionState, type TrainingId } from "@/lib/frames/extras/companion";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BTN, ErrorLine, ExtraCard, Field, INPUT, LABEL, NOTE, Pips } from "./ui";

/**
 * Ranger companion sheet (Core pp.40–41). Edits are a local draft until saved;
 * Stress saves at once. The parent remounts it (key) when the saved state changes.
 */
export function CompanionPanel({
  characterId,
  state,
  level,
  canEdit,
}: {
  characterId: Id<"characters">;
  state: CompanionState;
  level: number;
  canEdit: boolean;
}) {
  const save = useIntent(api.characterExtras.saveCompanion);
  const [draft, setDraft] = useState<CompanionState>(state);
  const stats = companionStats(draft, level);
  const saved = companionStats(state, level);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state);
  const ro = !canEdit;
  const patch = (p: Partial<CompanionState>) => setDraft({ ...draft, ...p });

  const setTraining = (id: TrainingId, n: number) => {
    const training = { ...draft.training, [id]: n };
    if (n === 0) delete training[id];
    const vicious = id === "vicious" ? [...draft.vicious.slice(0, n), ...Array<"die">(Math.max(0, n - draft.vicious.length)).fill("die")] : draft.vicious;
    patch({ training, vicious });
  };

  return (
    <ExtraCard title={state.name ? `Companion: ${state.name}` : "Companion"} subtitle="Your Beastbound animal companion and their training.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className={INPUT} disabled={ro} maxLength={80} value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field label="Animal">
          <input className={INPUT} disabled={ro} maxLength={80} placeholder="What kind of animal?" value={draft.kind} onChange={(e) => patch({ kind: e.target.value })} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex flex-col items-center">
          <span data-testid="companion-evasion" className="font-display text-[28px] text-parchment">
            {stats.evasion}
          </span>
          <span className={LABEL}>Evasion</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className={LABEL}>
            Stress {state.stress} / {saved.stressMax}
          </span>
          <Pips
            label="Companion Stress"
            marked={state.stress}
            total={saved.stressMax}
            disabled={ro || save.pending || dirty}
            onSet={(stress) => void save.fire({ characterId, state: { ...state, stress } })}
          />
        </div>
      </div>
      {saved.out ? <p className={NOTE}>Your companion has dropped out of the scene; they return with 1 Stress cleared at your next long rest.</p> : null}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label={`Attack (${stats.range}, d${stats.damageDie} + your Proficiency)`}>
          <input className={INPUT} disabled={ro} maxLength={80} placeholder="Bite, claws, talons…" value={draft.attack.name} onChange={(e) => patch({ attack: { ...draft.attack, name: e.target.value } })} />
        </Field>
        <Field label="Damage type">
          <select className={INPUT} disabled={ro} value={draft.attack.damageType} onChange={(e) => patch({ attack: { ...draft.attack, damageType: e.target.value as "phy" | "mag" } })}>
            <option value="phy">Physical</option>
            <option value="mag">Magic</option>
          </select>
        </Field>
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={LABEL}>
          Experiences ({draft.experiences.length} / {stats.experienceLimit})
        </legend>
        {draft.experiences.map((exp, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={`${INPUT} flex-1`}
              aria-label={`Companion Experience ${i + 1}`}
              disabled={ro}
              maxLength={80}
              value={exp.name}
              onChange={(e) => patch({ experiences: draft.experiences.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
            />
            <input
              className={`${INPUT} w-20`}
              type="number"
              aria-label={`Companion Experience ${i + 1} modifier`}
              disabled={ro}
              value={exp.value}
              onChange={(e) => patch({ experiences: draft.experiences.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)) })}
            />
            {canEdit ? (
              <button type="button" className={BTN} aria-label={`Remove Experience ${i + 1}`} onClick={() => patch({ experiences: draft.experiences.filter((_, j) => j !== i) })}>
                ✕
              </button>
            ) : null}
          </div>
        ))}
        {canEdit && draft.experiences.length < stats.experienceLimit ? (
          <button
            type="button"
            className={BTN}
            onClick={() => patch({ experiences: [...draft.experiences, { name: "", value: COMPANION_EXPERIENCE_VALUE }] })}
          >
            Add Experience (+{COMPANION_EXPERIENCE_VALUE})
          </button>
        ) : null}
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={LABEL}>
          Training {stats.trainingUsed} / {stats.trainingCap}
        </legend>
        <p className={NOTE}>One option per level-up{draft.bonusTraining ? `, plus ${draft.bonusTraining} from Expert/Advanced Training` : ""}.</p>
        {TRAINING.map((t) => {
          const n = draft.training[t.id] ?? 0;
          return (
            <div key={t.id} className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <span className="flex gap-1 pt-0.5">
                  {Array.from({ length: t.max }, (_, k) => (
                    <input
                      key={k}
                      type="checkbox"
                      aria-label={`${t.name} ${k + 1}`}
                      checked={k < n}
                      disabled={ro || (k >= n && (k !== n || stats.trainingUsed >= stats.trainingCap)) || (k < n && k !== n - 1)}
                      onChange={() => setTraining(t.id, k < n ? n - 1 : n + 1)}
                    />
                  ))}
                </span>
                <span className="text-[13px] text-[#c9d6c0]">
                  <strong className="text-[#e6ecea]">{t.name}:</strong> {t.text}
                </span>
              </div>
              {t.id === "vicious" && n > 0 ? (
                <div className="flex flex-wrap gap-2 pl-6">
                  {draft.vicious.map((step, i) => (
                    <select
                      key={i}
                      className={INPUT}
                      aria-label={`Vicious ${i + 1}`}
                      disabled={ro}
                      value={step}
                      onChange={(e) => patch({ vicious: draft.vicious.map((x, j) => (j === i ? (e.target.value as "die" | "range") : x)) })}
                    >
                      <option value="die">Damage die</option>
                      <option value="range">Range</option>
                    </select>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <Field label="Expert/Advanced Training options">
          <select className={INPUT} disabled={ro} value={draft.bonusTraining} onChange={(e) => patch({ bonusTraining: Number(e.target.value) })}>
            <option value={0}>None</option>
            <option value={1}>+1 (Expert Training)</option>
            <option value={3}>+3 (Expert and Advanced Training)</option>
          </select>
        </Field>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Special gifts">
          <textarea className={`${INPUT} min-h-20 py-2`} disabled={ro} maxLength={2000} value={draft.gifts} onChange={(e) => patch({ gifts: e.target.value })} />
        </Field>
        <Field label="Inventory">
          <textarea className={`${INPUT} min-h-20 py-2`} disabled={ro} maxLength={2000} value={draft.inventory} onChange={(e) => patch({ inventory: e.target.value })} />
        </Field>
      </div>

      {canEdit ? (
        <div className="flex gap-2">
          <button type="button" className={BTN} disabled={!dirty || save.pending} onClick={() => void save.fire({ characterId, state: draft })}>
            Save companion
          </button>
          <button type="button" className={BTN} disabled={!dirty} onClick={() => setDraft(state)}>
            Discard changes
          </button>
        </div>
      ) : null}
      <ErrorLine error={save.error} />
    </ExtraCard>
  );
}
