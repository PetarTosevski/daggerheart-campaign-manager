"use client";

import "@/components/party/dice/dice.css";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { Modal } from "@/components/brand/modal";
import { DiceTiles } from "@/components/party/dice/parts";
import { weaponDice } from "@/lib/domain/dice";
import type { RollRecord } from "@/lib/domain/duality";
import { errorMessage } from "@/lib/convex-errors";
import { TRAIT_LABEL } from "@/lib/frames/extras/common";
import { WEAPONS } from "@/lib/srd/equipment";
import { TRAIT_IDS, type TraitId, type Weapon } from "@/lib/srd/types";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../../../convex/characters";
import type { ActionsPanelProps } from "../../slots";
import { BAND_LABEL, type RangeBand } from "../targets";
import { seenTargets, useActor, useCombatTargets, type WeaponSlot } from "../targets/state";
import { usePanelMemory } from "./memory";

/**
 * The Attack bar (plan combat-actions CA5): the primary and secondary weapon with damage at Proficiency, the duality
 * options of the sheet's dice box (Experiences, advantage, help), and `combatActions.attack` against the picked
 * targets, once per click with a "Rolling…" state (rule 12). The result shows the player's own dice, the damage total
 * and Hit / Miss / Defeated per target, never an enemy's numbers (U1, Q5). A Minion offer opens the pick dialog (Q6);
 * an out-of-range attack waits for the GM (Q1).
 */

export type AttackOutcome = FunctionReturnType<typeof api.combatActions.attack>;
export type ResolvedAttack = Extract<AttackOutcome, { status: "resolved" }>;
type MineRow = FunctionReturnType<typeof api.combatRequests.mine>[number];
type MinionOfferRow = Extract<MineRow, { kind: "minionOffer" }>;

/** The most advantage, disadvantage or help dice the bar offers (the dice box's limit). */
const DICE_LIMIT = 6;

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

/** "2d8+3 phy": the weapon's damage at the character's Proficiency, as the sheet shows it. */
export function damageLabel(weapon: Pick<Weapon, "damage">, proficiency: number): string {
  const type = weapon.damage.trim().split(/\s+/)[1] ?? "";
  try {
    const { dice, flat } = weaponDice(weapon.damage, proficiency);
    return `${dice.map((d) => `${d.count}d${d.sides}`).join("+")}${flat ? `+${flat}` : ""}${type ? ` ${type}` : ""}`;
  } catch {
    return weapon.damage;
  }
}

/** The equipped weapons of a sheet, primary first. */
export function equippedWeapons(sheet: Pick<CharacterView["sheet"], "primaryWeaponId" | "secondaryWeaponId">): { slot: WeaponSlot; weapon: Weapon }[] {
  const out: { slot: WeaponSlot; weapon: Weapon }[] = [];
  for (const [slot, id] of [
    ["primary", sheet.primaryWeaponId],
    ["secondary", sheet.secondaryWeaponId],
  ] as const) {
    const weapon = id ? WEAPONS.find((w) => w.id === id) : undefined;
    if (weapon) out.push({ slot, weapon });
  }
  return out;
}

/** "Critical success", "With Hope", "With Fear": the attack roll has no Difficulty for the player (U1). */
export function outcomeLine(roll: RollRecord): { tone: "crit" | "hope" | "fear"; text: string } {
  if (roll.outcome === "critical") return { tone: "crit", text: "Critical success" };
  return roll.outcome.endsWith("Hope") ? { tone: "hope", text: "With Hope" } : { tone: "fear", text: "With Fear" };
}

/** What the player learns about one target (U1): Hit, Miss or Defeated. */
export function targetVerdict(t: { hit: boolean; defeated: boolean }): "Hit" | "Miss" | "Defeated" {
  if (t.defeated) return "Defeated";
  return t.hit ? "Hit" : "Miss";
}

/**
 * The result of a resolved attack: the duality dice and total, the outcome, the damage dice and total, and per target
 * Hit / Miss / Defeated. It never shows HP, Stress, thresholds or Difficulty: the server never sends them (U1).
 */
