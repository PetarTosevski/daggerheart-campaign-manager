"use client";

// D8's builder styles (the Battle Points panel, rows and the add dialog); its tokens are set on `.adv-root`.
import "@/components/adversaries/builder/builder.css";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";

import { AddAdversaryDialog } from "@/components/adversaries/builder/add-dialog";
import { BudgetPanel } from "@/components/adversaries/builder/budget-panel";
import type { EncounterView, InstanceView } from "@/components/adversaries/builder/types";
import { errorMessage } from "@/lib/convex-errors";
import { BP_COSTS } from "@/lib/domain/encounters/budget";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type Summary = NonNullable<FunctionReturnType<typeof api.sessionPrep.get>["encounter"]>;
type Ids = { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> };

const STATUS_LABEL = { draft: "Draft", running: "Running", ended: "Ended" } as const;

function costLabel(i: InstanceView): string {
  if (i.summoned) return "0 BP";
  if (i.type === null) return "—";
  if (i.type === "Minion") return "group";
  return `${BP_COSTS[i.type]} BP`;
}

/**
 * The 'Encounter builder' column (B3, Q1). No encounter: create 'Session N encounter' or link one of the campaign's
 * encounters. With one: D8's Battle Points panel (party stepper, bar, verdict, adjustments) and the encounter's
 * adversaries with D8's add dialog, all on D8's own functions, so the Adversaries tab shows the same encounter.
 */
export function SessionEncounter({ campaignId, sessionId, encounter }: Ids & { encounter: Summary | null }) {
  if (encounter === null) return <NoEncounter campaignId={campaignId} sessionId={sessionId} />;
  return <LinkedEncounter campaignId={campaignId} sessionId={sessionId} summary={encounter} />;
}

