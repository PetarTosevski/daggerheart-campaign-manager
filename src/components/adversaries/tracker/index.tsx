"use client";

import "../catalogue/catalogue.css";
import "./tracker.css";

import { useQuery } from "convex/react";
import { useState, type ReactNode } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { TrackerProps } from "../slots";
import { TrackerSessionChip } from "@/components/sessions/session-chip";
import { spotlightCostsFear, turnSpotlights } from "@/lib/domain/encounters/spotlight";

import { useLiveMap, useTargetData } from "./actions/live";
import { MapPane } from "./actions/map-pane";
import { spotlightNote, targetOptions, toggled, type MapToken } from "./actions/model";
import { ActionPanel } from "./actions/panel";
import { useAdversaryActions, type AdversaryActions } from "./actions/use-adversary-actions";
import { ReactionWindows } from "./actions/windows";
import { TrackerBoundary } from "./boundary";
import { InstanceCard } from "./instance-card";
import { rulesFor, type BlockRules } from "./rules";
import { SelectedBlock } from "./selected-block";
import { TopBar } from "./top-bar";
import { useTracker, type TrackerInstance, type TrackerView } from "./use-tracker";

function Notice({ title, children, chip }: { title: string; children: string; chip?: ReactNode }) {
  return (
    <section className="trk-card trk-notice" aria-label="Encounter tracker">
      <div className="trk-top-name">
        <h2 className="trk-h">{title}</h2>
        {chip}
      </div>
      <p className="trk-muted">{children}</p>
    </section>
  );
}

/**
 * The selected adversary's stat block with its actions panel (AA3), reading the party and the live map for the target
 * picker (Q18). Its own component so its queries sit under one boundary.
 */
function SelectedSide({
  campaignId,
  view,
  instance,
  rules,
  fear,
  targets,
  onTargets,
  acts,
}: {
  campaignId: Id<"campaigns">;
  view: TrackerView;
  instance: TrackerInstance;
  rules: BlockRules;
  fear: number;
  targets: string[];
  onTargets: (ids: string[]) => void;
  acts: AdversaryActions;
}) {
  const data = useTargetData(campaignId);
  const { encounter, instances } = view;
  return (
    <SelectedBlock
      key={instance._id}
      rules={rules}
      renderActions={(onDice) => {
        if (data === undefined) {
          return (
            <p role="status" className="trk-act-note">
              Loading the party…
            </p>
          );
        }
        const { mode, options } = targetOptions({ party: data.party, tokens: data.tokens, instanceId: instance._id });
        return (
          <ActionPanel
            instanceId={instance._id}
            actor={instance.label}
            block={rules.block}
            defeated={instance.defeated}
            fear={fear}
            spotNote={spotlightNote(instance, encounter.gmTurn, turnSpotlights(instances, encounter.gmTurn))}
            mode={mode}
            options={options}
            targets={targets}
            onTargets={onTargets}
            acts={acts}
            onDice={onDice}
            adversaries={instances.filter((i) => !i.defeated).map((i) => ({ id: i._id, name: i.label }))}
          />
        );
      }}
    />
  );
}

/** The live map pane under the tracker (AA3, Q16), when the GM has a live map. */
function LiveMap({ campaignId, onPickToken }: { campaignId: Id<"campaigns">; onPickToken: (token: MapToken) => void }) {
  const map = useLiveMap(campaignId);
  const tokens = useQuery(api.combatTokens.list, map ? { campaignId, mapId: map._id } : "skip");
  if (!map || tokens === undefined) return null;
  return <MapPane campaignId={campaignId} map={map} tokens={tokens} onPickToken={onPickToken} />;
}

function Tracker({ campaignId, view, fear }: { campaignId: Id<"campaigns">; view: TrackerView; fear: number }) {
  const { encounter, instances } = view;
  const actions = useTracker(campaignId, encounter._id);
  const acts = useAdversaryActions(campaignId);
  const hasCustom = instances.some((i) => i.source.kind === "custom");
  const customs = useQuery(api.encounterTracking.customBlocks, hasCustom ? { campaignId, encounterId: encounter._id } : "skip");
  const [picked, setPicked] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const selected = instances.find((i) => i._id === picked) ?? instances.find((i) => !i.defeated) ?? instances[0] ?? null;
  const selectedRules = selected ? rulesFor(selected.source, customs ?? []) : null;

  function pickToken(token: MapToken) {
    if (token.kind === "pc" && token.characterId !== undefined) setTargets(toggled(targets, token.characterId));
    else if (token.instanceId !== undefined && instances.some((i) => i._id === token.instanceId)) setPicked(token.instanceId);
  }

  return (
    <section className="trk" aria-label="Encounter tracker">
      <TopBar campaignId={campaignId} view={view} fear={fear} actions={actions} />
      {actions.error ? (
        <p role="alert" className="trk-error">
          {actions.error}
        </p>
      ) : null}
      <TrackerBoundary label="Reaction windows">
        <ReactionWindows campaignId={campaignId} encounterId={encounter._id} acts={acts} />
      </TrackerBoundary>
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
                  spotlightCostsFear={spotlightCostsFear(turnSpotlights(instances, encounter.gmTurn))}
                  selected={instance._id === selected?._id}
                  onSelect={() => setPicked(instance._id)}
                  actions={actions}
                />
              </li>
            ))}
          </ul>
          <aside className="trk-side" aria-label="Selected adversary">
            {selected && selectedRules ? (
              <TrackerBoundary label="Adversary actions">
                <SelectedSide
                  campaignId={campaignId}
                  view={view}
                  instance={selected}
                  rules={selectedRules}
                  fear={fear}
                  targets={targets}
                  onTargets={setTargets}
                  acts={acts}
                />
              </TrackerBoundary>
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
      <TrackerBoundary label="The live map">
        <LiveMap campaignId={campaignId} onPickToken={pickToken} />
      </TrackerBoundary>
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
      <Notice title={view.encounter.name} chip={<TrackerSessionChip campaignId={campaignId} encounterId={view.encounter._id} />}>
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
 * instance's stat block. AA3 (plan combat-actions): the selected block's actions panel
 * (targets, Attack, feature Use, Fear prompts) over AA2's server, the open reaction windows with "Resolve now", and a
 * compact pane of the live Combat Map whose token drags show on the Combat Map (Q12, Q16-Q19). AA3b: the targeted
 * Attack is the only attack, a feature that needs choices asks them in a dialog first, and the map pane can't delete.
 */
export function EncounterTracker({ campaignId, encounterId, fear }: TrackerProps) {
  return encounterId === null ? (
    <RunningEncounter campaignId={campaignId} fear={fear} />
  ) : (
    <OpenEncounter campaignId={campaignId} encounterId={encounterId} fear={fear} />
  );
}
