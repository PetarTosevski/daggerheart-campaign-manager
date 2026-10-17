"use client";

import { useState } from "react";

import { EVOLVED, HYBRID, resolveBeastform, type BeastformState } from "@/lib/frames/extras/beastform";
import { TRAIT_LABEL, traitIdSchema } from "@/lib/frames/extras/common";
import { BEASTFORMS } from "@/lib/srd/beastforms";
import type { TraitId } from "@/lib/srd/types";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BTN, ErrorLine, ExtraCard, Field, INPUT, LABEL, NOTE } from "./ui";

const TRAITS = traitIdSchema.options;
const plain = (maxTier: number) => BEASTFORMS.filter((b) => b.tier <= maxTier && !EVOLVED[b.id] && !HYBRID[b.id]);

/** Druid Beastform (Core pp.31–35): the active form and its statistics. */
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
  const [draft, setDraft] = useState<BeastformState>(state);
  const active = resolveBeastform(state);
  const chosen = draft.formId ? BEASTFORMS.find((b) => b.id === draft.formId) : undefined;
  const evolved = chosen ? EVOLVED[chosen.id] : undefined;
  const hybrid = chosen ? HYBRID[chosen.id] : undefined;
  const sources = (draft.hybrid?.sources ?? []).map((id) => BEASTFORMS.find((b) => b.id === id)!).filter(Boolean);

  const pickForm = (formId: string) =>
    setDraft({ formId: formId || null, ...(draft.evolutionTrait && formId ? { evolutionTrait: draft.evolutionTrait } : {}) });
  const setHybrid = (patch: Partial<NonNullable<BeastformState["hybrid"]>>) =>
    setDraft({ ...draft, hybrid: { sources: [], advantages: [], features: [], ...draft.hybrid, ...patch } });
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <ExtraCard title="Beastform" subtitle={`Mark a Stress to transform into a creature of your tier (${tier}) or lower.`}>
      {active ? (
        <div data-testid="active-beastform" className="flex flex-col gap-1.5 rounded-lg border border-[#3f6f2f] bg-[#15240f] p-3">
          <span className={LABEL}>Current form</span>
          <strong className="text-[16px] text-parchment">{active.name}</strong>
          <span className="text-[13px] text-[#c9d6c0] italic">({active.examples})</span>
          <span className="text-[14px] text-[#e6ecea]">
            {[
              active.traitBonus ? `${TRAIT_LABEL[active.traitBonus.trait]} +${active.traitBonus.bonus}` : null,
              `Evasion +${active.evasionBonus}`,
              active.attack ? `${active.attack.range} ${TRAIT_LABEL[active.attack.trait]} ${active.attack.damage}` : null,
              active.evolutionTrait ? `Evolution: ${TRAIT_LABEL[active.evolutionTrait]} +1` : null,
            ]
              .filter(Boolean)
              .join(" | ")}
          </span>
          {active.advantages.length ? <span className="text-[14px] text-[#e6ecea]">Advantage on: {active.advantages.join(", ")}</span> : null}
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-[#c9d6c0]">
            {active.features.map((f) => (
              <li key={f.name}>
                <strong className="text-[#e6ecea]">{f.name}:</strong> {f.text}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <button
              type="button"
              className={BTN}
              disabled={set.pending}
              onClick={() => void set.fire({ characterId, state: { formId: null } })}
            >
              Drop beastform
            </button>
          ) : null}
        </div>
      ) : (
        <p className={NOTE}>Not transformed.</p>
      )}

      {canEdit ? (
        <div className="flex flex-col gap-3">
          <Field label="Transform into">
            <select className={INPUT} value={draft.formId ?? ""} onChange={(e) => pickForm(e.target.value)}>
              <option value="">Choose a form…</option>
              {[1, 2, 3, 4].map((t) => (
                <optgroup key={t} label={`Tier ${t}${t > tier ? " (locked)" : ""}`}>
                  {BEASTFORMS.filter((b) => b.tier === t).map((b) => (
                    <option key={b.id} value={b.id} disabled={t > tier}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

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
              <div className="flex flex-wrap gap-2">
                {plain(hybrid.maxTier).map((b) => (
                  <label key={b.id} className="flex items-center gap-1.5 text-[13px] text-[#e6ecea]">
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
                  <div className="flex flex-wrap gap-2">
                    {[...new Set(sources.flatMap((s) => s.advantages))].map((adv) => (
                      <label key={adv} className="flex items-center gap-1.5 text-[13px] text-[#e6ecea]">
                        <input
                          type="checkbox"
                          checked={draft.hybrid?.advantages.includes(adv) ?? false}
                          onChange={() => setHybrid({ advantages: toggle(draft.hybrid?.advantages ?? [], adv) })}
                        />
                        {adv}
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[...new Set(sources.flatMap((s) => s.features.map((f) => f.name)))].map((name) => (
                      <label key={name} className="flex items-center gap-1.5 text-[13px] text-[#e6ecea]">
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

          {draft.formId ? (
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
          ) : null}

          <button type="button" className={BTN} disabled={!draft.formId || set.pending} onClick={() => void set.fire({ characterId, state: draft })}>
            Transform
          </button>
          <p className={NOTE}>Mark the Stress (or spend 3 Hope for Evolution) on your sheet.</p>
        </div>
      ) : null}
      <ErrorLine error={set.error} />
    </ExtraCard>
  );
}
