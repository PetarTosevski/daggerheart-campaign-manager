"use client";

// The classic choices dialog and action result (reused) wear the Encounter tab's styles.
import "../../../adversaries/tracker/tracker.css";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { capOf, needsChoices, pickable, type FeatureAsk } from "../../../adversaries/tracker/actions/ask";
import { FeatureChoices, type ChoiceArgs } from "../../../adversaries/tracker/actions/choices";
import { FeatureUse } from "../../../adversaries/tracker/actions/feature-use";
import { ActionResultView } from "../../../adversaries/tracker/actions/result";
import { rulesFor } from "../../../adversaries/tracker/rules";
import { useTracker, type Condition, type TrackerInstance } from "../../../adversaries/tracker/use-tracker";
import { useLiveSight } from "../../actions/adversary/sight";
import type { CombatPageState } from "../../slots";
import { conditionName } from "../pick/model";
import { usePick } from "../pick";
import { CostPill, PartBoundary, Pips, SidePanel, StatTile } from "../ui";
import type { FearAsk, GmActs } from "./acts";
import { gmAttackSession, gmFeatureSession } from "./attack";
import {
  actionSpotlightCost,
  attackLine,
  conditionChips,
  faceLetter,
  gmAttackRows,
  kindLabel,
  markedText,
  signed,
  spotlightButtonText,
  spotlightCost,
  theName,
  thresholdsText,
  tierLine,
  featureUsable,
  type BlockLike,
  type PcToken,
} from "./model";

const CONDITIONS: readonly Condition[] = ["hidden", "restrained", "vulnerable", "distracted"];

export type StatBlockPanelProps = {
  state: CombatPageState;
  tokenId: Id<"combatTokens">;
  acts: GmActs;
  ask: FearAsk;
  onClose: () => void;
};

/**
 * The GM's adversary stat block in the HUD's right panel (plan combat-hud H5.2; GMDesktop 'Adversary acting' `.sheet.adv`,
 * the parchment tracker look). H0's `SidePanel` (non-modal `<aside>`, Esc / ✕ close, focus back to the token). Reads
 * (GM only): the map's tokens (`combatTokens.list`), the running encounter (`encounters.list` / `encounters.get`, custom
 * blocks), `campaigns.fear`, the Fear ends on this instance (`combatEffects.fearEnds`) and line of sight on the map.
 * Writes the tracker's intents (`encounterTracking.markHp` / `markStress` / `toggleCondition` / `spotlight`, optimistic),
 * `combatEffects.endByFear`, and the adversary actions through `acts` (FearConfirm first for every Fear spend).
 */