export function AttackResult({ result, names, weaponName }: { result: Pick<ResolvedAttack, "roll" | "damage" | "targets" | "fearGained">; names: ReadonlyMap<string, string>; weaponName: string }) {
  const outcome = outcomeLine(result.roll);
  return (
    <section className="cma-result" aria-label="Attack result" data-testid="combat-attack-result">
      <div className="cma-result-row">
        <DiceTiles roll={result.roll} />
        <div className="cma-result-main">
          <span className="cma-total">{result.roll.total}</span>
          <span className="cma-result-text">
            <span className={`cma-outcome ${outcome.tone}`}>{outcome.text}</span>
            <span className="cm-muted cma-small">Attack with {weaponName}</span>
          </span>
        </div>
      </div>
      {result.damage ? (
        <div className="cma-result-row" data-testid="combat-attack-damage">
          <DiceTiles roll={result.damage} />
          <div className="cma-result-main">
            <span className="cma-total dmg">{result.damage.total}</span>
            <span className="cma-result-text">
              <span className="cma-outcome dmg">Damage</span>
              <span className="cm-muted cma-small">Your damage total</span>
            </span>
          </div>
        </div>
      ) : null}
      <ul className="cma-verdicts" aria-label="Targets">
        {result.targets.map((t) => {
          const verdict = targetVerdict(t);
          return (
            <li key={t.tokenId} className="cma-verdict" data-verdict={verdict.toLowerCase()} data-testid="combat-verdict">
              <span>{names.get(t.tokenId) ?? "Target"}</span>
              <strong>{verdict}</strong>
            </li>
          );
        })}
      </ul>
      {result.fearGained > 0 ? <p className="cm-muted cma-small cma-note">Rolled with Fear: the GM gains a Fear.</p> : null}
    </section>
  );
}

