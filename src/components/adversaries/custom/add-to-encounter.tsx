"use client";

import { useQuery } from "convex/react";
import { useState, type FormEvent } from "react";

import { Modal } from "@/components/brand/modal";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

const MAX_COUNT = 10;
const MAX_MINIONS = 30;
const NEW = "__new__";
/** Minion group size when no party size is known (open question 4 default, as in the builder's dialog). */
const DEFAULT_GROUP = 4;

/**
 * "+ Add to encounter" for a custom stat block: the builder's dialog (A3) takes SRD entries only, so this one sends
 * a `custom` source to encounters.addAdversary with the same choices (encounter or a new one, how many or the
 * Minion group size, Summoned).
 */
export function AddCustomToEncounter({ campaignId, custom }: { campaignId: Id<"campaigns">; custom: Doc<"customAdversaries"> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="adx-btn" onClick={() => setOpen(true)} aria-label={`Add ${custom.name} to an encounter`}>
        + Add to encounter
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add to encounter">
        <AddForm campaignId={campaignId} custom={custom} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function AddForm({ campaignId, custom, onClose }: { campaignId: Id<"campaigns">; custom: Doc<"customAdversaries">; onClose: () => void }) {
  const encounters = useQuery(api.encounters.list, { campaignId });
  const create = useIntent(api.encounters.create);
  const add = useIntent(api.encounters.addAdversary);
  const [chosen, setChosen] = useState<string | null>(null);
  const [newName, setNewName] = useState("New encounter");
  const [count, setCount] = useState<number | null>(null);
  const [summoned, setSummoned] = useState(false);

  if (encounters === undefined) {
    return (
      <p role="status" className="adx-count">
        Loading…
      </p>
    );
  }

  const minion = custom.type === "Minion";
  const max = minion ? MAX_MINIONS : MAX_COUNT;
  const target = chosen ?? encounters.active[0]?._id ?? NEW;
  const groupSize = encounters.active.find((e) => e._id === target)?.pcs ?? DEFAULT_GROUP;
  const amount = Math.min(max, count ?? (minion ? groupSize : 1));
  const error = create.error ?? add.error;

  async function submit(event: FormEvent) {
    event.preventDefault();
    let encounterId = target;
    if (encounterId === NEW) {
      const created = await create.fire({ campaignId, name: newName });
      if (!created) return;
      encounterId = created.encounterId;
    }
    const done = await add.fire({ campaignId, encounterId, source: { kind: "custom", customId: custom._id }, count: amount, summoned });
    if (done) onClose();
  }

  return (
    <form className="adx-add" onSubmit={(e) => void submit(e)}>
      <p className="adx-count">
        <strong>{custom.name}</strong> · Tier {custom.tier} {custom.type} · Custom
      </p>
      <label className="adx-field">
        <span className="adx-lbl">Encounter</span>
        <select className="adx-in" value={target} onChange={(e) => setChosen(e.target.value)}>
          {encounters.active.map((e) => (
            <option key={e._id} value={e._id}>
              {e.name}
              {e.status === "running" ? " (running)" : ""}
            </option>
          ))}
          <option value={NEW}>New encounter…</option>
        </select>
      </label>
      {target === NEW ? (
        <label className="adx-field">
          <span className="adx-lbl">New encounter name</span>
          <input className="adx-in" type="text" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
        </label>
      ) : null}
      <label className="adx-field">
        <span className="adx-lbl">{minion ? "Minions in the group" : "How many"}</span>
        <input
          className="adx-in"
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          value={amount}
          onChange={(e) => setCount(Math.min(max, Math.max(1, Math.trunc(Number(e.target.value) || 1))))}
        />
      </label>
      <label className="adx-check">
        <input type="checkbox" checked={summoned} onChange={(e) => setSummoned(e.target.checked)} />
        <span>Summoned (costs no Battle Points)</span>
      </label>
      {error ? (
        <p role="alert" className="adx-error">
          {error}
        </p>
      ) : null}
      <div className="adx-actions">
        <button type="button" className="adx-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="adx-primary" disabled={create.pending || add.pending}>
          Add to encounter
        </button>
      </div>
    </form>
  );
}