export function StatBlockPanel({ state, tokenId, acts, ask, onClose }: StatBlockPanelProps) {
  const { campaignId, map } = state;
  const tokens = useQuery(api.combatTokens.list, map ? { campaignId, mapId: map._id } : "skip");
  const list = useQuery(api.encounters.list, { campaignId });
  const token = tokens?.find((t) => t._id === tokenId);
  const running = list?.active.find((e) => e.status === "running") ?? null;
  const view = useQuery(api.encounters.get, running ? { campaignId, encounterId: running._id } : "skip");
  const instance = token?.instanceId ? view?.instances.find((i) => i._id === token.instanceId) : undefined;
  const custom = instance?.source.kind === "custom";
  const customs = useQuery(api.encounterTracking.customBlocks, custom && running ? { campaignId, encounterId: running._id } : "skip");
  const titleRef = useRef<HTMLSpanElement>(null);
  const focused = useRef(false);

  const loading = tokens === undefined || list === undefined || (running !== null && view === undefined) || (custom && customs === undefined);
  const rules = instance ? rulesFor(instance.source, customs ?? []) : null;
  const name = instance?.label ?? token?.name ?? "Adversary";

  // Focus to the heading once loaded (SidePanel's effect has remembered the opener). Focus is not state.
  useEffect(() => {
    if (loading || focused.current) return;
    focused.current = true;
    const heading = titleRef.current?.closest("h2");
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [loading]);

  let body: ReactNode;
  if (loading) {
    body = (
      <p role="status" className="hsb-muted">
        Loading the stat block…
      </p>
    );
  } else if (!token) {
    body = <p className="hsb-muted">This token is no longer on the map.</p>;
  } else if (running === null || view === null || view === undefined) {
    body = <p className="hsb-muted">No encounter is running. Start one on the Adversaries tab to act for its adversaries here.</p>;
  } else if (!instance) {
    body = <p className="hsb-muted">This token has no stat block in the running encounter.</p>;
  } else if (rules === null) {
    body = <p className="hsb-muted">This adversary&apos;s custom stat block was deleted.</p>;
  } else {
    body = (
      <StatBlockBody
        state={state}
        tokenId={tokenId}
        tokens={tokens ?? []}
        encounterId={running._id}
        gmTurn={view.encounter.gmTurn}
        instances={view.instances}
        instance={instance}
        block={rules.block as BlockLike}
        acts={acts}
        ask={ask}
      />
    );
  }

  return (
    <SidePanel
      open
      onClose={onClose}
      label={`${name}’s stat block`}
      className="hsb"
      testId="hud-statblock"
      title={
        <span ref={titleRef} className="hsb-title">
          <span className="hsb-face" aria-hidden="true">
            {faceLetter(name)}
          </span>
          <span className="hsb-name">
            <b>{rules?.block.name ?? name}</b>
            {rules ? (
              <small>
                {tierLine(rules.block)}
                {instance && instance.label !== rules.block.name ? ` · ${instance.label}` : ""}
              </small>
            ) : null}
          </span>
        </span>
      }
    >
      {body}
    </SidePanel>
  );
}

type Tokens = FunctionReturnType<typeof api.combatTokens.list>;

function StatBlockBody({
  state,
  tokenId,
  tokens,
  encounterId,
  gmTurn,
  instances,
  instance,
  block,
  acts,
  ask,
}: {
  state: CombatPageState;
  tokenId: Id<"combatTokens">;
  tokens: Tokens;
  encounterId: Id<"encounters">;
  gmTurn: number;
  instances: readonly TrackerInstance[];
  instance: TrackerInstance;
  block: BlockLike;
  acts: GmActs;
  ask: FearAsk;
}) {
  const { campaignId, map } = state;
  const pick = usePick();
  const tracker = useTracker(campaignId, encounterId);
  const fear = useQuery(api.campaigns.fear, { campaignId });
  const ends = useQuery(api.combatEffects.fearEnds, { campaignId, target: { kind: "instance", instanceId: instance._id } });
  const endByFear = useMutation(api.combatEffects.endByFear).withOptimisticUpdate((store, args) => {
    const now = store.getQuery(api.campaigns.fear, { campaignId });
    if (now !== undefined && now >= args.fear) store.setQuery(api.campaigns.fear, { campaignId }, now - args.fear);
  });
  const sight = useLiveSight(campaignId, map?._id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<FeatureAsk | null>(null);
  const label = instance.label;
  const who = theName(label);
  const self = tokens.find((t) => t._id === tokenId);
  const pcs: PcToken[] = tokens.flatMap((t) =>
    t.kind === "pc" && t.characterId ? [{ tokenId: t._id, characterId: t.characterId, name: t.name, x: t.x, y: t.y, size: t.size, conditions: (t.stats?.conditions ?? []).map(conditionName) }] : [],
  );
  const characterOf = new Map(pcs.map((p) => [p.tokenId as string, p.characterId]));
  const nameOf = (id: string) => pcs.find((p) => p.characterId === id)?.name ?? "a target";
  const spotCost = spotlightCost(instances, gmTurn);
  const actionSpot = actionSpotlightCost(instance, instances, gmTurn);
  const busy = acts.pending || instance.defeated;
  const shown = acts.result && acts.result.instanceId === instance._id ? acts.result : null;

  async function guarded(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function openAttack() {
    if (!self) return;
    pick.open(
      gmAttackSession({
        instanceId: instance._id,
        tokenId,
        label,
        block,
        rows: gmAttackRows(self, pcs, sight, block.attack.range),
        characterOf,
        spotlightFear: actionSpot,
        acts,
      }),
    );
  }

  async function spotlightNow() {
    if (spotCost > 0 && !(await ask(spotCost, [`${spotCost} to spotlight ${who}`]))) return;
    const done = await tracker.spotlight(instance._id);
    // Spotlighting an adversary also gives the GM the scene spotlight (H1.S).
    if (done !== undefined) acts.take();
  }

  async function endEffect(end: { effectId: string; label: string; fear: number }) {
    if (end.fear > 0 && !(await ask(end.fear, [`${end.fear} to end ${end.label} on ${who}`]))) return;
    await guarded(() => endByFear({ campaignId, target: { kind: "instance", instanceId: instance._id }, effectId: end.effectId, fear: end.fear, idempotencyKey: crypto.randomUUID() }));
  }

  function startFeature(feature: string, featureAsk: FeatureAsk | null) {
    if (featureAsk && needsChoices(featureAsk)) return setChoosing(featureAsk);
    if (featureAsk && pickable(featureAsk.targets) && featureAsk.targets.side === "enemy" && self) {
      return pick.open(
        gmFeatureSession({
          instanceId: instance._id,
          tokenId,
          label,
          feature,
          max: capOf(featureAsk.targets),
          // A feature's own range is the server's to check; out of sight stays unpickable (Q2).
          rows: gmAttackRows(self, pcs, sight, "unlimited"),
          characterOf,
          useId: featureAsk.useId,
          acts,
        }),
      );
    }
    void sendFeature(feature, { targets: [] });
  }

  function sendFeature(feature: string, args: Partial<ChoiceArgs> & { targets: string[] }) {
    return guarded(() => acts.feature({ instanceId: instance._id, feature, ...args }, { label: `${label} uses ${feature}`, actor: who, feature }));
  }

  const chips = conditionChips(instance.conditions, ends ?? []);
  const absent = CONDITIONS.filter((c) => !instance.conditions.includes(c));
  const hpMax = instance.stats.hpMax;
  const stressMax = instance.stats.stressMax;
  const blockedFear = (cost: number) => (fear !== undefined && cost > fear ? `Needs ${cost} Fear · you have ${fear}` : null);
  const spotBlocked = blockedFear(spotCost);

  return (
    <div className="hsb-body" data-testid="hud-statblock-body">
      {block.motives ? (
        <p className="hsb-mot">
          <b>Motives</b> {block.motives}
        </p>
      ) : null}
      <div className="hsb-stats">
        <StatTile label="Difficulty" value={instance.stats.difficulty} />
        <StatTile label="Thresholds" value={thresholdsText(instance.stats)} />
        <StatTile label="Attack" value={signed(block.attack.modifier)} />
      </div>

      <div className="hsb-trk" data-testid="hud-statblock-trackers">
        <Track
          kind="hp"
          name="HP"
          noun={["Hit Point", "Hit Points"]}
          marked={instance.hp}
          max={hpMax}
          onStep={(d) => void tracker.markHp(instance._id, d)}
        />
        {stressMax > 0 ? (
          <Track kind="stress" name="Stress" noun={["Stress", "Stress"]} marked={instance.stress} max={stressMax} onStep={(d) => void tracker.markStress(instance._id, d)} />
        ) : null}
      </div>
      {instance.defeated ? <p className="hsb-defeated">Defeated</p> : null}

      <div className="hsb-wpn" data-testid="hud-statblock-weapon">
        <b>{block.attack.name}</b>
        <span>
          {block.attack.range} · {block.attack.damage}
        </span>
        {block.experiences.length > 0 ? <span className="hsb-x">{block.experiences.map((x) => `${x.name} ${signed(x.value)}`).join(", ")}</span> : null}
      </div>

      <section aria-labelledby="hsb-sec-cd" className="hsb-cds-sec">
        <h3 id="hsb-sec-cd" className="sr-only">
          Conditions
        </h3>
        <ul className="hsb-cds" aria-label="Conditions">
          {chips.map((c) => (
            <li key={c.key} className="hsb-cd">
              {c.label}
              {c.end ? (
                <button type="button" aria-label={`End ${c.label} · ${c.end.fear} Fear`} disabled={blockedFear(c.end.fear) !== null} onClick={() => void endEffect(c.end!)}>
                  End · {c.end.fear} Fear
                </button>
              ) : c.condition ? (
                <button type="button" className="hsb-cd-x" aria-label={`Remove ${c.label}`} onClick={() => void tracker.toggleCondition(instance._id, c.condition as Condition)}>
                  ✕
                </button>
              ) : null}
            </li>
          ))}
          {absent.length > 0 ? (
            <li className="hsb-cd-add">
              <select
                aria-label="Add a condition"
                value=""
                onChange={(e) => {
                  const c = e.target.value as Condition;
                  if (c) void tracker.toggleCondition(instance._id, c);
                }}
              >
                <option value="">+ Condition</option>
                {absent.map((c) => (
                  <option key={c} value={c}>
                    {conditionName(c)}
                  </option>
                ))}
              </select>
            </li>
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="hsb-sec-ft">
        <h3 id="hsb-sec-ft" className="hsb-sec">
          Features
        </h3>
        <ul className="hsb-fts">
          {block.features.map((f, i) => (
            <li key={`${i}-${f.name}`} className="hsb-af">
              <div className="hsb-af-h">
                <b>{f.name}</b>
                <span className="hsb-af-k">{kindLabel(f.kind)}</span>
                {f.fearCost ? <CostPill amount={f.fearCost} resource="fear" className="hsb-af-cost" /> : null}
                {featureUsable(f) ? (
                  <span className="hsb-af-use">
                    <PartBoundary label={`${f.name}’s Use`}>
                      <FeatureUse
                        campaignId={campaignId}
                        instanceId={instance._id}
                        feature={f.name}
                        fearCost={f.fearCost}
                        disabled={busy}
                        live={!instance.defeated}
                        onUse={(featureAsk) => startFeature(f.name, featureAsk)}
                      />
                    </PartBoundary>
                  </span>
                ) : null}
              </div>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {choosing ? (
        <FeatureChoices
          key={choosing.feature}
          campaignId={campaignId}
          instanceId={instance._id}
          actor={label}
          first={choosing}
          creatures={[
            ...pcs.map((p) => ({ id: p.characterId as string, name: p.name, kind: "pc" as const })),
            ...instances.filter((i) => !i.defeated).map((i) => ({ id: i._id as string, name: i.label, kind: "adversary" as const })),
          ]}
          panelTargets={[]}
          fear={fear ?? 0}
          pending={acts.pending}
          onClose={() => setChoosing(null)}
          onUse={(args) => {
            const feature = choosing.feature;
            setChoosing(null);
            void sendFeature(feature, args);
          }}
        />
      ) : null}

      {tracker.error || error ? (
        <p role="alert" className="hsb-err" data-testid="hud-statblock-error">
          {error ?? tracker.error}
        </p>
      ) : null}

      {shown ? (
        <div className="hsb-res">
          <ActionResultView shown={shown} nameOf={nameOf} pending={acts.pending} onFire={(intent) => void guarded(() => acts.fire(intent))} onDismiss={acts.dismiss} />
        </div>
      ) : null}

      <div className="hsb-acts">
        <button
          type="button"
          className="hsb-spot"
          disabled={busy || spotBlocked !== null}
          title={spotBlocked ?? undefined}
          data-testid="hud-statblock-spotlight"
          onClick={() => void spotlightNow()}
        >
          {spotlightButtonText(spotCost)}
        </button>
        <button type="button" className="hsb-atk" disabled={busy || !self} aria-haspopup="dialog" data-testid="hud-statblock-attack" onClick={openAttack}>
          Attack
        </button>
      </div>
      {spotBlocked ? <p className="hsb-why">{spotBlocked}</p> : null}
      <p className="sr-only">{attackLine(block)}</p>
    </div>
  );
}

function Track({
  kind,
  name,
  noun,
  marked,
  max,
  onStep,
}: {
  kind: "hp" | "stress";
  name: string;
  noun: [string, string];
  marked: number;
  max: number;
  onStep: (delta: -1 | 1) => void;
}) {
  const text = markedText(marked, max);
  return (
    <div className={cn("hsb-tr", `hsb-tr-${kind}`)}>
      <span className="hsb-l">{name}</span>
      <Pips kind={kind} on={marked} max={max} label={`${marked} of ${max} ${noun[1]} marked`} />
      <b className="hsb-n">{text}</b>
      <span className="hsb-step">
        <button type="button" aria-label={`Clear 1 ${noun[0]}`} disabled={marked <= 0} onClick={() => onStep(-1)}>
          −
        </button>
        <button type="button" aria-label={`Mark 1 ${noun[0]}`} disabled={marked >= max} onClick={() => onStep(1)}>
          +
        </button>
      </span>
    </div>
  );
}
