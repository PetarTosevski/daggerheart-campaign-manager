"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useRef, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { classActions, hopeFeature } from "@/lib/domain/class-features/hooks";
import { CLASS_FEATURES, CLASS_STATE_LABELS, classFeaturesAvailable } from "@/lib/domain/class-features/index";
import type { FeatureMeta } from "@/lib/domain/class-features/types";
import { TRAIT_IDS } from "@/lib/srd/types";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SlotProps } from "../slots";

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

/** The ally picker for `target: "ally"` features; Witch's Charm may also pick yourself. */
function AllyPicker({ campaignId, self, allowSelf, value, onChange }: { campaignId: Id<"campaigns">; self: Id<"characters">; allowSelf: boolean; value: Id<"characters"> | ""; onChange: (v: Id<"characters"> | "") => void }) {
  const party = useQuery(api.characters.listByCampaign, { campaignId });
  const allies = (party ?? []).filter((c) => c._id !== self && c.status === "active");
  return (
    <label className="flex flex-col gap-1">
      <span className="cs-lbl">Target</span>
      <select className="cs-in" value={value} onChange={(e) => onChange(allies.find((c) => c._id === e.target.value)?._id ?? "")} disabled={party === undefined}>
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

/** Volatile Magic: pick damage dice of the latest damage roll to reroll. */
function DamageDicePicker({ characterId, value, onChange }: { characterId: Id<"characters">; value: number[]; onChange: (v: number[]) => void }) {
  const roll = useQuery(api.classFeatures.lastRoll, { characterId });
  if (roll === undefined) return <span className="cs-small italic">Loading your latest roll…</span>;
  if (roll === null || roll.kind !== "damage") return <span className="cs-small italic">Roll damage first: your latest roll is not a damage roll.</span>;
  return (
    <fieldset className="flex flex-wrap items-center gap-3">
      <legend className="cs-lbl">Dice to reroll (total {roll.total})</legend>
      {roll.dice.map((d, i) =>
        d.role === "damage" && !d.dropped ? (
          <label key={i} className="flex min-h-11 items-center gap-2 text-[16px]">
            <input
              type="checkbox"
              className="size-5 accent-[#6b5a45]"
              checked={value.includes(i)}
              onChange={(e) => onChange(e.target.checked ? [...value, i] : value.filter((x) => x !== i))}
            />
            d{d.sides}: {d.value}
          </label>
        ) : null,
      )}
    </fieldset>
  );
}

function FeatureCard({ feature, props, blocked }: { feature: FeatureMeta; props: SlotProps; blocked: string | null }) {
  const { character, campaignId, canEdit } = props;
  const applyFeature = useMutation(api.classFeatures.use);
  const { run, busy, error } = useIntent();
  const [target, setTarget] = useState<Id<"characters"> | "">("");
  const [choice, setChoice] = useState("");
  const [dieIndexes, setDieIndexes] = useState<number[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const cost = costLabel(feature);
  const short = feature.cost?.hope !== undefined && character.sheet.hope < feature.cost.hope;
  const needsTarget = feature.target === "ally" && feature.key !== "witchsCharm";
  const missing = (needsTarget && target === "") || (feature.key === "evolution" && choice === "") || (feature.key === "volatileMagic" && dieIndexes.length === 0);

  async function submit() {
    setDone(null);
    const ok = await run((idempotencyKey) =>
      applyFeature({
        characterId: character._id,
        featureKey: feature.key,
        params: {
          ...(target ? { targetId: target } : {}),
          ...(choice ? { choice } : {}),
          ...(dieIndexes.length ? { dieIndexes } : {}),
        },
        idempotencyKey,
      }).then((r) => setDone(r.summary)),
    );
    if (ok) setDieIndexes([]);
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={feature.name}>
      <p className="cs-small m-0">
        <strong className="font-display text-[14px]">{feature.name}</strong>
        {cost ? <span className="cs-lbl ml-2">{cost}</span> : null}
        {feature.automation === "assist" ? <span className="cs-lbl ml-2">(reminder)</span> : null}
        {feature.text ? <span className="block">{feature.text}</span> : null}
      </p>
      {canEdit && feature.use ? (
        <div className="flex flex-wrap items-end gap-3">
          {feature.target === "ally" ? (
            <AllyPicker campaignId={campaignId} self={character._id} allowSelf={!needsTarget} value={target} onChange={setTarget} />
          ) : null}
          {feature.key === "evolution" ? (
            <label className="flex flex-col gap-1">
              <span className="cs-lbl">Trait +1</span>
              <select className="cs-in" value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="">Choose a trait</option>
                {TRAIT_IDS.map((t) => (
                  <option key={t} value={t}>
                    {TRAIT_LABEL(t)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {feature.key === "volatileMagic" ? <DamageDicePicker characterId={character._id} value={dieIndexes} onChange={setDieIndexes} /> : null}
          <button type="button" className="cs-pill cs-solid" disabled={busy || blocked !== null || short || missing} onClick={() => void submit()}>
            Use {feature.name}
          </button>
        </div>
      ) : null}
      {canEdit && (blocked ?? (short ? `Needs ${feature.cost?.hope} Hope.` : null)) ? (
        <span className="cs-small italic">{blocked ?? `Needs ${feature.cost?.hope} Hope.`}</span>
      ) : null}
      <p className="cs-small m-0 italic" aria-live="polite">
        {error ? (
          <span role="alert" className="text-[#8e2b2b]">
            {error}
          </span>
        ) : (
          done
        )}
      </p>
    </div>
  );
}

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
    <div className="flex flex-col gap-2">
      <span className="cs-lbl">Active effects</span>
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Active effects">
        {effects.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-3">
            <span className="cs-small">
              <strong className="font-display text-[14px]">{e.source}:</strong> {e.text}
            </span>
            {canEdit ? (
              <button
                type="button"
                className="cs-pill ml-auto"
                disabled={busy}
                aria-label={`End ${e.source}`}
                onClick={() => void run((idempotencyKey) => endEffect({ characterId: character._id, effectId: e.id, idempotencyKey }))}
              >
                End
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit && hitEffects.length > 0 ? (
        <div>
          <button type="button" className="cs-pill" disabled={busy} onClick={() => void run((idempotencyKey) => gotHit({ characterId: character._id, idempotencyKey }))}>
            Got hit
          </button>
          <span className="cs-small ml-3 italic">An attack succeeded against you: ends {hitEffects.map((e) => e.source).join(", ")}.</span>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="cs-small m-0 text-[#8e2b2b]">
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
    const text = typeof value === "object" && !Array.isArray(value) ? `${value.value} / d${value.max}` : Array.isArray(value) ? value.join(", ") || "none" : typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
    return [[CLASS_STATE_LABELS[k], text]];
  });
}

function blockedReason(props: SlotProps): string | null {
  const { character } = props;
  if (character.status === "dead") return "Dead characters can't use features.";
  if (character.status === "away") return "Away characters can't use features.";
  if ((character.sheet.conditions ?? []).includes("unconscious")) return "Unconscious: can't use features until an ally clears a Hit Point or the party finishes a long rest.";
  return null;
}

/** The features panel: Hope feature and class actions, active effects, conditions, held dice and class counters. */
export function FeaturesBox(props: SlotProps) {
  const headingId = useId();
  const sheet = props.character.sheet;
  const available = classFeaturesAvailable(sheet.classId, props.hopeAndFear);
  const hope = available ? hopeFeature(sheet) : undefined;
  // Class actions of the class and the multiclass, each offered only if its class is (Hope & Fear option).
  const actions = classActions(sheet).filter((f) =>
    [sheet.classId, sheet.multiclass?.classId].some((id) => id !== undefined && classFeaturesAvailable(id, props.hopeAndFear) && CLASS_FEATURES[id]?.classActions?.includes(f)),
  );
  const conditions = sheet.conditions ?? [];
  const held = sheet.heldDice ?? [];
  const state = stateEntries(sheet);
  const effects = sheet.effects ?? [];
  if (!hope && actions.length === 0 && effects.length === 0 && conditions.length === 0 && held.length === 0 && state.length === 0) return null;
  const blocked = blockedReason(props);

  return (
    <section className="cs-box" aria-labelledby={headingId}>
      <h3 id={headingId} className="cs-h">
        Features
      </h3>
      {hope ? <FeatureCard feature={hope} props={props} blocked={blocked} /> : null}
      {actions.map((f) => (
        <FeatureCard key={f.key} feature={f} props={props} blocked={blocked} />
      ))}
      <Effects props={props} />
      {conditions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="cs-lbl">Conditions</span>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Conditions">
            {conditions.map((c) => (
              <li key={c} className="cs-thr-pill">
                {TRAIT_LABEL(c)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {held.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="cs-lbl">Held dice</span>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Held dice">
            {held.map((d) => (
              <li key={d.id} className="cs-thr-pill">
                {TRAIT_LABEL(d.kind)} d{d.sides}
                {d.value !== undefined ? `: ${d.value}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.length > 0 ? (
        <dl className="cs-small m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {state.map(([label, text]) => (
            <div key={label} className="contents">
              <dt className="cs-lbl">{label}</dt>
              <dd className="m-0">{text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
