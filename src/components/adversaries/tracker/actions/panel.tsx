"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import type { Range } from "@/lib/domain/card-effects/types";

import { api } from "../../../../../convex/_generated/api";
import { darkHeartedOption } from "../../../combat-map/hud/statblock/model";
import { withinText, type Square } from "../../../combat-map/hud/pick-area/model";
import { startAreaPick, useAreaPick } from "../../../combat-map/map-view/area-pick";
import type { StatBlockAdversary } from "../../catalogue/stat-block";
import { needsChoices, type Creature, type FeatureAsk } from "./ask";
import { FeatureChoices, type ChoiceArgs } from "./choices";
import { FeatureUse } from "./feature-use";
import { useLiveMap } from "./live";
import { experienceText, fearPrompt, toggled, usable, type TargetOption } from "./model";
import { pathCrossed, pathOutside, type PathToken } from "./path";
import { ActionResultView } from "./result";
import type { AdversaryActions, Intent, Resolved } from "./use-adversary-actions";

/** FP2: W3 Tier 3 Dark-Hearted, in the HUD pickers' words ("Dark-Hearted: advantage", "Costs 1 Fear (Doom Track Tier 3)"). */
const DARK_HEARTED = darkHeartedOption(true)[0]!;

/** FP2: a "path" feature's picked destination and who its line crosses (pre-picked as its targets). */
type PathPick = { feature: string; ask: FeatureAsk; destination: Square; crossed: string[] };

type Edge = "none" | "advantage" | "disadvantage";
/** Each option's glass role (the roll toggle: Normal grey, Advantage / Disadvantage in the viewer's colours). */
const EDGES: readonly { id: Edge; label: string; role: "normal" | "advantage" | "disadvantage" }[] = [
  { id: "none", label: "Normal", role: "normal" },
  { id: "advantage", label: "Advantage", role: "advantage" },
  { id: "disadvantage", label: "Disadvantage", role: "disadvantage" },
];
const KIND_LABEL = { passive: "Passive", action: "Action", reaction: "Reaction", evolution: "Evolution" } as const;

function namesOf(ids: readonly string[], options: readonly TargetOption[]): string {
  const names = ids.map((id) => options.find((o) => o.characterId === id)?.name).filter((n): n is string => n !== undefined);
  return names.length <= 2 ? names.join(" and ") : `${names.length} targets`;
}

/**
 * The selected adversary's actions on the Encounter tab (plan combat-actions AA3; Q12, Q16): pick PC targets (the
 * party list without a live map, the PCs on the map with one; Q18), choose advantage, an Experience (1 Fear) and the
 * attack reactions to use, then Attack, or Use any non-passive feature. Everything goes through AA2's server: it rolls,
 * opens the reaction windows and asks before spending Fear (Q19), which this panel shows as a "Spend N Fear?" question.
 * Passive features apply on their own and are listed as modifiers. AA3b: a feature that needs the GM's choices (AA2c's
 * `featureAsk`: options, creature lists, splits, situations, cost picks, optional steps) asks them in a dialog before
 * `useFeature`; `adversaries` (the encounter's other instances) feeds its ally lists (without it they list no one).
 *
 * Plan finish-in-progress FP2 (rule switches WF, as the Combat Map HUD's stat block does): W3 Tier 3 Dark-Hearted
 * (advantage for 1 Fear on the Attack and on features that make an attack roll, once `adversaryActions.darkHearted`),
 * F4 Manual (an Experience asks no Fear: "spend 1 Fear by hand"), and a "path" feature's destination (`pathMove`:
 * Rampaging Fury, Trample) picked on the tab's live map pane, sent as `useFeature` `destination` with everyone the
 * line crosses pre-picked.
 */
