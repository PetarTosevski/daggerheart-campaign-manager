"use client";

import { useState } from "react";

import type { StatBlockAdversary } from "../../catalogue/stat-block";
import { needsChoices, type Creature, type FeatureAsk } from "./ask";
import { FeatureChoices, type ChoiceArgs } from "./choices";
import { FeatureUse } from "./feature-use";
import { fearPrompt, toggled, usable, type TargetOption } from "./model";
import { ActionResultView } from "./result";
import type { AdversaryActions, Intent, Resolved } from "./use-adversary-actions";

type Edge = "none" | "advantage" | "disadvantage";
const EDGES: readonly { id: Edge; label: string }[] = [
  { id: "none", label: "Normal" },
  { id: "advantage", label: "Advantage" },
  { id: "disadvantage", label: "Disadvantage" },
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
  // Only targets still offered count (a PC who left the map or the party drops out of the pick).
  const picked = targets.filter((id) => options.some((o) => o.characterId === id));
  const reactionFeatures = block.features.filter((f) => f.kind === "reaction");
  const shared = {
    instanceId,
    targets: picked,
    ...(edge === "advantage" ? { advantage: 1 } : edge === "disadvantage" ? { disadvantage: 1 } : {}),
    ...(experience ? { experience } : {}),
  };

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
  const sendFeature = (feature: string, extra: Partial<ChoiceArgs> = {}) =>
    void fire({ kind: "feature", label: `${actor} uses ${feature}`, actor, args: { ...shared, feature, ...extra } });

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
            <button
              key={o.characterId}
              type="button"
              className="trk-chip trk-chip-parch"
              aria-pressed={picked.includes(o.characterId)}
              onClick={() => onTargets(toggled(picked, o.characterId))}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}

      <div className="trk-act-row">
        <div className="trk-seg" role="group" aria-label="Advantage">
          {EDGES.map((e) => (
            <button key={e.id} type="button" aria-pressed={edge === e.id} onClick={() => setEdge(e.id)}>
              {e.label}
            </button>
          ))}
        </div>
        {block.experiences.length > 0 ? (
          <label className="trk-act-field">
            <span>Experience</span>
            <select className="trk-in trk-in-parch" value={experience} onChange={(e) => setExperience(e.target.value)}>
              <option value="">None</option>
              {block.experiences.map((x) => (
                <option key={x.name} value={x.name} disabled={fear < 1}>
                  {x.name} +{x.value} (1 Fear)
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {reactionFeatures.length > 0 ? (
        <div className="trk-act-targets" role="group" aria-label="Reactions on this attack">
          <span className="trk-act-sub">Use on this attack:</span>
          {reactionFeatures.map((f) => (
            <button key={f.name} type="button" className="trk-chip trk-chip-parch" aria-pressed={reactions.includes(f.name)} onClick={() => setReactions(toggled(reactions, f.name))}>
              {f.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="trk-act-row">
        <button
          type="button"
          className="trk-btn trk-btn-attack"
          disabled={busy || picked.length === 0}
          onClick={() => void fire({ kind: "attack", label: `${actor} attacks`, actor, args: { ...shared, ...(reactions.length ? { reactions } : {}) } })}
        >
          ⚔ Attack{who ? ` ${who}` : ""} with {block.attack.name}
        </button>
        {spotNote ? <span className="trk-act-note">{spotNote}</span> : null}
        {picked.length === 0 && options.length > 0 ? <span className="trk-act-note">Pick a target first.</span> : null}
      </div>

      {acts.confirm ? (
        <div className="trk-confirm" role="group" aria-label="Spend Fear?">
          <p>{fearPrompt(acts.confirm.fear)}</p>
          <button type="button" className="trk-btn trk-btn-parch trk-btn-fear" disabled={acts.pending || fear < acts.confirm.fear.fear} onClick={() => void spend()}>
            Spend {acts.confirm.fear.fear} Fear
          </button>
          <button type="button" className="trk-btn trk-btn-parch" onClick={acts.cancel}>
            Cancel
          </button>
          {fear < acts.confirm.fear.fear ? <span className="trk-act-note">You hold only {fear} Fear.</span> : null}
        </div>
      ) : null}
      <p className="trk-act-err" role="status">
        {acts.error}
      </p>
      {acts.result && acts.result.instanceId === instanceId ? (
        <ActionResultView shown={acts.result} nameOf={nameOf} pending={acts.pending} onFire={(intent) => void fire(intent)} onDismiss={acts.dismiss} />
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
                onUse={(ask) => (ask && needsChoices(ask) ? setChoosing(ask) : sendFeature(f.name))}
              />
            ) : (
              <span className="trk-act-note">Modifier: applies on its own</span>
            )}
          </li>
        ))}
      </ul>
      {choosing ? (
        <FeatureChoices
          key={choosing.feature}
          campaignId={acts.campaignId}
          instanceId={instanceId}
          actor={actor}
          first={choosing}
          creatures={creatures}
          panelTargets={picked}
          fear={fear}
          pending={acts.pending}
          onClose={() => setChoosing(null)}
          onUse={(args) => {
            setChoosing(null);
            sendFeature(choosing.feature, args);
          }}
        />
      ) : null}
    </section>
  );
}
