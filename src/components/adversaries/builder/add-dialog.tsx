"use client";

import { useQuery } from "convex/react";
import { useMemo, useState, type FormEvent } from "react";

import { Modal } from "@/components/brand/modal";
import { adversariesFor } from "@/lib/domain/adversaries";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import type { AdversaryDef } from "@/lib/srd/types";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const MAX_COUNT = 10;
const MAX_MINIONS = 30;
const SHOWN = 30;
const NEW = "__new__";
/** Minion group size when no party size is known (open question 4 default). */
const DEFAULT_GROUP = 4;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The SRD adversaries this campaign can use (Hope & Fear switch, frame-exclusive blocks), or undefined while loading. */
function useCatalogue(campaignId: Id<"campaigns">): AdversaryDef[] | undefined {
  const campaign = useQuery(api.campaigns.get, { campaignId });
  return useMemo(
    () => (campaign ? adversariesFor(ADVERSARIES, { hopeAndFear: campaign.options.hopeAndFear, frameId: campaign.frameId }) : undefined),
    [campaign],
  );
}

type Props = {
  campaignId: Id<"campaigns">;
  open: boolean;
  onClose: () => void;
  /** Fixed when opened from an encounter; otherwise the GM picks one (or a new one). */
  encounterId?: string;
  /** Fixed when opened from a catalogue stat block; otherwise the GM searches for one. */
  adversaryId?: string;
  /**
   * Party size of a new encounter (unset: the server counts the active characters) and the default Minion group
   * size (unset: the encounter's party size, else 4).
   */
  pcs?: number;
  onAdded?: (encounterId: string) => void;
};

/** "Add to encounter": adversary (search) and encounter (picker or new), how many or the Minion group size, Summoned. */
export function AddAdversaryDialog(props: Props) {
  return (
    <Modal open={props.open} onClose={props.onClose} title="Add to encounter">
      <AddForm {...props} />
    </Modal>
  );
}

function AddForm({ campaignId, onClose, encounterId: fixedEncounter, adversaryId: fixedAdversary, pcs, onAdded }: Props) {
  const catalogue = useCatalogue(campaignId);
  const encounters = useQuery(api.encounters.list, fixedEncounter === undefined ? { campaignId } : "skip");
  const create = useIntent(api.encounters.create);
  const add = useIntent(api.encounters.addAdversary);

  const [search, setSearch] = useState("");
  // 0 = every tier.
  const [tier, setTier] = useState(0);
  const [picked, setPicked] = useState<string | null>(fixedAdversary ?? null);
  const [chosenEncounter, setChosenEncounter] = useState<string | null>(null);
  const [newName, setNewName] = useState("New encounter");
  const [count, setCount] = useState<number | null>(null);
  const [summoned, setSummoned] = useState(false);

  if (catalogue === undefined || (fixedEncounter === undefined && encounters === undefined)) {
    return (
      <p role="status" className="enc-muted">
        Loading…
      </p>
    );
  }

  const adversary = catalogue.find((a) => a.id === picked) ?? null;
  const minion = adversary?.type === "Minion";
  const max = minion ? MAX_MINIONS : MAX_COUNT;
  // Default: the running encounter, else the newest draft, else a new one.
  const encounterChoice = fixedEncounter ?? chosenEncounter ?? encounters?.active[0]?._id ?? NEW;
  const groupSize = pcs ?? encounters?.active.find((e) => e._id === encounterChoice)?.pcs ?? DEFAULT_GROUP;
  const amount = Math.min(max, count ?? (minion ? groupSize : 1));
  const matches = fixedAdversary
    ? []
    : catalogue.filter((a) => (tier === 0 || a.tier === tier) && fold(`${a.name} ${a.type}`).includes(fold(search.trim()))).slice(0, SHOWN);
  const error = create.error ?? add.error;
  const pending = create.pending || add.pending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!adversary) return;
    let target = encounterChoice;
    if (target === NEW) {
      const created = await create.fire({ campaignId, name: newName, ...(pcs !== undefined ? { pcs } : {}) });
      if (!created) return;
      target = created.encounterId;
    }
    const done = await add.fire({ campaignId, encounterId: target, source: { kind: "srd", adversaryId: adversary.id }, count: amount, summoned });
    if (!done) return;
    onAdded?.(target);
    onClose();
  }

  return (
    <form className="enc-dialog" onSubmit={(e) => void submit(e)}>
      {fixedAdversary ? (
        <p className="enc-muted">
          {adversary ? (
            <>
              <strong className="enc-item-name">{adversary.name}</strong> · Tier {adversary.tier} {adversary.type}
            </>
          ) : (
            "This adversary isn't in this campaign's catalogue."
          )}
        </p>
      ) : (
        <>
          <label className="enc-field">
            <span className="enc-lbl">Adversary</span>
            <input className="enc-in" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or type" />
          </label>
          <div className="enc-tiers" role="group" aria-label="Filter by tier">
            {[0, 1, 2, 3, 4].map((t) => (
              <button key={t} type="button" className="enc-tier" aria-pressed={tier === t} onClick={() => setTier(t)}>
                {t === 0 ? "All tiers" : `Tier ${t}`}
              </button>
            ))}
          </div>
          {matches.length === 0 ? (
            <p className="enc-muted">No adversary matches. Try another name.</p>
          ) : (
            <ul className="enc-picks" aria-label="Matching adversaries">
              {matches.map((a) => (
                <li key={a.id}>
                  <button type="button" className="enc-pick" aria-pressed={picked === a.id} aria-label={`${a.name}, Tier ${a.tier} ${a.type}`} onClick={() => setPicked(a.id)}>
                    <span>{a.name}</span>
                    <span className="enc-tag">
                      T{a.tier} {a.type}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {fixedEncounter === undefined ? (
        <>
          <label className="enc-field">
            <span className="enc-lbl">Encounter</span>
            <select className="enc-in" value={encounterChoice} onChange={(e) => setChosenEncounter(e.target.value)}>
              {encounters?.active.map((e) => (
                <option key={e._id} value={e._id}>
                  {e.name}
                  {e.status === "running" ? " (running)" : ""}
                </option>
              ))}
              <option value={NEW}>New encounter…</option>
            </select>
          </label>
          {encounterChoice === NEW ? (
            <label className="enc-field">
              <span className="enc-lbl">New encounter name</span>
              <input className="enc-in" type="text" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
            </label>
          ) : null}
        </>
      ) : null}

      <label className="enc-field">
        <span className="enc-lbl">
          {minion ? "Minions in the group" : "How many"}
        </span>
        <input
          className="enc-in"
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          value={amount}
          onChange={(e) => setCount(Math.min(max, Math.max(1, Math.trunc(Number(e.target.value) || 1))))}
        />
      </label>
      {minion ? <p className="enc-muted enc-note">One row for the whole group; each Minion is one Hit Point. A group the size of the party costs 1 BP.</p> : null}
      <label className="enc-check">
        <input type="checkbox" checked={summoned} onChange={(e) => setSummoned(e.target.checked)} />
        <span>Summoned (costs no Battle Points)</span>
      </label>
      {error ? (
        <p role="alert" className="enc-error">
          {error}
        </p>
      ) : null}
      <div className="enc-actions">
        <button type="button" className="enc-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="enc-pill enc-pill-primary" disabled={!adversary || pending}>
          Add to encounter
        </button>
      </div>
    </form>
  );
}
