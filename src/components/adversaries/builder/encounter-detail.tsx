"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type KeyboardEvent } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { BP_COSTS } from "@/lib/domain/encounters/budget";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AddAdversaryDialog } from "./add-dialog";
import { BudgetPanel } from "./budget-panel";
import type { EncounterView, InstanceView } from "./types";

const STATUS_TEXT = {
  draft: { title: "Draft", text: "Prepare the fight here. Start it when the party engages; only one encounter runs at a time." },
  running: { title: "Encounter running", text: "Track Hit Points, Stress, conditions and spotlights in the tracker." },
  ended: { title: "Ended", text: "This fight is over. Starting it again makes it the running encounter." },
} as const;

function useRun() {
  const [error, setError] = useState<string | null>(null);
  async function run(op: () => Promise<unknown>) {
    setError(null);
    try {
      await op();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return { error, run };
}

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.currentTarget.blur();
};

function costLabel(i: InstanceView): string {
  if (i.summoned) return "0 BP";
  if (i.type === null) return "—";
  if (i.type === "Minion") return "group";
  return `${BP_COSTS[i.type]} BP`;
}

function InstanceRow({ campaignId, instance, first, last }: { campaignId: Id<"campaigns">; instance: InstanceView; first: boolean; last: boolean }) {
  const { error, run } = useRun();
  const reorder = useMutation(api.encounters.reorder);
  const remove = useMutation(api.encounters.removeInstance).withOptimisticUpdate((store, { instanceId }) => {
    const current = store.getQuery(api.encounters.get, { campaignId, encounterId: instance.encounterId });
    if (!current) return;
    store.setQuery(
      api.encounters.get,
      { campaignId, encounterId: instance.encounterId },
      { ...current, instances: current.instances.filter((i) => i._id !== instanceId) },
    );
  });
  const label = instance.minionCount !== undefined ? `${instance.label} ×${instance.minionCount}` : instance.label;
  return (
    <li className="enc-row">
      <div className="enc-row-main">
        <span className="enc-row-label">{label}</span>
        <span className="enc-row-meta">
          {instance.type ? (
            <span className="enc-tag">
              Tier {instance.tier} {instance.type}
            </span>
          ) : (
            <span className="enc-tag">deleted custom adversary</span>
          )}
          {instance.summoned ? <span className="enc-tag enc-tag-summoned">Summoned</span> : null}
          <span>
            Difficulty {instance.stats.difficulty} · HP {instance.stats.hpMax}
          </span>
        </span>
        {error ? (
          <span role="alert" className="enc-error">
            {error}
          </span>
        ) : null}
      </div>
      <span className="enc-cost">{costLabel(instance)}</span>
      <span className="enc-row-actions">
        <button type="button" className="enc-x" aria-label={`Move ${instance.label} up`} disabled={first} onClick={() => void run(() => reorder({ campaignId, instanceId: instance._id, direction: "up" }))}>
          ↑
        </button>
        <button type="button" className="enc-x" aria-label={`Move ${instance.label} down`} disabled={last} onClick={() => void run(() => reorder({ campaignId, instanceId: instance._id, direction: "down" }))}>
          ↓
        </button>
        <button type="button" className="enc-x" aria-label={`Remove ${instance.label}`} onClick={() => void run(() => remove({ campaignId, instanceId: instance._id }))}>
          ×
        </button>
      </span>
    </li>
  );
}

function Detail({
  campaignId,
  view,
  partyTier,
  onOpenEncounter,
  onDeleted,
}: {
  campaignId: Id<"campaigns">;
  view: EncounterView;
  partyTier: number;
  onOpenEncounter: (encounterId: string) => void;
  onDeleted: () => void;
}) {
  const { encounter, instances } = view;
  const id = encounter._id;
  const { error, run } = useRun();
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rename = useMutation(api.encounters.rename);
  const setNotes = useMutation(api.encounters.setNotes);
  const start = useMutation(api.encounters.start);
  const end = useMutation(api.encounters.end);
  const remove = useMutation(api.encounters.remove);
  const status = STATUS_TEXT[encounter.status];

  return (
    <div className="enc-detail">
      <div className="enc-col">
        <div className="enc-card enc-card-row">
          <label className="enc-field enc-field-grow">
            <span className="enc-lbl">Encounter name</span>
            <input
              className="enc-in enc-in-name"
              type="text"
              defaultValue={encounter.name}
              maxLength={80}
              onKeyDown={blurOnEnter}
              onBlur={(e) => {
                const name = e.currentTarget.value.trim();
                if (name === encounter.name) return;
                if (name === "") {
                  e.currentTarget.value = encounter.name;
                  return;
                }
                void run(() => rename({ campaignId, encounterId: id, name }));
              }}
            />
          </label>
          <button
            type="button"
            className="enc-ghost enc-danger"
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              void run(async () => {
                onDeleted();
                await remove({ campaignId, encounterId: id });
              });
            }}
            onBlur={() => setConfirmDelete(false)}
          >
            {confirmDelete ? "Click again to delete" : "Delete"}
          </button>
        </div>

        <div className="enc-card enc-status" data-live={encounter.status === "running"}>
          <span className="enc-dot" data-live={encounter.status === "running"} aria-hidden="true" />
          <div className="enc-status-text">
            <strong>{status.title}</strong>
            <span className="enc-muted">{status.text}</span>
          </div>
          {encounter.status === "running" ? (
            <>
              <button type="button" className="enc-ghost" onClick={() => onOpenEncounter(id)}>
                Open in tracker
              </button>
              <button type="button" className="enc-pill enc-pill-end" onClick={() => void run(() => end({ campaignId, encounterId: id }))}>
                ■ End encounter
              </button>
            </>
          ) : (
            <button
              type="button"
              className="enc-pill enc-pill-start"
              onClick={() =>
                void run(async () => {
                  await start({ campaignId, encounterId: id });
                  onOpenEncounter(id);
                })
              }
            >
              ▶ Start encounter
            </button>
          )}
        </div>
        {error ? (
          <p role="alert" className="enc-error">
            {error}
          </p>
        ) : null}

        <section className="enc-card" aria-labelledby="enc-adv-h">
          <div className="enc-head">
            <h2 id="enc-adv-h" className="enc-h">
              Adversaries
            </h2>
            <button type="button" className="enc-ghost" onClick={() => setAdding(true)}>
              + Add adversary
            </button>
          </div>
          {instances.length === 0 ? (
            <p className="enc-muted">No adversaries yet. Add them here or from a stat block in the Catalogue.</p>
          ) : (
            <ul className="enc-list" aria-label="Adversaries in this encounter">
              {instances.map((instance, i) => (
                <InstanceRow key={instance._id} campaignId={campaignId} instance={instance} first={i === 0} last={i === instances.length - 1} />
              ))}
            </ul>
          )}
        </section>

        <section className="enc-card" aria-labelledby="enc-notes-h">
          <h2 id="enc-notes-h" className="enc-h">
            Notes
          </h2>
          <textarea
            className="enc-ta"
            rows={4}
            aria-labelledby="enc-notes-h"
            defaultValue={encounter.notes ?? ""}
            maxLength={2000}
            placeholder="Terrain, tactics, what the adversaries want…"
            onBlur={(e) => {
              const notes = e.currentTarget.value;
              if (notes === (encounter.notes ?? "")) return;
              void run(() => setNotes({ campaignId, encounterId: id, notes }));
            }}
          />
        </section>
      </div>

      <BudgetPanel campaignId={campaignId} view={view} partyTier={partyTier} />

      <AddAdversaryDialog campaignId={campaignId} open={adding} onClose={() => setAdding(false)} encounterId={id} pcs={encounter.pcs} />
    </div>
  );
}

/** One encounter: name, status (Start / End), its adversaries, notes and the Battle Points panel. */
export function EncounterDetail(props: {
  campaignId: Id<"campaigns">;
  encounterId: string;
  partyTier: number;
  onOpenEncounter: (encounterId: string) => void;
  onDeleted: () => void;
}) {
  const view = useQuery(api.encounters.get, { campaignId: props.campaignId, encounterId: props.encounterId });
  if (view === undefined) {
    return (
      <p role="status" className="enc-muted">
        Loading the encounter…
      </p>
    );
  }
  if (view === null) {
    return <p className="enc-empty">This encounter no longer exists. Pick another one or create a new one.</p>;
  }
  // Keyed on the encounter's identity so the name and notes fields start from the new encounter's values (CL7).
  return <Detail key={view.encounter._id} {...props} view={view} />;
}
