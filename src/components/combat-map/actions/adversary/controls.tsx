"use client";

import "../../../adversaries/catalogue/catalogue.css";
import "../../../adversaries/tracker/tracker.css";
import "./adversary.css";

import { useQuery } from "convex/react";
import { useRef, useState } from "react";

import { play3d } from "@/components/party/dice/dice3d";
import { canAnimate3d, useDiceSettings } from "@/components/party/dice/settings";
import { playRollSound } from "@/components/party/dice/sound";
import { turnSpotlights } from "@/lib/domain/encounters/spotlight";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useLiveMap, useTargetData } from "../../../adversaries/tracker/actions/live";
import { spotlightNote, targetOptions, type TargetOption } from "../../../adversaries/tracker/actions/model";
import { ActionPanel } from "../../../adversaries/tracker/actions/panel";
import { useAdversaryActions, type AdversaryActions } from "../../../adversaries/tracker/actions/use-adversary-actions";
import { ReactionWindows } from "../../../adversaries/tracker/actions/windows";
import { rulesFor } from "../../../adversaries/tracker/rules";
import type { AdversaryPanelProps } from "../../slots";
import { BAND_TEXT, SIGHT_TEXT, rangeRows, type RangeRow } from "./model";
import { PartBoundary } from "./part-boundary";
import { useLiveSight } from "./sight";

/**
 * The GM's adversary controls on the Combat Map (plan combat-actions AA5; Q12 "he can also use combat map if he wants",
 * Q16): the selected adversary token's Attack and feature Use buttons with the Fear questions, built from the Encounter
 * tab's own panel (AA3's `ActionPanel`, `useAdversaryActions`, `ReactionWindows`), so both pages send the same intents to
 * AA2's server and ask the same questions (Q19). The targets are the PCs on the live map with their Defined Range band
 * from the adversary and line of sight (Q2: a PC out of sight is not offered; the server checks again); without a live
 * map holding the adversary, the party list with no range limits (Q18). The adversary stays picked while the GM selects
 * PC tokens, so the targets can be checked on the map.
 */
export function AdversaryControls(props: AdversaryPanelProps) {
  const { campaignId, map, selectedTokenId } = props;
  const tokens = useQuery(api.combatTokens.list, { campaignId, mapId: map._id });
  const list = useQuery(api.encounters.list, { campaignId });
  const acts = useAdversaryActions(campaignId);
  const [picked, setPicked] = useState<Id<"combatTokens"> | null>(null);
  const [targets, setTargets] = useState<string[]>([]);

  const selected = tokens?.find((t) => t._id === selectedTokenId);
  // A newly selected adversary token becomes the one the panel acts for (adjusted during render, no effect: CL7).
  if (selected && selected.kind === "adversary" && picked !== selected._id) setPicked(selected._id);

  if (tokens === undefined || list === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading the adversaries…
      </p>
    );
  }
  const running = list.active.find((e) => e.status === "running") ?? null;
  const token = tokens.find((t) => t._id === picked && t.kind === "adversary") ?? null;

  return (
    <>
      {running ? (
        <PartBoundary label="Reaction windows">
          <ReactionWindows campaignId={campaignId} encounterId={running._id} acts={acts} />
        </PartBoundary>
      ) : null}
      {running === null ? (
        <p className="cm-muted cma-note">No encounter is running. Start one on the Adversaries tab to act for its adversaries here.</p>
      ) : token === null ? (
        <p className="cm-muted cma-note" data-testid="adversary-hint">
          Select an adversary token on the map to attack or use its features.
        </p>
      ) : token.instanceId === undefined ? (
        <p className="cm-muted cma-note">This token has no stat block.</p>
      ) : (
        <PartBoundary label="The adversary">
          <SelectedAdversary
            campaignId={campaignId}
            encounterId={running._id}
            instanceId={token.instanceId}
            onScreenLive={map.live}
            targets={targets}
            onTargets={setTargets}
            acts={acts}
            onClear={() => setPicked(null)}
          />
        </PartBoundary>
      )}
    </>
  );
}

