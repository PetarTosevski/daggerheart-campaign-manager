"use client";

// The classic choices dialog and action result (reused) wear the Encounter tab's styles.
import "../../../adversaries/tracker/tracker.css";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { crossedBy } from "@/lib/domain/adversary-actions/path-targets";
import { fearByHandText } from "@/lib/domain/adversary-actions/rule-notes";
import type { Range } from "@/lib/domain/card-effects/types";
import { spotlightLimit, spotlightStatus, spotlightsThisTurn } from "@/lib/domain/encounters/spotlight";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { capOf, namedArea, needsChoices, pickable, type FeatureAsk } from "../../../adversaries/tracker/actions/ask";
import { FeatureChoices, type ChoiceArgs } from "../../../adversaries/tracker/actions/choices";
import { FeatureUse } from "../../../adversaries/tracker/actions/feature-use";
import { ActionResultView } from "../../../adversaries/tracker/actions/result";
import { rulesFor } from "../../../adversaries/tracker/rules";
import { useTracker, type Condition, type TrackerInstance } from "../../../adversaries/tracker/use-tracker";
import { useLiveSight } from "../../actions/adversary/sight";
import type { CombatPageState } from "../../slots";
import { conditionName } from "../pick/model";
import { usePick } from "../pick";
import { pickArea, type Square } from "../pick-area";
import { BlockedReason, RefusalMessage, useBlocked, useRefusal, type Blocked } from "../blocked";
import { adversaryActBlocked, fearBlocked, spotlightFirst } from "../fear/blocked";
import { CostPill, PartBoundary, SidePanel, StatTile } from "../ui";
import type { FearAsk, GmActs } from "./acts";
import { Track } from "./track";
import { gmAttackSession, gmFeatureSession } from "./attack";
import { BAND_TEXT } from "../../actions/adversary/model";
import {
  actionSpotlightCost,
  areaPick,
  attackLine,
  conditionChips,
  faceLetter,
  gmAttackRows,
  kindLabel,
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
 * (GM only): the map's tokens (`combatTokensReads.list`), the running encounter (`encounters.list` / `encounters.get`, custom
 * blocks), `campaigns.fear`, the Fear ends on this instance (`combatEffects.fearEnds`) and line of sight on the map.
 * Writes the tracker's intents (`encounterTracking.markHp` / `markStress` / `toggleCondition` / `spotlight`, optimistic),
 * `combatEffects.endByFear`, and the adversary actions through `acts` (FearConfirm first for every Fear spend).
 *
 * Blocked states (H6.3, H6.1's layers): a Fear cost the GM can't pay leaves its control focusable but `aria-disabled`
 * with "This needs 2 Fear. You have 1." beside it (Spotlight · 1 Fear, End · n Fear, a Fear feature); an action whose
 * own spotlight the GM can't pay says "Spotlight the Lieutenant first." (Attack, an action feature). A refusal at the
 * click shows under the controls in the refusal table's words (`useRefusal`).
 */
export function StatBlockPanel({ state, tokenId, acts, ask, onClose }: StatBlockPanelProps) {
  const { campaignId, map } = state;
  const tokens = useQuery(api.combatTokensReads.list, map ? { campaignId, mapId: map._id } : "skip");
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
        relentless={rules.relentless}
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

type Tokens = FunctionReturnType<typeof api.combatTokensReads.list>;

function StatBlockBody({
  state,
  tokenId,
  tokens,
  encounterId,
  gmTurn,
  instances,
  instance,
  block,
  relentless,
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
  /** Relentless (X) (CB p.195): spotlights per GM turn; null = 1. */
  relentless: number | "X" | null;
  acts: GmActs;
  ask: FearAsk;
}) {
  const { campaignId, map } = state;
  const pick = usePick();
  const tracker = useTracker(campaignId, encounterId);
  const fear = useQuery(api.campaigns.fear, { campaignId });
  const modes = useQuery(api.ruleSettings.get, { campaignId })?.modes;
  const d8Manual = modes?.adversaryDefeated === "manual";
  // Plan rule-switches WF: F4 Manual (an Experience's Fear by hand), C4 Book (unconscious PCs not pre-picked), W3 Tier 3.
  const experienceFree = modes?.adversaryExperienceFear === "manual";
  // dcm-n7kb: F5 `fearFeatures` Manual (CB p.154): the server asks and spends no Fear for a feature (the GM spends it by
  // hand), so no cost pill or "(N Fear)" label, a "Spend N Fear by hand" note, and Use never blocked for lack of Fear.
  const featureFearByHand = modes?.fearFeatures === "manual";
  const skipUnconscious = (modes?.unconscious ?? "book") === "book";
  const darkHearted = useQuery(api.adversaryActions.darkHearted, { campaignId }) === true;
  const ends = useQuery(api.combatEffects.fearEnds, { campaignId, target: { kind: "instance", instanceId: instance._id } });
  const endByFear = useMutation(api.combatEffects.endByFear).withOptimisticUpdate((store, args) => {
    const now = store.getQuery(api.campaigns.fear, { campaignId });
    if (now !== undefined && now !== null && now >= args.fear) store.setQuery(api.campaigns.fear, { campaignId }, now - args.fear);
  });
  const sight = useLiveSight(campaignId, map?._id ?? null);
  const who = theName(instance.label);
  const refusal = useRefusal({ viewer: "gm", adversary: who });
  const [choosing, setChoosing] = useState<FeatureAsk | null>(null);
  /** WF: a "path" feature's picked destination and the creatures its line crosses (pre-picked in the choices dialog). */
  const [path, setPath] = useState<{ feature: string; destination: Square; crossed: string[] } | null>(null);
  const label = instance.label;
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

  // A refusal shows under the controls in the table's words; a toast-placed one (FALLBACK…) goes to the toast host.
  const guarded = (run: () => Promise<unknown>) => refusal.run(run);

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
        fear: fear ?? undefined,
        acts,
        experienceFree,
        darkHearted,
      }),
    );
  }

  async function spotlightNow() {
    if (spot.blocked) return;
    if (spotCost > 0 && !(await ask(spotCost, [`${spotCost} to spotlight ${who}`]))) return;
    const done = await tracker.spotlight(instance._id);
    // Spotlighting an adversary also gives the GM the scene spotlight (H1.S) and lights its token (dcm-bxp.99.32.35).
    if (done !== undefined) acts.take(tokenId);
  }

  async function endEffect(end: { effectId: string; label: string; fear: number }) {
    if (fearBlocked(end.fear, fear)) return;
    if (end.fear > 0 && !(await ask(end.fear, [`${end.fear} to end ${end.label} on ${who}`]))) return;
    await guarded(() => endByFear({ campaignId, target: { kind: "instance", instanceId: instance._id }, effectId: end.effectId, fear: end.fear, idempotencyKey: crypto.randomUUID() }));
  }

  /**
   * Plan rule-switches WF (user 2026-11-10): a "path" feature (Rampaging Fury, Trample) asks for its destination square
   * first, within its move's range of the token (the HUD square picker); everyone the straight line crosses starts picked.
   */
  async function startPath(feature: string, featureAsk: FeatureAsk) {
    if (!self || !map || !featureAsk.pathMove) return;
    const squares = await pickArea({
      id: `path:${instance._id}:${feature}`,
      mapId: map._id,
      name: feature,
      label: `${label}’s destination`,
      shape: "circle",
      count: 1,
      within: featureAsk.pathMove as Range,
      origin: self,
    });
    const destination = squares?.[0];
    if (!destination) return;
    const anySide = featureAsk.targets?.side === "any";
    const footprints = tokens.flatMap((t) =>
      t.kind === "pc" && t.characterId
        ? [{ id: t.characterId as string, tokenId: t._id, x: t.x, y: t.y, size: t.size }]
        : anySide && t.instanceId && t.instanceId !== instance._id && instances.some((i) => i._id === t.instanceId && !i.defeated)
          ? [{ id: t.instanceId as string, tokenId: t._id, x: t.x, y: t.y, size: t.size }]
          : [],
    );
    const crossedIds = crossedBy(self, destination, footprints);
    const downIds = new Set(skipUnconscious ? pcs.filter((p) => p.conditions.some((c) => c.toLowerCase() === "unconscious")).map((p) => p.characterId as string) : []);
    const crossed = crossedIds.filter((id) => !downIds.has(id));
    if (needsChoices(featureAsk) || anySide) {
      setPath({ feature, destination, crossed });
      return setChoosing(featureAsk);
    }
    const rows = gmAttackRows(self, pcs, sight, "unlimited");
    const picked = footprints.filter((f) => crossed.includes(f.id)).map((f) => f.tokenId);
    pick.open(
      gmFeatureSession({
        instanceId: instance._id,
        tokenId,
        label,
        feature,
        max: featureAsk.targets ? capOf(featureAsk.targets) : null,
        rows,
        characterOf,
        useId: featureAsk.useId,
        acts,
        area: { text: `Everyone in ${theName(label)}’s path: change the picks if needed`, picked, min: featureAsk.attack ? 1 : 0 },
        darkHearted: darkHearted && featureAsk.attack,
        destination,
      }),
    );
  }

  function startFeature(feature: string, featureAsk: FeatureAsk | null) {
    if (featureAsk?.pathMove && self && map) return void startPath(feature, featureAsk);
    if (featureAsk && needsChoices(featureAsk)) return setChoosing(featureAsk);
    if (featureAsk && pickable(featureAsk.targets) && featureAsk.targets.side === "enemy" && self) {
      // dcm-y3mf: "all targets in front of the Ogre within Far" (Hail of Boulders): the rows say who is in range; the
      // GM unpicks who isn't in front (the map has no facing to read) and sends.
      const area = namedArea(featureAsk.targets) ? featureAsk.targets : null;
      const rows = gmAttackRows(self, pcs, sight, area ? (BAND_TEXT[area.range as keyof typeof BAND_TEXT] ?? "unlimited") : "unlimited");
      return pick.open(
        gmFeatureSession({
          instanceId: instance._id,
          tokenId,
          label,
          feature,
          max: capOf(featureAsk.targets),
          // A feature's own range is the server's to check; out of sight stays unpickable (Q2).
          rows,
          characterOf,
          useId: featureAsk.useId,
          acts,
          ...(area ? { area: areaPick(area, theName(label), featureAsk.attack, rows, skipUnconscious) } : {}),
          darkHearted: darkHearted && featureAsk.attack,
        }),
      );
    }
    void sendFeature(feature, { targets: [] });
  }

  function sendFeature(feature: string, args: Partial<ChoiceArgs> & { targets: string[]; destination?: Square }) {
    return guarded(() => acts.feature({ instanceId: instance._id, feature, ...args }, { label: `${label} uses ${feature}`, actor: who, feature }));
  }

  const chips = conditionChips(instance.conditions, ends ?? [], instance.conditionSources);
  const absent = CONDITIONS.filter((c) => !instance.conditions.includes(c));
  const hpMax = instance.stats.hpMax;
  const stressMax = instance.stats.stressMax;
  // D8 Manual (rule switches DEF; CB p.208): at its last HP the adversary stays up until the GM presses Defeated.
  const standing = d8Manual && !instance.defeated && instance.minionCount === undefined && hpMax > 0 && instance.hp >= hpMax;
  const spot = useBlocked(fearBlocked(spotCost, fear));
  const spotCount = spotlightStatus(spotlightsThisTurn(instance, gmTurn), spotlightLimit(relentless));
  const attackWhy = spotlightFirst(who, actionSpot, fear);
  const atk = useBlocked(attackWhy);

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
      {standing ? (
        <p className="hsb-defeated" data-testid="hud-statblock-last-hp">
          Last HP{" "}
          <button type="button" className="hsb-act" aria-label={`Mark ${label} defeated`} onClick={() => void tracker.markDefeated(instance._id)}>
            Defeated
          </button>
        </p>
      ) : null}

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
              {c.from ? (
                <small className="hsb-cd-src" data-testid="hud-statblock-condition-source">
                  {c.from}
                </small>
              ) : null}
              {c.end ? (
                <EndByFear label={c.label} cost={c.end.fear} why={fearBlocked(c.end.fear, fear)} onEnd={() => void endEffect(c.end!)} />
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
          {block.features.map((f, i) => {
            // A Fear feature (CB p.154; Book only) or an action needing a spotlight the GM can't pay: disabled with the reason.
            const featureFear = featureFearByHand ? 0 : (f.fearCost ?? 0);
            const featureWhy = featureUsable(f) ? adversaryActBlocked(who, featureFear, f.kind === "action" ? actionSpot : 0, fear) : null;
            return (
            <li key={`${i}-${f.name}`} className="hsb-af">
              <div className="hsb-af-h">
                <b>{f.name}</b>
                <span className="hsb-af-k">{kindLabel(f.kind)}</span>
                {f.fearCost ? (
                  featureFearByHand ? (
                    <span className="hsb-af-note" data-testid="hud-statblock-feature-by-hand">
                      {fearByHandText(f.fearCost)}
                    </span>
                  ) : (
                    <CostPill amount={f.fearCost} resource="fear" className="hsb-af-cost" />
                  )
                ) : null}
                {featureUsable(f) ? (
                  <span className="hsb-af-use">
                    <PartBoundary label={`${f.name}’s Use`}>
                      <FeatureUse
                        campaignId={campaignId}
                        instanceId={instance._id}
                        feature={f.name}
                        fearCost={featureFearByHand ? undefined : f.fearCost}
                        disabled={busy || featureWhy !== null}
                        live={!instance.defeated}
                        onUse={(featureAsk) => startFeature(f.name, featureAsk)}
                      />
                    </PartBoundary>
                  </span>
                ) : null}
              </div>
              {featureWhy ? <FeatureWhy why={featureWhy} /> : null}
              <p>{f.text}</p>
            </li>
            );
          })}
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
          panelTargets={path?.feature === choosing.feature ? path.crossed : []}
          fear={fear ?? 0}
          pending={acts.pending}
          onClose={() => {
            setChoosing(null);
            setPath(null);
          }}
          onUse={(args) => {
            const feature = choosing.feature;
            const destination = path?.feature === feature ? path.destination : undefined;
            setChoosing(null);
            setPath(null);
            void sendFeature(feature, { ...args, ...(destination ? { destination } : {}) });
          }}
        />
      ) : null}

      {tracker.error && !refusal.refusal ? (
        <p role="alert" className="hsb-err" data-testid="hud-statblock-error">
          {tracker.error}
        </p>
      ) : null}
      {refusal.refusal ? (
        <div data-testid="hud-statblock-error">
          <RefusalMessage refusal={refusal.refusal} id={refusal.messageId} className="hsb-inl" />
        </div>
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
          disabled={busy}
          {...spot.control}
          title={spot.text ?? undefined}
          data-testid="hud-statblock-spotlight"
          onClick={() => void spotlightNow()}
        >
          {spotlightButtonText(spotCost)}
        </button>
        <button
          type="button"
          className="hsb-atk"
          disabled={busy || !self}
          {...atk.control}
          aria-haspopup="dialog"
          data-testid="hud-statblock-attack"
          onClick={() => {
            if (!atk.blocked) openAttack();
          }}
        >
          Attack
        </button>
      </div>
      {spotCount.over ? (
        // Plan rule-switches WF (S3, Q15 b; CB p.153 "you can't typically spotlight the same adversary more than once
        // during your turn"): the tracker card's warning, here too. A warning only, never a block.
        <p className="hsb-why" role="status" data-testid="hud-statblock-spot-over">
          {spotCount.label}: spotlit again this GM turn
        </p>
      ) : null}
      {spot.text ? (
        <p className="hsb-why" data-testid="hud-statblock-spot-why">
          <BlockedReason id={spot.reasonId}>{spot.text}</BlockedReason>
        </p>
      ) : null}
      {attackWhy ? (
        <p className="hsb-why" data-testid="hud-statblock-attack-why">
          <BlockedReason id={atk.reasonId}>
            {attackWhy.text}
            {attackWhy.refusal.hint ? <small> {attackWhy.refusal.hint}</small> : null}
          </BlockedReason>
        </p>
      ) : null}
      <p className="sr-only">{attackLine(block)}</p>
    </div>
  );
}

/** "End · 1 Fear" on a condition chip: `aria-disabled` with the Fear reason (tip and description) when it can't be paid. */
function EndByFear({ label, cost, why, onEnd }: { label: string; cost: number; why: Blocked | null; onEnd: () => void }) {
  const b = useBlocked(why);
  return (
    <>
      <button
        type="button"
        aria-label={`End ${label} · ${cost} Fear`}
        {...b.control}
        title={b.text ?? undefined}
        onClick={() => {
          if (!b.blocked) onEnd();
        }}
      >
        End · {cost} Fear
      </button>
      {b.text ? (
        <span id={b.reasonId} className="sr-only">
          {b.text}
        </span>
      ) : null}
    </>
  );
}

/** The reason under a feature's disabled Use ("This needs 1 Fear. You have 0." / "Spotlight the Lieutenant first."). */
function FeatureWhy({ why }: { why: Blocked }) {
  return (
    <p className="hsb-af-why" data-testid="hud-statblock-feature-why">
      <BlockedReason>{why.text}</BlockedReason>
    </p>
  );
}
