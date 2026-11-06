"use client";

import { useMutation } from "convex/react";
import { useId, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import { BEASTFORMS } from "@/lib/srd/beastforms";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { Drawer, DrawerFeature } from "./model";
import { hasFlowState, stanceId, titleCase } from "./model";

type Props = { campaignId: Id<"campaigns">; characterId: Id<"characters">; canAct: boolean };

/** Runs a keyed mutation once per click and keeps a failure for the drawer's alert (rule 12: intents, no snapshots). */
function useAction() {
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return { error, run };
}

const alertOf = (error: string | null) =>
  error ? (
    <p role="alert" className="sd-error">
      {error}
    </p>
  ) : null;

/** Q16: the Flying toggle for a character holding a flying feature (`combatFeatures.setFlying`, a sheet effect until turned off). */
export function FlyingToggle({ campaignId, characterId, canAct, flying }: Props & { flying: boolean }) {
  const { error, run } = useAction();
  const setFlying = useMutation(api.combatFeatures.setFlying).withOptimisticUpdate((store, args) => {
    const query = { campaignId, characterId: args.characterId };
    const drawer = store.getQuery(api.combatFeaturesReads.drawer, query);
    if (drawer) store.setQuery(api.combatFeaturesReads.drawer, query, { ...drawer, flying: args.flying });
  });
  return (
    <div className="sd-flying">
      <BrandButton
        variant="neutral"
        aria-pressed={flying}
        disabled={!canAct}
        data-testid="sheet-drawer-flying"
        onClick={() => run(() => setFlying({ campaignId, idempotencyKey: crypto.randomUUID(), characterId, flying: !flying }))}
      >
        Flying
      </BrandButton>
      <span className="cm-muted">{flying ? "You are in the air. Features that need flying apply." : "On the ground."}</span>
      {alertOf(error)}
    </div>
  );
}

/** Q5: the Martial Artist's Focus, Refocus (once per rest, during a moment of calm) and the shift buttons of the known stances. */
export function StanceControls({ campaignId, characterId, canAct, martial, features }: Props & { martial: NonNullable<Drawer["martial"]>; features: readonly DrawerFeature[] }) {
  const { error, run } = useAction();
  const calmId = useId();
  const [calm, setCalm] = useState(false);
  const shift = useMutation(api.combatFeatures.shiftStance);
  const refocus = useMutation(api.combatFeatures.refocus);
  const flow = hasFlowState(features);
  const stances = features.filter((f) => f.source === "stance");
  return (
    <div className="sd-stances" role="group" aria-label="Stances" data-testid="sheet-drawer-stances">
      <p className="sd-focus">
        <span className="cm-lbl">Focus</span> {martial.focus} / {martial.max}
        {martial.active ? <span className="sd-badge sd-badge-on">In stance</span> : <span className="sd-badge">No stance</span>}
      </p>
      <div className="sd-refocus">
        <label htmlFor={calmId} className="sd-check">
          <input id={calmId} type="checkbox" checked={calm} onChange={(e) => setCalm(e.target.checked)} />
          <span>It is a moment of calm</span>
        </label>
        <BrandButton
          variant="neutral"
          disabled={!canAct || !martial.refocusReady || !calm}
          onClick={() => run(async () => { await refocus({ campaignId, idempotencyKey: crypto.randomUUID(), characterId, calm }); setCalm(false); })}
        >
          Refocus
        </BrandButton>
        {!martial.refocusReady ? <span className="cm-muted">Used. Back after a rest.</span> : null}
      </div>
      <ul className="sd-shift-list" aria-label="Shift stance">
        {stances.map((f) => {
          const id = stanceId(f.featureId);
          const active = martial.active === id;
          return (
            <li key={f.featureId} className="sd-shift">
              <span>{f.name}</span>
              {active ? (
                <span className="sd-badge sd-badge-on">Active</span>
              ) : (
                <span className="sd-shift-buttons">
                  <BrandButton
                    variant="neutral"
                    disabled={!canAct || martial.focus < 1}
                    aria-label={`Shift into ${f.name}, spending 1 Focus`}
                    onClick={() => run(() => shift({ campaignId, idempotencyKey: crypto.randomUUID(), characterId, stance: id, payWith: "focus" }))}
                  >
                    Shift · 1 Focus
                  </BrandButton>
                  {flow ? (
                    <BrandButton
                      variant="neutral"
                      disabled={!canAct}
                      aria-label={`Shift into ${f.name}, marking 1 Stress`}
                      onClick={() => run(() => shift({ campaignId, idempotencyKey: crypto.randomUUID(), characterId, stance: id, payWith: "stress" }))}
                    >
                      Shift · 1 Stress
                    </BrandButton>
                  ) : null}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {alertOf(error)}
    </div>
  );
}

/**
 * Q15 (a): the existing D5 Use of an out-of-combat feature (Commune, Get In & Get Out), as on the Party sheet: one
 * `classFeatures.use` intent; the result line is the server's summary.
 */
export function D5Use({ characterId, canAct, featureKey, name }: Omit<Props, "campaignId"> & { featureKey: string; name: string }) {
  const { error, run } = useAction();
  const [done, setDone] = useState<string | null>(null);
  const use = useMutation(api.classFeatures.use);
  return (
    <div className="sd-d5">
      <BrandButton
        variant="confirm"
        disabled={!canAct}
        aria-label={`Use ${name}`}
        onClick={() =>
          run(async () => {
            setDone(null);
            const out = await use({ idempotencyKey: crypto.randomUUID(), characterId, featureKey, params: {} });
            setDone(out.summary);
          })
        }
      >
        Use
      </BrandButton>
      <span role="status" className="cm-muted">
        {done}
      </span>
      {alertOf(error)}
    </div>
  );
}

/** The Beastform's name from its id ("agile-scout" → "Agile Scout" when the data has no such form). */
function formName(id: string): string {
  return BEASTFORMS.find((b) => b.id === id)?.name ?? titleCase(id);
}

/**
 * Q10 (CB p.30, Beastform: "You can drop out of this form at any time"): while the character is in a Beastform, the
 * form's name and "Drop out", which ends D5's `beastform` sheet effect (`classFeatures.endEffect`). Transforming is the
 * Beastform class feature's Use.
 */
export function BeastformControl({ campaignId, characterId, canAct, form }: Props & { form: string }) {
  const { error, run } = useAction();
  const end = useMutation(api.classFeatures.endEffect).withOptimisticUpdate((store, args) => {
    const query = { campaignId, characterId: args.characterId };
    const drawer = store.getQuery(api.combatFeaturesReads.drawer, query);
    if (drawer) store.setQuery(api.combatFeaturesReads.drawer, query, { ...drawer, features: drawer.features.filter((f) => f.source !== "beastform") });
  });
  const name = formName(form);
  return (
    <div className="sd-form" role="group" aria-label="Beastform" data-testid="sheet-drawer-beastform">
      <p className="sd-focus">
        <span className="cm-lbl">Beastform</span> {name}
      </p>
      <BrandButton
        variant="neutral"
        disabled={!canAct}
        aria-label={`Drop out of ${name}`}
        onClick={() => run(() => end({ idempotencyKey: crypto.randomUUID(), characterId, effectId: "beastform" }))}
      >
        Drop out
      </BrandButton>
      {alertOf(error)}
    </div>
  );
}