function SelectedAdversary({
  campaignId,
  encounterId,
  instanceId,
  onScreenLive,
  targets,
  onTargets,
  acts,
  onClear,
}: {
  campaignId: Id<"campaigns">;
  encounterId: Id<"encounters">;
  instanceId: Id<"encounterAdversaries">;
  onScreenLive: boolean;
  targets: string[];
  onTargets: (ids: string[]) => void;
  acts: AdversaryActions;
  onClear: () => void;
}) {
  const view = useQuery(api.encounters.get, { campaignId, encounterId });
  const instance = view?.instances.find((i) => i._id === instanceId);
  const custom = instance?.source.kind === "custom";
  const customs = useQuery(api.encounterTracking.customBlocks, custom ? { campaignId, encounterId } : "skip");
  const fear = useQuery(api.campaigns.fear, { campaignId });
  const data = useTargetData(campaignId);
  const live = useLiveMap(campaignId);
  const sight = useLiveSight(campaignId, live?._id ?? null);
  const stage = useRef<HTMLDivElement>(null);
  const [settings] = useDiceSettings();

  if (view === undefined || fear === undefined || data === undefined || (custom && customs === undefined)) {
    return (
      <p role="status" className="cm-muted">
        Loading the stat block…
      </p>
    );
  }
  if (view === null || !instance) {
    return <p className="cm-muted cma-note">This adversary is not in the running encounter.</p>;
  }
  const rules = rulesFor(instance.source, customs ?? []);
  if (rules === null) return <p className="cm-muted cma-note">This adversary&apos;s custom stat block was deleted.</p>;

  const { mode, options } = targetOptions({ party: data.party, tokens: data.tokens, instanceId });
  const self = mode === "map" ? data.tokens?.find((t) => t.instanceId === instanceId) : undefined;
  const ranges: RangeRow[] = self
    ? rangeRows(
        self,
        options.flatMap((o) => {
          const t = data.tokens?.find((x) => x._id === o.tokenId);
          return t ? [{ characterId: o.characterId, name: o.name, x: t.x, y: t.y, size: t.size }] : [];
        }),
        sight,
        rules.block.attack.range,
      )
    : [];
  // Q2: a PC out of the adversary's sight can't be attacked; it is listed with the ranges but not offered.
  const blocked = new Set(ranges.filter((r) => r.sight === "blocked").map((r) => r.characterId));
  const offered: TargetOption[] = options.filter((o) => !blocked.has(o.characterId));
  const { encounter, instances } = view;

  async function animate(dice: Parameters<typeof play3d>[1]["dice"]) {
    const shown = canAnimate3d(settings) && stage.current !== null && (await play3d(stage.current, { dice, sound: settings.sound }));
    if (!shown && settings.sound) playRollSound();
  }

  return (
    <div className="cmx-adv-sel" data-testid="adversary-selected">
      <div className="cmx-adv-head">
        <div>
          <span className="cm-lbl">Acting for</span>
          <h3 className="cmx-adv-name">{instance.label}</h3>
          <span className="cm-muted cma-small">
            {rules.block.name} · HP {instance.hp}/{instance.stats.hpMax}
            {instance.stats.stressMax > 0 ? ` · Stress ${instance.stress}/${instance.stats.stressMax}` : ""}
            {instance.defeated ? " · Defeated" : ""}
          </span>
        </div>
        <button type="button" className="cm-btn cm-sm" onClick={onClear} aria-label={`Stop acting for ${instance.label}`}>
          Done
        </button>
      </div>
      {mode === "map" && !onScreenLive ? <p className="cm-muted cma-note">Attacks use the live map&apos;s tokens, not this map&apos;s.</p> : null}
      {ranges.length > 0 ? <RangeList rows={ranges} attack={rules.block.attack.name} range={rules.block.attack.range} /> : null}
      <ActionPanel
        instanceId={instanceId}
        actor={instance.label}
        block={rules.block}
        defeated={instance.defeated}
        fear={fear}
        spotNote={spotlightNote(instance, encounter.gmTurn, turnSpotlights(instances, encounter.gmTurn))}
        mode={mode}
        options={offered}
        targets={targets}
        onTargets={onTargets}
        acts={acts}
        onDice={(dice) => void animate(dice)}
      />
      <div ref={stage} className="cmx-adv-dice" data-testid="adversary-dice-stage" />
    </div>
  );
}

/** Each PC on the live map from the adversary: band, line of sight / cover, and whether the attack's range reaches it. */
function RangeList({ rows, attack, range }: { rows: readonly RangeRow[]; attack: string; range: string }) {
  return (
    <div className="cmx-adv-ranges">
      <span className="cm-lbl">Range and sight</span>
      <ul aria-label="Range and sight" data-testid="adversary-ranges">
        {rows.map((r) => (
          <li key={r.characterId} data-sight={r.sight}>
            <b>{r.name}</b>
            <span className="cma-band">{BAND_TEXT[r.band]}</span>
            <span className="cmx-adv-sight">{SIGHT_TEXT[r.sight]}</span>
            {r.inAttackRange ? null : (
              <span className="cmx-adv-far">
                beyond {attack} ({range})
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
