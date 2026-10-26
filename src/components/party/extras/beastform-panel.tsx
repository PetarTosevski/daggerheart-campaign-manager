"use client";

import { useState } from "react";

import { EVOLVED, HYBRID, resolveBeastform, type BeastformState } from "@/lib/frames/extras/beastform";
import { TRAIT_LABEL, traitIdSchema } from "@/lib/frames/extras/common";
import { BEASTFORMS } from "@/lib/srd/beastforms";
import type { Beastform, TraitId } from "@/lib/srd/types";
import { cn } from "@/lib/utils";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ALT_BTN, BTN, ErrorLine, Field, INPUT, LABEL, NOTE, PlaqueBox } from "./ui";

const TRAITS = traitIdSchema.options;
const TIERS = [1, 2, 3, 4] as const;
const TIER_LEVELS = { 1: "Level 1", 2: "Level 2–4", 3: "Level 5–7", 4: "Level 8–10" } as const;
const plain = (maxTier: number) => BEASTFORMS.filter((b) => b.tier <= maxTier && !EVOLVED[b.id] && !HYBRID[b.id]);

/** "Agility +1 | Evasion +2 | Melee Agility d4 phy": the board's cs-fstat line. */
function statLine(form: Pick<Beastform, "traitBonus" | "attack"> & { evasionBonus: number | null }, evolutionTrait?: TraitId | null) {
  return [
    form.traitBonus ? `${TRAIT_LABEL[form.traitBonus.trait]} +${form.traitBonus.bonus}` : null,
    form.evasionBonus !== null ? `Evasion +${form.evasionBonus}` : null,
    form.attack ? `${form.attack.range} ${TRAIT_LABEL[form.attack.trait]} ${form.attack.damage}` : null,
    evolutionTrait ? `Evolution: ${TRAIT_LABEL[evolutionTrait]} +1` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

/**
 * Druid Beastform sheet (Core pp.31–35), the board's csBeast overlay: the current form, then the forms by tier as
 * cs-tier plaques. Choosing a form opens its options (upgraded form, hybrid picks, Evolution trait) under it.
 */
export function BeastformPanel({
  characterId,
  state,
  tier,
  canEdit,
}: {
  characterId: Id<"characters">;
  state: BeastformState;
  tier: number;
  canEdit: boolean;
}) {
  const set = useIntent(api.characterExtras.setBeastform);
  const [draft, setDraft] = useState<BeastformState>({ formId: null });
  const active = resolveBeastform(state);
  const chosen = draft.formId ? BEASTFORMS.find((b) => b.id === draft.formId) : undefined;
  const evolved = chosen ? EVOLVED[chosen.id] : undefined;
  const hybrid = chosen ? HYBRID[chosen.id] : undefined;
  const sources = (draft.hybrid?.sources ?? []).map((id) => BEASTFORMS.find((b) => b.id === id)!).filter(Boolean);

  const pickForm = (formId: string | null) =>
    setDraft({ formId, ...(draft.evolutionTrait && formId ? { evolutionTrait: draft.evolutionTrait } : {}) });
  const setHybrid = (patch: Partial<NonNullable<BeastformState["hybrid"]>>) =>
    setDraft({ ...draft, hybrid: { sources: [], advantages: [], features: [], ...draft.hybrid, ...patch } });
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const options = (
    <div className="xs-pick">
      {evolved ? (
        <Field label="Upgraded form">
          <select className={INPUT} value={draft.baseFormId ?? ""} onChange={(e) => setDraft({ ...draft, baseFormId: e.target.value || undefined })}>
            <option value="">Choose…</option>
            {plain(Math.max(...evolved.baseTiers)).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} (Tier {b.tier})
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {hybrid ? (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={LABEL}>
            Combine {hybrid.sources} forms, {hybrid.advantages} advantages, {hybrid.features} features
          </legend>
          <div className="xs-checks">
            {plain(hybrid.maxTier).map((b) => (
              <label key={b.id} className="xs-check">
                <input
                  type="checkbox"
                  checked={draft.hybrid?.sources.includes(b.id) ?? false}
                  onChange={() => setHybrid({ sources: toggle(draft.hybrid?.sources ?? [], b.id), advantages: [], features: [] })}
                />
                {b.name}
              </label>
            ))}
          </div>
          {sources.length ? (
            <>
              <div className="xs-checks">
                {[...new Set(sources.flatMap((s) => s.advantages))].map((adv) => (
                  <label key={adv} className="xs-check">
                    <input
                      type="checkbox"
                      checked={draft.hybrid?.advantages.includes(adv) ?? false}
                      onChange={() => setHybrid({ advantages: toggle(draft.hybrid?.advantages ?? [], adv) })}
                    />
                    {adv}
                  </label>
                ))}
              </div>
              <div className="xs-checks">
                {[...new Set(sources.flatMap((s) => s.features.map((f) => f.name)))].map((name) => (
                  <label key={name} className="xs-check">
                    <input
                      type="checkbox"
                      checked={draft.hybrid?.features.includes(name) ?? false}
                      onChange={() => setHybrid({ features: toggle(draft.hybrid?.features ?? [], name) })}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </fieldset>
      ) : null}

      <Field label="Evolution trait (spent 3 Hope)">
        <select
          className={INPUT}
          value={draft.evolutionTrait ?? ""}
          onChange={(e) => setDraft({ ...draft, evolutionTrait: (e.target.value || undefined) as TraitId | undefined })}
        >
          <option value="">None</option>
          {TRAITS.map((t) => (
            <option key={t} value={t}>
              {TRAIT_LABEL[t]} +1
            </option>
          ))}
        </select>
      </Field>

      <div className="xs-actions">
        <button type="button" className={BTN} disabled={set.pending} onClick={() => void set.fire({ characterId, state: draft })}>
          Transform
        </button>
        <button type="button" className={ALT_BTN} onClick={() => pickForm(null)}>
          Cancel
        </button>
      </div>
      <p className={NOTE}>Mark the Stress (or spend 3 Hope for Evolution) on your sheet.</p>
    </div>
  );

  return (
    <>
      <p className="xs-intro">
        <strong>Beastform:</strong> Mark a Stress to magically transform into a creature of your tier or lower. While transformed you can’t use
        weapons or cast spells from domain cards, but you can still use other features you have access to.
      </p>

      {active ? (
        <div data-testid="active-beastform" className="xs-cur">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="xs-cur-k">Current form</span>
            <b className="xs-cur-n">{active.name}</b>
            <span className="text-[13px] italic">({active.examples})</span>
            <span className="text-[14px] italic">{statLine(active, active.evolutionTrait)}</span>
            {active.advantages.length ? <span className="text-[14px]">Advantage on: {active.advantages.join(", ")}</span> : null}
            <ul>
              {active.features.map((f) => (
                <li key={f.name}>
                  <strong>{f.name}:</strong> {f.text}
                </li>
              ))}
            </ul>
          </div>
          {canEdit ? (
            <button type="button" className={ALT_BTN} disabled={set.pending} onClick={() => void set.fire({ characterId, state: { formId: null } })}>
              Drop beastform
            </button>
          ) : null}
        </div>
      ) : (
        <p className={NOTE}>Not transformed.</p>
      )}
      <ErrorLine error={set.error} />

      <div className="xs-tiers">
        {TIERS.map((t) => {
          const locked = t > tier;
          return (
            <PlaqueBox key={t} level={3} title={`Tier ${t} (${TIER_LEVELS[t]})`} className={cn("xs-tier", locked && "locked")}>
              {locked ? <p className="xs-lockt">Unlocks at a higher tier</p> : null}
              {BEASTFORMS.filter((b) => b.tier === t).map((b) => {
                const on = draft.formId === b.id;
                return (
                  <div key={b.id} className={cn("xs-form", (on || active?.form.id === b.id) && "on")}>
                    <div className="xs-fhead">
                      <h4 className="xs-fname">{b.name}</h4>
                      {canEdit && !locked ? (
                        <button
                          type="button"
                          className={BTN}
                          aria-pressed={on}
                          aria-label={`Choose ${b.name}`}
                          onClick={() => pickForm(on ? null : b.id)}
                        >
                          Choose
                        </button>
                      ) : null}
                    </div>
                    <div className="xs-fex">({b.examples})</div>
                    {statLine(b) ? <div className="xs-fstat">{statLine(b)}</div> : null}
                    {b.advantages.length ? <div className="xs-fstat mt-0">Gain advantage on: {b.advantages.join(", ")}</div> : null}
                    {b.features.map((f) => (
                      <div key={f.name} className="xs-ftext">
                        <strong>{f.name}:</strong> {f.text}
                      </div>
                    ))}
                    {on && canEdit ? options : null}
                  </div>
                );
              })}
            </PlaqueBox>
          );
        })}
      </div>
    </>
  );
}
