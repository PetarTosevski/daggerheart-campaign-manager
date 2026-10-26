"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { encounterTrackerHref } from "../session-chip";

/**
 * Sessions as the hub (TASK-SESSIONS-HUB): the Play stage's Encounter card. The session's linked D8 encounter (S4,
 * `sessionPrep.get`), its adversaries with HP and Stress marked (D8's `encounters.get`, read-only here), 'Start
 * encounter' (D8's `encounters.start`, refused while another encounter runs) or 'Open in tracker', and 'Open the map'.
 * GM-only: both queries are GM wrappers, and the Play stage is mounted for the GM only.
 */

const STATUS_LABEL = { draft: "Draft", running: "Running", ended: "Ended" } as const;
type Status = keyof typeof STATUS_LABEL;

type Props = { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> };

export function EncounterCard({ campaignId, sessionId }: Props) {
  const prep = useQuery(api.sessionPrep.get, { campaignId, sessionId });
  if (prep === undefined) {
    return (
      <section className="ss-card" aria-label="Encounter">
        <h2 className="ss-h">Encounter</h2>
        <p role="status" className="ss-muted ss-m0">
          Loading…
        </p>
      </section>
    );
  }
  const encounter = prep.encounter;
  return (
    <section className="ss-card" aria-labelledby="ss-enc-h">
      <div className="ss-enc-head">
        <h2 id="ss-enc-h" className="ss-h">
          Encounter
        </h2>
        {encounter ? (
          <span className="ss-chip ss-enc-status" data-status={encounter.status}>
            {STATUS_LABEL[encounter.status]}
          </span>
        ) : null}
      </div>
      {encounter === null ? (
        <p className="ss-muted ss-m0">
          No encounter is linked to this session.{" "}
          <Link className="ss-enc-link" href={`/campaigns/${campaignId}/sessions?s=${sessionId}&stage=prep`}>
            Build or link one in Prep
          </Link>
          .
        </p>
      ) : (
        <Linked campaignId={campaignId} sessionId={sessionId} encounterId={encounter._id} name={encounter.name} status={encounter.status} />
      )}
    </section>
  );
}

function Linked({ campaignId, sessionId, encounterId, name, status }: Props & { encounterId: Id<"encounters">; name: string; status: Status }) {
  const view = useQuery(api.encounters.get, { campaignId, encounterId });
  const [error, setError] = useState<string | null>(null);
  // The click flips the status at once in both cached queries (CL4); a refusal rolls it back and shows the reason.
  const start = useMutation(api.encounters.start).withOptimisticUpdate((store, args) => {
    const prepArgs = { campaignId: args.campaignId, sessionId };
    const prep = store.getQuery(api.sessionPrep.get, prepArgs);
    if (prep !== undefined && prep.encounter !== null) {
      store.setQuery(api.sessionPrep.get, prepArgs, { ...prep, encounter: { ...prep.encounter, status: "running" } });
    }
    const getArgs = { campaignId: args.campaignId, encounterId: args.encounterId };
    const current = store.getQuery(api.encounters.get, getArgs);
    if (current !== undefined && current !== null) {
      store.setQuery(api.encounters.get, getArgs, { ...current, encounter: { ...current.encounter, status: "running" } });
    }
  });

  function onStart() {
    setError(null);
    start({ campaignId, encounterId }).catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <>
      <p className="ss-enc-name">{name}</p>
      {view === undefined ? (
        <p role="status" className="ss-muted ss-m0">
          Loading the adversaries…
        </p>
      ) : view === null || view.instances.length === 0 ? (
        <p className="ss-muted ss-m0">No adversaries in this encounter yet. Add them in Prep.</p>
      ) : (
        <ul className="ss-enc-list" aria-label="Adversaries">
          {view.instances.map((i) => {
            const label = i.minionCount && i.minionCount > 1 ? `${i.label} ×${i.minionCount}` : i.label;
            return (
              <li key={i._id} className="ss-enc-row" data-defeated={i.defeated ? "true" : "false"}>
                <span className="ss-enc-label">{label}</span>
                <span className="ss-enc-marks">
                  <span>
                    HP {i.hp}/{i.stats.hpMax}
                  </span>
                  {i.stats.stressMax > 0 ? (
                    <span>
                      Stress {i.stress}/{i.stats.stressMax}
                    </span>
                  ) : null}
                  {i.defeated ? <span className="ss-enc-defeated">Defeated</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="ss-enc-actions">
        {status === "running" ? (
          <Link className="ss-ghost ss-play-tall" href={encounterTrackerHref(campaignId, encounterId)}>
            Open in tracker
          </Link>
        ) : (
          <button type="button" className="ss-ghost ss-play-tall ss-enc-start" onClick={onStart}>
            ▶ Start encounter
          </button>
        )}
        <Link className="ss-ghost ss-play-tall" href={`/campaigns/${campaignId}/combat-map`}>
          Open the map
        </Link>
      </div>
      {error ? (
        <p role="alert" className="ss-play-error">
          {error}
        </p>
      ) : null}
    </>
  );
}