function NoEncounter({ campaignId, sessionId }: Ids) {
  const list = useQuery(api.encounters.list, { campaignId });
  const create = useIntent(api.sessionPrep.createEncounter);
  const link = useMutation(api.sessionPrep.linkEncounter);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const options = list ? [...list.active, ...list.ended] : [];
  const picked = options.some((e) => e._id === choice) ? choice : (options[0]?._id ?? "");

  async function onLink() {
    if (picked === "") return;
    setError(null);
    setLinking(true);
    try {
      await link({ campaignId, sessionId, encounterId: picked });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLinking(false);
    }
  }

  return (
    <section className="ss-card" aria-labelledby="ssp-enc-h">
      <div className="ssp-head ssp-baseline">
        <h2 id="ssp-enc-h" className="ss-h">
          Encounter builder
        </h2>
        <span className="ss-muted">Battle Points</span>
      </div>
      <p className="ss-muted ss-m0">
        Build this session&apos;s fight with real stat blocks and Battle Points. The encounter also appears in the Adversaries tab, where you start and track
        it.
      </p>
      <button type="button" className="ss-primary" disabled={create.pending} onClick={() => void create.fire({ campaignId, sessionId })}>
        Create the session encounter
      </button>
      <div className="ssp-link">
        <label className="ssp-field">
          <span className="ss-lbl">Link an encounter</span>
          <select className="ss-in" value={picked} disabled={options.length === 0} onChange={(e) => setChoice(e.currentTarget.value)}>
            {list === undefined ? <option value="">Loading encounters…</option> : null}
            {list !== undefined && options.length === 0 ? <option value="">No encounters yet</option> : null}
            {options.map((e) => (
              <option key={e._id} value={e._id}>
                {e.name} ({STATUS_LABEL[e.status]})
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ss-ghost" disabled={picked === "" || linking} onClick={() => void onLink()}>
          Link
        </button>
      </div>
      {(create.error ?? error) ? (
        <p role="alert" className="ssp-error">
          {create.error ?? error}
        </p>
      ) : null}
    </section>
  );
}

function LinkedEncounter({ campaignId, sessionId, summary }: Ids & { summary: Summary }) {
  const view = useQuery(api.encounters.get, { campaignId, encounterId: summary._id });
  const campaign = useQuery(api.campaigns.get, { campaignId });
  if (view === undefined || campaign === undefined) {
    return (
      <p role="status" className="ss-muted ss-m0">
        Loading the encounter…
      </p>
    );
  }
  if (view === null || campaign === null) {
    return <p className="ss-muted ss-m0">This encounter no longer exists.</p>;
  }
  return <Builder campaignId={campaignId} sessionId={sessionId} view={view} partyTier={campaign.tier} />;
}

function Builder({ campaignId, sessionId, view, partyTier }: Ids & { view: EncounterView; partyTier: number }) {
  const { encounter, instances } = view;
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlink = useMutation(api.sessionPrep.unlinkEncounter).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.sessionPrep.get, { campaignId: args.campaignId, sessionId: args.sessionId });
    if (current) store.setQuery(api.sessionPrep.get, { campaignId: args.campaignId, sessionId: args.sessionId }, { ...current, encounter: null });
  });
  const removeInstance = useMutation(api.encounters.removeInstance).withOptimisticUpdate((store, { instanceId }) => {
    const current = store.getQuery(api.encounters.get, { campaignId, encounterId: encounter._id });
    if (current) {
      store.setQuery(api.encounters.get, { campaignId, encounterId: encounter._id }, { ...current, instances: current.instances.filter((i) => i._id !== instanceId) });
    }
  });

  function run(op: Promise<unknown>) {
    setError(null);
    op.catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <div className="adv-root ssp-enc">
      <BudgetPanel campaignId={campaignId} view={view} partyTier={partyTier} />
      <section className="enc-card" aria-labelledby="ssp-enc-name">
        <div className="enc-head">
          <span className="ssp-enc-title">
            <span className="enc-lbl">Session encounter</span>
            <h2 id="ssp-enc-name" className="enc-h">
              {encounter.name}
            </h2>
          </span>
          <span className="enc-chip" data-status={encounter.status}>
            {STATUS_LABEL[encounter.status]}
          </span>
        </div>
        {instances.length === 0 ? (
          <p className="enc-muted">No adversaries yet. Add them here; the budget shows how hard the fight is.</p>
        ) : (
          <ul className="enc-list" aria-label="Adversaries in this encounter">
            {instances.map((instance) => (
              <li key={instance._id} className="enc-row">
                <div className="enc-row-main">
                  <span className="enc-row-label">{instance.minionCount !== undefined ? `${instance.label} ×${instance.minionCount}` : instance.label}</span>
                  <span className="enc-row-meta">
                    <span className="enc-tag">{instance.type ? `Tier ${instance.tier} ${instance.type}` : "deleted custom adversary"}</span>
                    {instance.summoned ? <span className="enc-tag enc-tag-summoned">Summoned</span> : null}
                  </span>
                </div>
                <span className="enc-cost">{costLabel(instance)}</span>
                <button type="button" className="enc-x" aria-label={`Remove ${instance.label}`} onClick={() => run(removeInstance({ campaignId, instanceId: instance._id }))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="ssp-actions">
          <button type="button" className="enc-ghost" onClick={() => setAdding(true)}>
            + Add adversary
          </button>
          <Link className="enc-ghost" href={`/campaigns/${campaignId}/adversaries`}>
            Open Adversaries
          </Link>
          <button type="button" className="enc-ghost" onClick={() => run(unlink({ campaignId, sessionId }))}>
            Unlink
          </button>
        </div>
        <p className="enc-muted enc-note">Unlinking keeps the encounter in the Adversaries tab.</p>
        {error ? (
          <p role="alert" className="enc-error">
            {error}
          </p>
        ) : null}
      </section>
      <AddAdversaryDialog campaignId={campaignId} open={adding} onClose={() => setAdding(false)} encounterId={encounter._id} pcs={encounter.pcs} />
    </div>
  );
}
