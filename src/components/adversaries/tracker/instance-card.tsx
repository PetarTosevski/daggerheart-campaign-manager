"use client";

import { useState, type KeyboardEvent } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Pip } from "@/components/party/sheet-ui";
import { hordeHalved, lastHp, MAX_DAMAGE, SEVERITY_LABEL, stressFull, vulnerableFromStress, type DamageRules } from "@/lib/domain/encounters/damage";
import { spotlightLimit, spotlightStatus, spotlightsThisTurn } from "@/lib/domain/encounters/spotlight";

import type { BlockRules } from "./rules";
import type { Condition, TrackerActions, TrackerInstance } from "./use-tracker";

const CONDITIONS: readonly { id: Condition; label: string }[] = [
  { id: "hidden", label: "Hidden" },
  { id: "restrained", label: "Restrained" },
  { id: "vulnerable", label: "Vulnerable" },
  { id: "distracted", label: "Distracted" },
];
const MAX_TAGS = 6;
const MAX_TAG = 30;

/** Clicking pip k marks up to k, or clears down to k − 1 when it is already marked (the board's pip behaviour). */
function pipDelta(k: number, marked: number): number {
  return k > marked ? k - marked : k - 1 - marked;
}

function Track({
  kind,
  label,
  marked,
  max,
  owner,
  onDelta,
}: {
  kind: "hp" | "stress";
  label: "Hit Point" | "Stress";
  marked: number;
  max: number;
  owner: string;
  onDelta: (delta: number) => void;
}) {
  const name = kind === "hp" ? "HP" : "Stress";
  return (
    <div className="trk-track" role="group" aria-label={`${owner} ${name}`}>
      <span className="trk-track-h">
        {name} <b>{marked}</b>/{max}
      </span>
      <span className="trk-pips">
        {Array.from({ length: max }, (_, i) => (
          <Pip
            key={i}
            kind={kind === "hp" ? "heart" : "diamond"}
            className="trk-pip"
            on={i < marked}
            label={`Mark ${label} ${i + 1} of ${max}`}
            onClick={() => onDelta(pipDelta(i + 1, marked))}
          />
        ))}
      </span>
      <span className="trk-steps">
        <BrandButton variant="neutral" size="sm" icon aria-label={`Clear 1 ${label} on ${owner}`} disabled={marked <= 0} onClick={() => onDelta(-1)}>
          −
        </BrandButton>
        <BrandButton variant="neutral" size="sm" icon aria-label={`Mark 1 ${label} on ${owner}`} disabled={kind === "hp" && marked >= max} onClick={() => onDelta(1)}>
          +
        </BrandButton>
      </span>
    </div>
  );
}

/** "37 / 70", "9 / none", or "Minion" / "none" when the block has no thresholds (CB p.201: Minions are defeated by any damage). */
function thresholdsText(major: number | null, severe: number | null, type: string | null): string {
  if (major === null && severe === null) return type === "Minion" ? "Minion" : "none";
  return `${major ?? "none"} / ${severe ?? "none"}`;
}

type DamageOutcome = { text: string; suggestedDefeats: number | null };

/**
 * The damage box: amount, Resistant, Apply; a Minion group gets the suggested defeats to confirm (CB p.201, Q4). The
 * result line follows the campaign's modes: "Massive" (CB p.91), "resists: not halved" (D2 Manual), "last HP: not
 * defeated" (D8 Manual).
 */