export function ActionPanel({
  instanceId,
  actor,
  block,
  defeated,
  fear,
  spotNote,
  mode,
  options,
  targets,
  onTargets,
  acts,
  onDice,
  adversaries = [],
}: {
  instanceId: string;
  actor: string;
  block: StatBlockAdversary;
  defeated: boolean;
  fear: number;
  spotNote: string | null;
  mode: "map" | "party";
  options: readonly TargetOption[];
  targets: readonly string[];
  onTargets: (ids: string[]) => void;
  acts: AdversaryActions;
  onDice: (dice: NonNullable<Resolved["roll"]>["dice"]) => void;
  /** The encounter's adversaries still standing ({instance id, label}), for the choices dialog's ally lists (AA3b). */
  adversaries?: readonly { id: string; name: string }[];
}) {
  const [choosing, setChoosing] = useState<FeatureAsk | null>(null);
  const [edge, setEdge] = useState<Edge>("none");
  const [experience, setExperience] = useState("");
  const [reactions, setReactions] = useState<string[]>([]);
  const [darkPicked, setDarkPicked] = useState(false);
  const [path, setPath] = useState<PathPick | null>(null);
  const [pathAsking, setPathAsking] = useState(false);
  const campaignId = acts.campaignId;
  // FP2: F4 Manual (Experience Fear by hand), C4 Book (unconscious PCs left out of a path's line), Defined Ranges.
  const modes = useQuery(api.ruleSettings.get, { campaignId })?.modes;
  const experienceByHand = modes?.adversaryExperienceFear === "manual";
  const skipUnconscious = (modes?.unconscious ?? "book") === "book";
  const definedRanges = modes?.definedRanges ?? true;
  const darkHeartedOn = useQuery(api.adversaryActions.darkHearted, { campaignId }) === true;
  const dark = darkPicked && darkHeartedOn;
  // FP2: the live map pane under the tracker (the same queries the tracker reads; Convex shares them).
  const map = useLiveMap(campaignId);
  const tokens = useQuery(api.combatTokensReads.list, map ? { campaignId, mapId: map._id } : "skip");
  const areaPick = useAreaPick();
  const self = tokens?.find((t) => t.instanceId === instanceId);
  // Only targets still offered count (a PC who left the map or the party drops out of the pick).
  const picked = targets.filter((id) => options.some((o) => o.characterId === id));
  const reactionFeatures = block.features.filter((f) => f.kind === "reaction");
  const shared = {
    instanceId,
    targets: picked,
    ...(edge === "advantage" ? { advantage: 1 } : edge === "disadvantage" ? { disadvantage: 1 } : {}),
    ...(experience ? { experience } : {}),
  };
  const darkArgs = dark ? { darkHearted: true } : {};

  async function fire(intent: Intent) {
    const done = await acts.fire(intent);
    if (done?.roll) onDice(done.roll.dice);
  }
  async function spend() {
    const done = await acts.spend();
    if (done?.roll) onDice(done.roll.dice);
  }

  const busy = acts.pending || defeated;
  const who = namesOf(picked, options);
  const nameOf = (id: string) => options.find((o) => o.characterId === id)?.name ?? "a target";
  const creatures: Creature[] = [...options.map((o) => ({ id: o.characterId, name: o.name, kind: "pc" as const })), ...adversaries.map((a) => ({ ...a, kind: "adversary" as const }))];
  // Dark-Hearted gives advantage on a roll: only a feature that makes an attack roll (its featureAsk says so) takes it.
  const sendFeature = (feature: string, ask: FeatureAsk | null, extra: Partial<ChoiceArgs> & { destination?: Square } = {}) =>
    void fire({ kind: "feature", label: `${actor} uses ${feature}`, actor, args: { ...shared, feature, ...(ask?.attack ? darkArgs : {}), ...extra } });

  /**
   * FP2 (the HUD's `startPath`): a "path" feature asks for its destination on the live map pane first, within its move's
   * range of the token; everyone the straight line crosses starts picked. Side "any" or a feature that needs choices
   * opens the choices dialog with them as targets; otherwise they become the panel's targets and a confirm row sends it.
   */
  function startPath(feature: string, ask: FeatureAsk, from: PathToken, mapId: string) {
    const within = ask.pathMove as Range;
    const prompt = `Pick ${actor}’s destination for ${feature}${withinText({ within })}`;
    setPath(null);
    setPathAsking(true);
    const request = (text: string) =>
      startAreaPick({
        prompt: text,
        mapId,
        onPick: async (destination) => {
          if (pathOutside(from, within, destination, definedRanges)) {
            request(`That square is out of range. ${prompt}`);
            return null;
          }
          setPathAsking(false);
          const anySide = ask.targets?.side === "any";
          const crossed = pathCrossed({ self: from, destination, tokens: tokens ?? [], instanceId, standing: adversaries.map((a) => a.id), anySide, skipUnconscious });
          setPath({ feature, ask, destination, crossed });
          if (needsChoices(ask) || anySide) setChoosing(ask);
          else onTargets(crossed);
          return null;
        },
      });
    request(prompt);
  }

  function runFeature(feature: string, ask: FeatureAsk | null) {
    if (ask?.pathMove && map && self) return startPath(feature, ask, self, map._id);
    if (ask && needsChoices(ask)) return setChoosing(ask);
    sendFeature(feature, ask);
  }

  const choosingPath = choosing && path?.feature === choosing.feature ? path : null;
  // The pick runs in the map pane's module store: this panel's note shows only while that pick is still open.
  const pickingPath = pathAsking && map != null && areaPick.request?.mapId === map._id;

  return (
    <section className="trk-act" aria-label="Adversary actions">
      <div className="trk-act-h">
        <strong>Targets</strong>
        <span className="trk-act-sub">{mode === "map" ? "PCs on the live map (line of sight is checked)" : "The party (no live map: no range limits)"}</span>
      </div>
      {options.length === 0 ? (
        <p className="trk-act-note">{mode === "map" ? "No PC tokens on the live map." : "No active characters in the party."}</p>
      ) : (
        <div className="trk-act-targets" role="group" aria-label="Targets">
          {options.map((o) => (
            <BrandButton key={o.characterId} variant="neutral" aria-pressed={picked.includes(o.characterId)} onClick={() => onTargets(toggled(picked, o.characterId))}>
              {o.name}
            </BrandButton>
          ))}
        </div>
      )}

      <div className="trk-act-row">
        <div className="trk-seg" role="group" aria-label="Advantage">
          {EDGES.map((e) => (
            <BrandButton key={e.id} variant={e.role} aria-pressed={edge === e.id} onClick={() => setEdge(e.id)}>
              {e.label}
            </BrandButton>
          ))}
        </div>
        {block.experiences.length > 0 ? (
          <label className="trk-act-field">
            <span>Experience</span>
            <select className="trk-in trk-in-parch" value={experience} onChange={(e) => setExperience(e.target.value)}>
              <option value="">None</option>
              {block.experiences.map((x) => (
                <option key={x.name} value={x.name} disabled={!experienceByHand && fear < 1}>
                  {experienceText(x, experienceByHand)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {darkHeartedOn ? (
          <BrandButton variant="advantage" aria-pressed={dark} title={DARK_HEARTED.note} onClick={() => setDarkPicked(!darkPicked)}>
            {DARK_HEARTED.label} (1 Fear)
          </BrandButton>
        ) : null}
      </div>
      {dark ? <p className="trk-act-note">Dark-Hearted (Doom Track Tier 3): on the Attack and on features that make an attack roll.</p> : null}
      {reactionFeatures.length > 0 ? (
        <div className="trk-act-targets" role="group" aria-label="Reactions on this attack">
          <span className="trk-act-sub">Use on this attack:</span>
          {reactionFeatures.map((f) => (
            <BrandButton key={f.name} variant="neutral" aria-pressed={reactions.includes(f.name)} onClick={() => setReactions(toggled(reactions, f.name))}>
              {f.name}
            </BrandButton>
          ))}
        </div>
      ) : null}
      <div className="trk-act-row">
        <BrandButton
          variant="confirm"
          disabled={busy || picked.length === 0}
          onClick={() => void fire({ kind: "attack", label: `${actor} attacks`, actor, args: { ...shared, ...darkArgs, ...(reactions.length ? { reactions } : {}) } })}
        >
          ⚔ Attack{who ? ` ${who}` : ""} with {block.attack.name}
        </BrandButton>
        {spotNote ? <span className="trk-act-note">{spotNote}</span> : null}
        {picked.length === 0 && options.length > 0 ? <span className="trk-act-note">Pick a target first.</span> : null}
      </div>

      {acts.confirm ? (
        <div className="trk-confirm" role="group" aria-label="Spend Fear?">
          <p>{fearPrompt(acts.confirm.fear)}</p>
          <BrandButton variant="confirm" disabled={acts.pending || fear < acts.confirm.fear.fear} onClick={() => void spend()}>
            Spend {acts.confirm.fear.fear} Fear
          </BrandButton>
          <BrandButton variant="cancel" onClick={acts.cancel}>
            Cancel
          </BrandButton>
          {fear < acts.confirm.fear.fear ? <span className="trk-act-note">You hold only {fear} Fear.</span> : null}
        </div>
      ) : null}
      <p className="trk-act-err" role="status">
        {acts.error}
      </p>
      {acts.result && acts.result.instanceId === instanceId ? (
        <ActionResultView shown={acts.result} nameOf={nameOf} pending={acts.pending} onFire={(intent) => void fire(intent)} onDismiss={acts.dismiss} glass />
      ) : null}

      <div className="trk-act-h">
        <strong>Use a feature</strong>
      </div>
      <ul className="trk-act-feats" aria-label="Features">
        {block.features.map((f, i) => (
          <li key={`${i}-${f.name}`}>
            <span className="trk-act-fname">{f.name}</span>
            <span className={`adc-kind adc-kind-${f.kind}`}>{KIND_LABEL[f.kind]}</span>
            {f.fearCost ? <span className="adc-kind adc-kind-fear">Fear {f.fearCost}</span> : null}
            {usable(f.kind) ? (
              <FeatureUse
                campaignId={acts.campaignId}
                instanceId={instanceId}
                feature={f.name}
                fearCost={f.fearCost}
                disabled={busy}
                live={!defeated}
                glass
                onUse={(ask) => runFeature(f.name, ask)}
              />
            ) : (
              <span className="trk-act-note">Modifier: applies on its own</span>
            )}
          </li>
        ))}
      </ul>
      {pickingPath ? (
        <p className="trk-act-note" role="status">
          Click the destination square on the live map below.
        </p>
      ) : null}
      {path && !choosing ? (
        <div className="trk-confirm" role="group" aria-label={`${path.feature} destination`}>
          <p>
            {actor} moves to ({path.destination.x}, {path.destination.y}): everyone in its path is picked. Change the targets above if needed.
          </p>
          <BrandButton
            variant="confirm"
            disabled={busy}
            onClick={() => {
              const { feature, ask, destination } = path;
              setPath(null);
              sendFeature(feature, ask, { useId: ask.useId, destination });
            }}
          >
            Use {path.feature}
            {who ? ` on ${who}` : ""}
          </BrandButton>
          <BrandButton variant="cancel" onClick={() => setPath(null)}>
            Cancel
          </BrandButton>
        </div>
      ) : null}
      {choosing ? (
        <FeatureChoices
          key={choosing.feature}
          campaignId={acts.campaignId}
          instanceId={instanceId}
          actor={actor}
          first={choosing}
          creatures={creatures}
          panelTargets={choosingPath ? choosingPath.crossed : picked}
          fear={fear}
          pending={acts.pending}
          glass
          onClose={() => {
            setChoosing(null);
            setPath(null);
          }}
          onUse={(args) => {
            const destination = choosingPath?.destination;
            setChoosing(null);
            setPath(null);
            sendFeature(choosing.feature, choosing, { ...args, ...(destination ? { destination } : {}) });
          }}
        />
      ) : null}
    </section>
  );
}
