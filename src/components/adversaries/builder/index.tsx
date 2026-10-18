"use client";

import "./builder.css";

import { useQuery } from "convex/react";
import { useState } from "react";

import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { BuilderProps, CatalogueEntryRef } from "../slots";
import { AddAdversaryDialog } from "./add-dialog";
import { EncounterDetail } from "./encounter-detail";
import type { EncounterSummary } from "./types";

const ENDED_PAGE = 20;
const MAX_PCS = 12;
const STATUS_LABEL = { draft: "Draft", running: "Running", ended: "Ended" } as const;

function EncounterItem({ encounter, current, onPick }: { encounter: EncounterSummary; current: boolean; onPick: () => void }) {
  return (
    <button type="button" className="enc-item" aria-current={current} onClick={onPick}>
      <span className="enc-item-top">
        <span className="enc-item-name">{encounter.name}</span>
        <span className="enc-chip" data-status={encounter.status}>
          {STATUS_LABEL[encounter.status]}
        </span>
      </span>
      <span className="enc-item-sub">
        {encounter.pcs} {encounter.pcs === 1 ? "player character" : "player characters"}
      </span>
    </button>
  );
}

/**
 * The Encounters tab's builder (D8 A3): the campaign's encounters (running and drafts, then ended ones 20 at a time)
 * and the selected encounter's detail with the Battle Points panel. Starting an encounter, or "Open in tracker",
 * hands it to the tracker through `onOpenEncounter`.
 */
export function EncounterBuilder({ campaignId, activePcs, onOpenEncounter }: BuilderProps) {
  const [endedLimit, setEndedLimit] = useState(ENDED_PAGE);
  const list = useQuery(api.encounters.list, { campaignId, endedLimit });
  const campaign = useQuery(api.campaigns.get, { campaignId });
  const [selected, setSelected] = useState<string | null>(null);
  const create = useIntent(api.encounters.create);

  if (list === undefined || campaign === undefined) {
    return (
      <p role="status" className="enc-muted">
        Loading encounters…
      </p>
    );
  }

  const current = selected ?? list.active[0]?._id ?? null;

  async function newEncounter() {
    const created = await create.fire({ campaignId, name: "New encounter", ...(activePcs > 0 ? { pcs: Math.min(MAX_PCS, activePcs) } : {}) });
    if (created) setSelected(created.encounterId);
  }

  return (
    <div className="enc-builder">
      <nav className="enc-aside" aria-label="Encounter list">
        <button type="button" className="enc-pill enc-pill-primary" disabled={create.pending} onClick={() => void newEncounter()}>
          + New encounter
        </button>
        {create.error ? (
          <p role="alert" className="enc-error">
            {create.error}
          </p>
        ) : null}
        <h2 className="enc-lbl">Encounters</h2>
        {list.active.length === 0 ? <p className="enc-empty">No encounters yet. Create one to start building a fight.</p> : null}
        {list.active.map((e) => (
          <EncounterItem key={e._id} encounter={e} current={e._id === current} onPick={() => setSelected(e._id)} />
        ))}
        {list.ended.length > 0 ? <h2 className="enc-lbl">Ended</h2> : null}
        {list.ended.map((e) => (
          <EncounterItem key={e._id} encounter={e} current={e._id === current} onPick={() => setSelected(e._id)} />
        ))}
        {list.moreEnded ? (
          <button type="button" className="enc-ghost" onClick={() => setEndedLimit((n) => n + ENDED_PAGE)}>
            Show more ended encounters
          </button>
        ) : null}
      </nav>
      <section aria-label="Encounter detail" style={{ minWidth: 0 }}>
        {current === null ? (
          <div className="enc-card">
            <h2 className="enc-h">No encounter selected</h2>
            <p className="enc-muted">
              Create an encounter, then add adversaries here or from a stat block in the Catalogue. The Battle Points budget shows how hard the fight is
              for your party.
            </p>
          </div>
        ) : campaign === null ? null : (
          <EncounterDetail
            campaignId={campaignId}
            encounterId={current}
            partyTier={campaign.tier}
            onOpenEncounter={onOpenEncounter}
            onDeleted={() => setSelected(null)}
          />
        )}
      </section>
    </div>
  );
}

/**
 * "Add to encounter" for a catalogue stat block's head (the page passes it as the catalogue's `renderActions`): opens
 * the add dialog with the adversary fixed and an encounter picker (or a new encounter).
 */
export function AddToEncounter({ campaignId, adversary }: { campaignId: Id<"campaigns">; adversary: CatalogueEntryRef }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="enc-ghost" onClick={() => setOpen(true)} aria-label={`Add ${adversary.name} to an encounter`}>
        + Add to encounter
      </button>
      <AddAdversaryDialog campaignId={campaignId} open={open} onClose={() => setOpen(false)} adversaryId={adversary.id} />
    </>
  );
}