function DamageBox({ instance, actions, remaining }: { instance: TrackerInstance; actions: TrackerActions; remaining: number }) {
  const [amount, setAmount] = useState("");
  const [resistant, setResistant] = useState(false);
  const [outcome, setOutcome] = useState<DamageOutcome | null>(null);
  const [defeats, setDefeats] = useState(1);
  const value = Number.parseInt(amount, 10);
  const valid = Number.isInteger(value) && value >= 0 && value <= MAX_DAMAGE;

  async function apply() {
    if (!valid) return;
    const result = await actions.applyDamage(instance._id, value, resistant);
    if (!result) return;
    const halved = !resistant ? "" : result.resistanceApplied ? ` (halved to ${result.taken})` : " (resists: not halved, GM's call)";
    if (result.suggestedDefeats !== null) {
      setDefeats(Math.max(1, result.suggestedDefeats));
      setOutcome({
        text: result.suggestedDefeats === 0 ? `No damage${halved}: no Minion defeated` : `Suggested: defeat ${result.suggestedDefeats}${halved}`,
        suggestedDefeats: result.suggestedDefeats,
      });
    } else {
      const label = result.massive ? "Massive" : SEVERITY_LABEL[result.severity];
      const standing = result.lastHp && !result.defeated ? " · last HP: not defeated" : "";
      setOutcome({ text: `${label}: ${result.marked} HP marked${halved}${standing}`, suggestedDefeats: null });
    }
    setAmount("");
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void apply();
    }
  }

  return (
    <div className="trk-damage">
      <label className="trk-field">
        <span>Damage</span>
        <input
          className="trk-in trk-in-num"
          inputMode="numeric"
          aria-label={`Damage to ${instance.label}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          onKeyDown={onKey}
        />
      </label>
      <BrandButton variant="neutral" aria-pressed={resistant} onClick={() => setResistant((r) => !r)}>
        Resistant
      </BrandButton>
      <BrandButton variant="confirm" disabled={!valid} onClick={() => void apply()}>
        Apply
      </BrandButton>
      <p className="trk-result" aria-live="polite">
        {outcome?.text}
      </p>
      {outcome?.suggestedDefeats ? (
        <div className="trk-defeat" role="group" aria-label="Minions to defeat">
          <BrandButton variant="neutral" size="sm" icon aria-label="One fewer Minion" disabled={defeats <= 1} onClick={() => setDefeats((n) => n - 1)}>
            −
          </BrandButton>
          <BrandButton
            variant="danger"
            disabled={remaining <= 0}
            onClick={() =>
              void actions.defeatMinions(instance._id, Math.min(defeats, remaining)).then((r) => {
                if (r) setOutcome(null);
              })
            }
          >
            Defeat {Math.min(defeats, remaining)}
          </BrandButton>
          <BrandButton variant="neutral" size="sm" icon aria-label="One more Minion" disabled={defeats >= remaining} onClick={() => setDefeats((n) => n + 1)}>
            +
          </BrandButton>
        </div>
      ) : null}
    </div>
  );
}

function Tags({ instance, actions }: { instance: TrackerInstance; actions: TrackerActions }) {
  const [draft, setDraft] = useState("");
  function add() {
    const tag = draft.trim();
    if (tag === "" || instance.tags.includes(tag)) return setDraft("");
    void actions.setTags(instance._id, [...instance.tags, tag]).then((r) => {
      if (r) setDraft("");
    });
  }
  return (
    <div className="trk-tags">
      {instance.tags.map((tag) => (
        <span key={tag} className="trk-tag">
          {tag}
          <BrandButton
            variant="neutral"
            size="sm"
            icon
            aria-label={`Remove tag ${tag}`}
            onClick={() =>
              void actions.setTags(
                instance._id,
                instance.tags.filter((t) => t !== tag),
              )
            }
          >
            ×
          </BrandButton>
        </span>
      ))}
      {instance.tags.length < MAX_TAGS ? (
        <input
          className="trk-in trk-in-tag"
          aria-label={`Add a tag to ${instance.label}`}
          placeholder="Add a tag (Cursed, Glowing…)"
          maxLength={MAX_TAG}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={() => {
            if (draft.trim() !== "") add();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * One adversary instance on the tracker: Difficulty and damage thresholds, HP hearts and Stress diamonds (the player
 * sheet's sheet-ui pips on a parchment strip), the damage box, Minion group count
 * and defeats, the Horde halved note, conditions (+ Vulnerable while Stress is full, CB p.178), tags and the spotlight
 * counter for this GM turn. The name button selects it and shows its stat block.
 *
 * Rule switches (plan rule-switches, tracer RDM): `modes` are the campaign's modes. D5 Manual shows "Stress full" with
 * no Vulnerable; D8 Manual shows "Last HP" on an adversary with every HP marked that the GM has not defeated; F3 Manual
 * labels an extra spotlight "Spotlight · extra" (no Fear is spent; the GM gets a note).
 */
export function InstanceCard({
  instance,
  rules,
  gmTurn,
  spotlightCostsFear = false,
  extraSpotlight = false,
  modes = {},
  selected,
  onSelect,
  actions,
}: {
  instance: TrackerInstance;
  rules: BlockRules | null;
  gmTurn: number;
  /** A spotlight was already given this GM turn, so the next one spends 1 Fear (CB p.153). */
  spotlightCostsFear?: boolean;
  /** F3 Manual: the next spotlight is an extra one this GM turn, but no Fear is spent by itself. */
  extraSpotlight?: boolean;
  /** The campaign's damage rule modes (unset = the Book). */
  modes?: DamageRules;
  selected: boolean;
  onSelect: () => void;
  actions: TrackerActions;
}) {
  const { hp, stress, stats } = instance;
  const minions = instance.minionCount !== undefined;
  const remaining = stats.hpMax - hp;
  const tracks = { hp, hpMax: stats.hpMax, stress, stressMax: stats.stressMax };
  const spot = spotlightStatus(spotlightsThisTurn(instance, gmTurn), spotlightLimit(rules?.relentless ?? null));
  const maxed = spot.limit !== "X" && spot.count >= spot.limit;
  const halved = rules?.hordeX && !instance.defeated && hordeHalved(tracks);
  const autoVulnerable = vulnerableFromStress(tracks, modes);
  const fullOnly = !autoVulnerable && stressFull(tracks);
  const standing = !instance.defeated && modes.adversaryDefeated === "manual" && lastHp(tracks);
  const typeLine = instance.type ? `Tier ${instance.tier} ${instance.type}` : "deleted custom adversary";

  return (
    <article className="trk-card" data-selected={selected} data-defeated={instance.defeated} aria-label={instance.label}>
      <div className="trk-card-head">
        <button type="button" className="trk-card-name" aria-pressed={selected} onClick={onSelect}>
          {instance.label}
          {minions ? <span className="trk-count"> ×{instance.minionCount}</span> : null}
        </button>
        <span className="trk-type">{typeLine}</span>
        {instance.defeated ? <span className="trk-badge trk-badge-defeated">Defeated</span> : null}
        {standing ? <span className="trk-badge trk-badge-defeated">Last HP</span> : null}
        <span className="trk-diff">
          Difficulty <b>{stats.difficulty}</b>
          <span className="trk-thr" data-testid="thresholds">
            Thresholds <b>{thresholdsText(stats.major, stats.severe, instance.type)}</b>
          </span>
        </span>
      </div>

      {minions ? (
        <p className="trk-note">
          {remaining} of {instance.minionCount} Minions left{rules?.minionX ? ` · Minion (${rules.minionX})` : ""}
        </p>
      ) : null}
      <Track kind="hp" label="Hit Point" marked={hp} max={stats.hpMax} owner={instance.label} onDelta={(d) => void actions.markHp(instance._id, d)} />
      {stats.stressMax > 0 ? (
        <Track kind="stress" label="Stress" marked={stress} max={stats.stressMax} owner={instance.label} onDelta={(d) => void actions.markStress(instance._id, d)} />
      ) : null}
      {halved ? <p className="trk-note trk-note-warn">Horde halved: its attack now deals {rules?.hordeX}.</p> : null}

      <DamageBox instance={instance} actions={actions} remaining={remaining} />

      <div className="trk-conds" role="group" aria-label={`${instance.label} conditions`}>
        {CONDITIONS.map((c) => (
          <BrandButton key={c.id} variant="neutral" aria-pressed={instance.conditions.includes(c.id)} onClick={() => void actions.toggleCondition(instance._id, c.id)}>
            {c.label}
            {instance.conditions.includes(c.id) ? <span aria-hidden="true"> ×</span> : null}
          </BrandButton>
        ))}
        {autoVulnerable && !instance.conditions.includes("vulnerable") ? <span className="trk-auto">Vulnerable · Stress full</span> : null}
        {fullOnly ? <span className="trk-auto">Stress full</span> : null}
      </div>
      <Tags instance={instance} actions={actions} />

      <div className="trk-spot">
        <span className="trk-spot-count" data-over={spot.over} data-testid="spotlight-count">
          {spot.label}
        </span>
        {spot.over ? <span className="trk-spot-warn">Past the limit for this GM turn</span> : null}
        <BrandButton
          // At or past its limit for this GM turn (1, or Relentless X): ember (the warning colour), never blocked.
          variant={maxed ? "danger" : "neutral"}
          data-maxed={maxed}
          aria-label={`Spotlight ${instance.label}${spotlightCostsFear ? " (spends 1 Fear)" : extraSpotlight ? " (extra spotlight, no Fear spent)" : ""}`}
          onClick={() => void actions.spotlight(instance._id)}
        >
          {spotlightCostsFear ? "Spotlight · 1 Fear" : extraSpotlight ? "Spotlight · extra" : "Spotlight"}
        </BrandButton>
      </div>
    </article>
  );
}
