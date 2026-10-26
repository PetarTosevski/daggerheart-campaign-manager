"use client";

import { useState } from "react";

import { RANGES } from "@/lib/frames/extras/common";
import { COMPANION_DICE, companionStats, COMPANION_EXPERIENCE_VALUE, TRAINING, type CompanionState, type TrainingId } from "@/lib/frames/extras/companion";
import { cn } from "@/lib/utils";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ALT_BTN, BTN, ErrorLine, Field, INPUT, LABEL, NOTE, PawIcon, Pips, PlaqueBox, TEXTAREA } from "./ui";

/**
 * Ranger companion sheet (Core pp.40–41), the board's csComp overlay. Edits are a local draft until saved;
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
    <>
      <div className="xs-cols">
        <div className="xs-col">
          <div className="xs-frame">
            <PawIcon size={46} />
            <input className={INPUT} aria-label="Companion name" disabled={ro} maxLength={80} placeholder="Name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            <input className={INPUT} aria-label="Companion animal" disabled={ro} maxLength={80} placeholder="What kind of animal?" value={draft.kind} onChange={(e) => patch({ kind: e.target.value })} />
          </div>

          <PlaqueBox level={3} title="Creation">
            <p className={NOTE}>
              Work with the GM to decide what kind of animal you have as your companion. Give them a name, then create two Experiences based on
              their training and the history you have together. Finally, describe their standard attack.
            </p>
            <p className={NOTE}>
              Start with +2 in two Experiences. Whenever you gain a new Experience, your companion also gains one. All new Experiences start at +2.
            </p>
          </PlaqueBox>

          <PlaqueBox level={3} title="Attack & Damage">
            <Field label="Attack">
              <input className={INPUT} disabled={ro} maxLength={80} placeholder="Bite, claws, talons…" value={draft.attack.name} onChange={(e) => patch({ attack: { ...draft.attack, name: e.target.value } })} />
            </Field>
            <div className="xs-kv">
              <span className={LABEL}>Range</span>
              <span className="xs-chips" aria-label={`Range ${stats.range}`} role="img">
                {RANGES.map((r) => (
                  <span key={r} className={cn("xs-chip", r === stats.range && "on")}>
                    {r}
                  </span>
                ))}
              </span>
            </div>
            <div className="xs-kv">
              <span className={LABEL}>Damage</span>
              <span className="xs-chips" aria-label={`Damage die d${stats.damageDie}`} role="img">
                {COMPANION_DICE.map((d) => (
                  <span key={d} className={cn("xs-chip", d === stats.damageDie && "on")}>
                    d{d}
                  </span>
                ))}
              </span>
            </div>
            <Field label="Damage type">
              <select className={INPUT} disabled={ro} value={draft.attack.damageType} onChange={(e) => patch({ attack: { ...draft.attack, damageType: e.target.value as "phy" | "mag" } })}>
                <option value="phy">Physical</option>
                <option value="mag">Magic</option>
              </select>
            </Field>
            <p className={NOTE}>
              When you command your companion to attack, <strong>they gain any benefits that would normally only apply to you</strong>. On a success,{" "}
              <strong>their damage roll uses your Proficiency and their damage die.</strong>
            </p>
          </PlaqueBox>

          <PlaqueBox level={3} title="Defense">
            <div className="flex flex-wrap items-center justify-between gap-3">
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
              <div className="xs-ev">
                <span data-testid="companion-evasion" className="xs-evn">
                  {stats.evasion}
                </span>
                <span className={LABEL}>Evasion</span>
              </div>
            </div>
            {saved.out ? <p className="xs-warn">Your companion has dropped out of the scene; they return with 1 Stress cleared at your next long rest.</p> : null}
            <p className={NOTE}>
              When your companion would take any amount of damage, they mark a Stress. When they mark their last Stress, they drop out of the scene.
            </p>
          </PlaqueBox>
        </div>

        <div className="xs-col">
          <PlaqueBox level={3} title="Experiences">
            <span className={LABEL}>
              {draft.experiences.length} / {stats.experienceLimit}
            </span>
            {draft.experiences.map((exp, i) => (
              <div key={i} className="xs-row">
                <input
                  className={cn(INPUT, "xs-grow")}
                  aria-label={`Companion Experience ${i + 1}`}
                  disabled={ro}
                  maxLength={80}
                  value={exp.name}
                  onChange={(e) => patch({ experiences: draft.experiences.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                />
                <input
                  className={cn(INPUT, "xs-narrow")}
                  type="number"
                  aria-label={`Companion Experience ${i + 1} modifier`}
                  disabled={ro}
                  value={exp.value}
                  onChange={(e) => patch({ experiences: draft.experiences.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)) })}
                />
                {canEdit ? (
                  <button type="button" className={ALT_BTN} aria-label={`Remove Experience ${i + 1}`} onClick={() => patch({ experiences: draft.experiences.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                ) : null}
              </div>
            ))}
            {canEdit && draft.experiences.length < stats.experienceLimit ? (
              <button
                type="button"
                className={cn(BTN, "self-start")}
                onClick={() => patch({ experiences: [...draft.experiences, { name: "", value: COMPANION_EXPERIENCE_VALUE }] })}
              >
                Add Experience (+{COMPANION_EXPERIENCE_VALUE})
              </button>
            ) : null}
            <p className={NOTE}>
              <strong>Make a Spellcast Roll</strong> to connect with your companion and command them to take action. Spend a Hope to add an applicable
              Companion Experience to the roll.
            </p>
          </PlaqueBox>

          <PlaqueBox level={3} title="Training">
            <div className="xs-cap">
              <span>
                One option per level-up{draft.bonusTraining ? `, plus ${draft.bonusTraining} from Expert/Advanced Training` : ""}.
              </span>
              <strong>
                {stats.trainingUsed} / {stats.trainingCap}
              </strong>
            </div>
            <div className="xs-train">
              {TRAINING.map((t) => {
                const n = draft.training[t.id] ?? 0;
                return (
                  <div key={t.id} className="xs-tr">
                    <span className="xs-ticks">
                      {Array.from({ length: t.max }, (_, k) => (
                        <input
                          key={k}
                          type="checkbox"
                          className="xs-tick"
                          aria-label={`${t.name} ${k + 1}`}
                          checked={k < n}
                          disabled={ro || (k >= n && (k !== n || stats.trainingUsed >= stats.trainingCap)) || (k < n && k !== n - 1)}
                          onChange={() => setTraining(t.id, k < n ? n - 1 : n + 1)}
                        />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong>{t.name}:</strong> {t.text}
                      {t.id === "vicious" && n > 0 ? (
                        <span className="mt-1.5 flex flex-wrap gap-2">
                          {draft.vicious.map((step, i) => (
                            <select
                              key={i}
                              className={cn(INPUT, "xs-mid")}
                              aria-label={`Vicious ${i + 1}`}
                              disabled={ro}
                              value={step}
                              onChange={(e) => patch({ vicious: draft.vicious.map((x, j) => (j === i ? (e.target.value as "die" | "range") : x)) })}
                            >
                              <option value="die">Damage die</option>
                              <option value="range">Range</option>
                            </select>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
            <Field label="Expert/Advanced Training options">
              <select className={INPUT} disabled={ro} value={draft.bonusTraining} onChange={(e) => patch({ bonusTraining: Number(e.target.value) })}>
                <option value={0}>None</option>
                <option value={1}>+1 (Expert Training)</option>
                <option value={3}>+3 (Expert and Advanced Training)</option>
              </select>
            </Field>
          </PlaqueBox>

          <PlaqueBox level={3} title="Special Gifts">
            <textarea className={TEXTAREA} aria-label="Special gifts" disabled={ro} maxLength={2000} value={draft.gifts} onChange={(e) => patch({ gifts: e.target.value })} />
          </PlaqueBox>
          <PlaqueBox level={3} title="Inventory">
            <textarea className={TEXTAREA} aria-label="Companion inventory" disabled={ro} maxLength={2000} value={draft.inventory} onChange={(e) => patch({ inventory: e.target.value })} />
          </PlaqueBox>
        </div>
      </div>

      {canEdit ? (
        <div className="xs-actions">
          <button type="button" className={BTN} disabled={!dirty || save.pending} onClick={() => void save.fire({ characterId, state: draft })}>
            Save companion
          </button>
          <button type="button" className={ALT_BTN} disabled={!dirty} onClick={() => setDraft(state)}>
            Discard changes
          </button>
        </div>
      ) : null}
      <ErrorLine error={save.error} />
    </>
  );
}