/** A labelled − n + stepper in the map's style (advantage, help dice). */
function Stepper({ label, value, min, max, text, onChange }: { label: string; value: number; min: number; max: number; text: string; onChange: (n: number) => void }) {
  return (
    <div className="cma-stepper" role="group" aria-label={label}>
      <span className="cm-lbl">{label}</span>
      <span className="cma-stepper-row">
        <button type="button" className="cm-btn cm-sm" aria-label={`Less ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <output className="cma-stepper-val" aria-live="polite">
          {text}
        </output>
        <button type="button" className="cm-btn cm-sm" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </span>
    </div>
  );
}

type Last = { kind: "resolved"; result: ResolvedAttack; names: Map<string, string>; weaponName: string } | { kind: "pending"; outOfRange: { tokenId: string; band: RangeBand }[]; names: Map<string, string> };

/** Player column: the Attack bar. Renders nothing for a character without a token on the live map. */
export function AttackBar(props: ActionsPanelProps) {
  const actor = useActor(props);
  if (!actor) return null;
  return <AttackForm {...props} characterId={actor.characterId} enemies={actor.enemies} />;
}

function AttackForm({ campaignId, map, characterId, enemies }: ActionsPanelProps & { characterId: Id<"characters">; enemies: readonly { _id: Id<"combatTokens">; name: string }[] }) {
  const character = useQuery(api.characters.get, { characterId });
  const { targetTokenIds, slot, setSlot } = useCombatTargets();
  const attack = useIntent(api.combatActions.attack);
  const [experienceIds, setExperienceIds] = useState<string[]>([]);
  const [edge, setEdge] = useState(0);
  const [help, setHelp] = useState(0);
  const [trait, setTrait] = useState<TraitId>("strength");
  // Kept above the desktop / phone layout switch (user answer 2026-10-22), per character.
  const [last, setLast] = usePanelMemory<Last | null>(`attack:${characterId}`, null);
  const [pickFor, setPickFor] = useState<Id<"combatRequests"> | null>(null);

  if (character === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading your weapons…
      </p>
    );
  }
  if (character === null) return null;
  const sheet = character.sheet;
  const weapons = equippedWeapons(sheet);
  const chosen = weapons.find((w) => w.slot === slot) ?? weapons[0];
  // A plain weapon attack targets one enemy (user answer 2026-10-22, CB p.96): the latest pick.
  const picked = seenTargets(targetTokenIds, enemies).slice(-1);
  const names = new Map<string, string>(enemies.map((t) => [t._id, t.name]));
  const notEnoughHope = experienceIds.length > sheet.hope;
  const canAttack = chosen !== undefined && picked.length > 0 && !attack.pending && !notEnoughHope;

  async function fire() {
    if (!chosen) return;
    const weaponName = chosen.weapon.name;
    const out = await attack.fire({
      campaignId,
      characterId,
      mapId: map._id,
      targetTokenIds: picked,
      slot: chosen.slot,
      ...(chosen.weapon.trait === "choice" ? { trait } : {}),
      modifier: 0,
      experienceIds,
      advantage: Math.max(0, edge),
      disadvantage: Math.max(0, -edge),
      help,
      options: [],
    });
    if (!out) return;
    setExperienceIds([]);
    if (out.status === "resolved") {
      setLast({ kind: "resolved", result: out, names, weaponName });
      if (out.minionOffer) setPickFor(out.minionOffer.requestId);
    } else {
      setLast({ kind: "pending", outOfRange: out.outOfRange, names });
    }
  }

  return (
    <div className="cma-attack" data-testid="combat-attack-bar">
      {weapons.length === 0 ? (
        <p className="cm-muted cma-note">No weapon equipped. Equip one on your character sheet.</p>
      ) : (
        <div className="cma-weapons" role="group" aria-label="Weapon">
          {weapons.map(({ slot: s, weapon }) => (
            <button key={s} type="button" className="cma-weapon" aria-pressed={chosen?.slot === s} onClick={() => setSlot(s)}>
              <span className="cm-lbl">{s === "primary" ? "Primary" : "Secondary"}</span>
              <span className="cma-weapon-name">{weapon.name}</span>
              <span className="cma-weapon-meta">
                <strong>{damageLabel(weapon, sheet.proficiency)}</strong> · {weapon.range}
              </span>
            </button>
          ))}
        </div>
      )}
      {chosen?.weapon.trait === "choice" ? (
        <label className="cma-field">
          <span className="cm-lbl">Trait</span>
          <select className="cm-in cma-select" value={trait} onChange={(e) => setTrait(e.target.value as TraitId)}>
            {TRAIT_IDS.map((t) => (
              <option key={t} value={t}>
                {TRAIT_LABEL[t]} {signed(sheet.traits[t])}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <details className="cma-opts">
        <summary className="cm-lbl">Roll options</summary>
        <div className="cma-opts-body">
          {sheet.experiences.length > 0 ? (
            <div className="cma-chips" role="group" aria-label="Experiences (1 Hope each)">
              <span className="cm-lbl">Experiences (1 Hope each)</span>
              {sheet.experiences.map((e) => {
                const on = experienceIds.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    className="cm-chip"
                    aria-pressed={on}
                    onClick={() => setExperienceIds((ids) => (on ? ids.filter((id) => id !== e.id) : [...ids, e.id]))}
                  >
                    {e.name} ({signed(e.value)})
                  </button>
                );
              })}
            </div>
          ) : null}
          <Stepper
            label="Advantage"
            value={edge}
            min={-DICE_LIMIT}
            max={DICE_LIMIT}
            text={edge === 0 ? "Normal" : edge > 0 ? `Advantage ×${edge}` : `Disadvantage ×${-edge}`}
            onChange={setEdge}
          />
          <Stepper label="Help dice" value={help} min={0} max={DICE_LIMIT} text={String(help)} onChange={setHelp} />
        </div>
      </details>
      {notEnoughHope ? <p className="cma-error">Not enough Hope for those Experiences.</p> : null}
      <button type="button" className="cm-go cma-go" disabled={!canAttack} aria-busy={attack.pending} onClick={() => void fire()}>
        {attack.pending ? "Rolling…" : picked.length === 0 ? "Pick a target to attack" : `⚔ Attack ${names.get(picked[0]!) ?? "target"}${chosen ? ` with ${chosen.weapon.name}` : ""}`}
      </button>
      <p aria-live="polite" className="cma-error">
        {attack.error}
      </p>
      {attack.pending ? (
        <p role="status" className="cma-rolling">
          The dice are rolling…
        </p>
      ) : last?.kind === "resolved" ? (
        <AttackResult result={last.result} names={last.names} weaponName={last.weaponName} />
      ) : last?.kind === "pending" ? (
        <p role="status" className="cma-waiting" data-testid="combat-attack-pending">
          Out of range ({last.outOfRange.map((o) => `${last.names.get(o.tokenId) ?? "target"}: ${BAND_LABEL[o.band]}`).join(", ")}). The attack waits for the GM;
          nothing is rolled until they allow it.
        </p>
      ) : null}
      <Requests campaignId={campaignId} characterId={characterId} pickFor={pickFor} onPickFor={setPickFor} />
    </div>
  );
}

/** The character's open requests: attacks waiting for the GM (Q1) and Minion offers to pick (Q6). */
function Requests({ campaignId, characterId, pickFor, onPickFor }: { campaignId: Id<"campaigns">; characterId: Id<"characters">; pickFor: Id<"combatRequests"> | null; onPickFor: (id: Id<"combatRequests"> | null) => void }) {
  const rows = useQuery(api.combatRequests.mine, { campaignId });
  if (!rows) return null;
  const mine = rows.filter((r) => r.characterId === characterId);
  if (mine.length === 0) return null;
  return (
    <ul className="cma-requests" aria-label="Waiting">
      {mine.map((r) =>
        r.kind === "sanction" ? (
          <li key={r.requestId} className="cma-request" data-testid="combat-sanction-waiting">
            Waiting for the GM: {r.targets.map((t) => t.name).join(", ")} ({r.outOfRange.map((o) => BAND_LABEL[o.band]).join(", ")})
          </li>
        ) : (
          <li key={r.requestId} className="cma-request">
            <span>
              Your hit can defeat {r.extra} more Minion{r.extra === 1 ? "" : "s"}.
            </span>
            <button type="button" className="cm-btn cm-sm" onClick={() => onPickFor(r.requestId)}>
              Pick Minions
            </button>
            <MinionDialog campaignId={campaignId} offer={r} open={pickFor === r.requestId} onClose={() => onPickFor(null)} />
          </li>
        ),
      )}
    </ul>
  );
}

/** Q6 (CB p.201): the attacker chooses which Minions within range their damage defeats, up to `extra`. */
function MinionDialog({ campaignId, offer, open, onClose }: { campaignId: Id<"campaigns">; offer: MinionOfferRow; open: boolean; onClose: () => void }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pick = useMutation(api.combatActions.pickMinions).withOptimisticUpdate((store) => {
    const rows = store.getQuery(api.combatRequests.mine, { campaignId });
    if (rows !== undefined) store.setQuery(api.combatRequests.mine, { campaignId }, rows.filter((r) => r.requestId !== offer.requestId));
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  async function send(instanceIds: Id<"encounterAdversaries">[]) {
    setPending(true);
    setError(null);
    try {
      await pick({ campaignId, entryId: offer.entryId, instanceIds, idempotencyKey: crypto.randomUUID() });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Pick Minions">
      <p className="m-0">
        Your damage defeats up to {offer.extra} more Minion{offer.extra === 1 ? "" : "s"} within range. Choose which.
      </p>
      <ul className="cma-minions">
        {offer.candidates.map((c) => {
          const n = counts[c.instanceId] ?? 0;
          return (
            <li key={c.instanceId}>
              <Stepper
                label={c.name}
                value={n}
                min={0}
                max={Math.min(c.available, n + offer.extra - total)}
                text={String(n)}
                onChange={(v) => setCounts((all) => ({ ...all, [c.instanceId]: v }))}
              />
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="cma-error">
        {error}
      </p>
      <div className="cma-row">
        <button type="button" className="cm-btn" disabled={pending} onClick={() => void send([])}>
          Skip
        </button>
        <button
          type="button"
          className="cm-go"
          disabled={pending || total === 0}
          onClick={() => void send(offer.candidates.flatMap((c) => Array.from({ length: counts[c.instanceId] ?? 0 }, () => c.instanceId)))}
        >
          {pending ? "Defeating…" : `Defeat ${total}`}
        </button>
      </div>
    </Modal>
  );
}
