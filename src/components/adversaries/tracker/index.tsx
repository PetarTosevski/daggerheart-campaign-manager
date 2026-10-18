"use client";

import "../catalogue/catalogue.css";
import "./tracker.css";

import { useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { TrackerProps } from "../slots";
import { InstanceCard } from "./instance-card";
import { rulesFor } from "./rules";
import { SelectedBlock } from "./selected-block";
import { TopBar } from "./top-bar";
import { useTracker, type TrackerView } from "./use-tracker";

function Notice({ title, children }: { title: string; children: string }) {
  return (
    <section className="trk-card trk-notice" aria-label="Encounter tracker">
      <h2 className="trk-h">{title}</h2>
      <p className="trk-muted">{children}</p>
    </section>
  );
}

function Tracker({ campaignId, view, fear }: { campaignId: Id<"campaigns">; view: TrackerView; fear: number }) {
  const { encounter, instances } = view;
  const actions = useTracker(campaignId, encounter._id);
  const hasCustom = instances.some((i) => i.source.kind === "custom");
  const customs = useQuery(api.encounterTracking.customBlocks, hasCustom ? { campaignId, encounterId: encounter._id } : "skip");
  const [picked, setPicked] = useState<string | null>(null);
  const selected = instances.find((i) => i._id === picked) ?? instances.find((i) => !i.defeated) ?? instances[0] ?? null;
  const selectedRules = selected ? rulesFor(selected.source, customs ?? []) : null;

  return (
    <section className="trk" aria-label="Encounter tracker">
      <TopBar view={view} fear={fear} actions={actions} />
      {actions.error ? (
        <p role="alert" className="trk-error">
          {actions.error}
        </p>
      ) : null}
      {instances.length === 0 ? (
        <p className="trk-muted">This encounter has no adversaries yet. Add them in the builder above.</p>
      ) : (
        <div className="trk-grid">
          <ul className="trk-cards" aria-label="Adversaries in play">
            {instances.map((instance) => (
              <li key={instance._id}>
                <InstanceCard
                  instance={instance}
                  rules={rulesFor(instance.source, customs ?? [])}
                  gmTurn={encounter.gmTurn}
                  selected={instance._id === selected?._id}
                  onSelect={() => setPicked(instance._id)}
                  actions={actions}
                />
              </li>
            ))}
          </ul>
          <aside className="trk-side" aria-label="Selected adversary">
            {selected && selectedRules ? (
              <SelectedBlock key={selected._id} campaignId={campaignId} instance={selected} rules={selectedRules} fear={fear} actions={actions} />
            ) : selected && hasCustom && customs === undefined ? (
              <p role="status" className="trk-muted">
                Loading the stat block…
              </p>
            ) : (
              <p className="trk-muted">This adversary&apos;s custom stat block was deleted; its snapshot still tracks HP and Stress.</p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

function OpenEncounter({ campaignId, encounterId, fear }: { campaignId: Id<"campaigns">; encounterId: string; fear: number }) {
  const view = useQuery(api.encounters.get, { campaignId, encounterId });
  if (view === undefined) {
    return (
      <p role="status" className="trk-muted">
        Loading the encounter…
      </p>
    );
  }
  if (view === null) return <Notice title="Encounter tracker">That encounter no longer exists. Pick another one in the builder above.</Notice>;
  if (view.encounter.status !== "running") {
    return (
      <Notice title={view.encounter.name}>
        {view.encounter.status === "draft"
          ? "This encounter is a draft. Start it in the builder above to track HP, Stress, conditions and the spotlight here."
          : "This encounter has ended. Start it again in the builder above to keep tracking it."}
      </Notice>
    );
  }
  return <Tracker key={view.encounter._id} campaignId={campaignId} view={view} fear={fear} />;
}

/** With no encounter opened from the builder, the tracker shows the campaign's running encounter, if any. */
function RunningEncounter({ campaignId, fear }: { campaignId: Id<"campaigns">; fear: number }) {
  const list = useQuery(api.encounters.list, { campaignId });
  if (list === undefined) {
    return (
      <p role="status" className="trk-muted">
        Loading the encounter tracker…
      </p>
    );
  }
  const running = list.active.find((e) => e.status === "running");
  if (!running) return <Notice title="Encounter tracker">No encounter is running. Start one in the builder above to track it here.</Notice>;
  return <OpenEncounter campaignId={campaignId} encounterId={running._id} fear={fear} />;
}

/**
 * The live encounter tracker (D8 A4), below the builder on the Encounters tab: the encounter the builder opened (or the
 * running one) with its top bar (GM turn, Fear, Battle Points), one card per adversary instance and the selected
 * instance's stat block with attack and damage rolls.
 */
export function EncounterTracker({ campaignId, encounterId, fear }: TrackerProps) {
  return encounterId === null ? (
    <RunningEncounter campaignId={campaignId} fear={fear} />
  ) : (
    <OpenEncounter campaignId={campaignId} encounterId={encounterId} fear={fear} />
  );
}
