"use client";

import "@/components/party/dice/dice.css";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { Modal } from "@/components/brand/modal";
import { DiceTiles } from "@/components/party/dice/parts";
import { derivedTraits } from "@/lib/domain/characters/derived";
import { withEffects } from "@/lib/domain/characters/effects";
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
import { NO_ROLL_OPTIONS, rollProblem, RollOptions, signed, Stepper, type Roller, type RollValues } from "../roll-controls";
import { usePanelMemory } from "./memory";
import { extraTargets, offersSpiritWeapon, picksTrait, sheetMods } from "./mods";
import { AfterRollPrompt, riderProblem, RiderPickPrompt, RiderToggles, ridersToSend, riseToSend, type HeldRoll, type RiderPicks } from "./riders";

/**
 * The Attack bar (plan combat-actions CA5): the primary and secondary weapon with damage at Proficiency, the duality
 * options of the sheet's dice box (Experiences, advantage, help), and `combatActions.attack` against the picked
 * targets, once per click with a "Rolling…" state (rule 12). The result shows the player's own dice, the damage total
 * and Hit / Miss / Defeated per target, never an enemy's numbers (U1, Q5). A Minion offer opens the pick dialog (Q6);
 * an out-of-range attack waits for the GM (Q1).
 *
 * Plan sheet-drawer SD5: the riders of the character's cards and features that ride on the weapon's attack are toggles
 * above the Attack button (`combatActions.riders`); automatic ones apply on the server. An attack held for an after-roll
 * feature (Q1) shows its roll with Use / Pass; the GM sees Resolve now on the character's held attacks.
 */

export type AttackOutcome = FunctionReturnType<typeof api.combatActions.attack>;
export type ResolvedAttack = Extract<AttackOutcome, { status: "resolved" }>;
type MineRow = FunctionReturnType<typeof api.combatRequests.mine>[number];
type MinionOfferRow = Extract<MineRow, { kind: "minionOffer" }>;

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
export function AttackResult({
  result,
  names,
  weaponName,
}: {
  result: Pick<ResolvedAttack, "roll" | "damage" | "targets" | "fearGained"> & Partial<Pick<ResolvedAttack, "riders" | "skipped" | "riderPrompts">>;
  names: ReadonlyMap<string, string>;
  weaponName: string;
}) {
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
      {result.riders && result.riders.length > 0 ? (
        <p className="cma-small cma-note" data-testid="combat-attack-riders">
          With: {result.riders.join(", ")}
        </p>
      ) : null}
      {result.skipped && result.skipped.length > 0 ? <p className="cm-muted cma-small cma-note">Not used (its moment didn&apos;t come): {result.skipped.join(", ")}</p> : null}
      {(result.riderPrompts ?? []).map((p, i) => (
        <p key={i} className="cma-small cma-note">
          {p.kind === "move" ? "Move: " : ""}
          {p.text}
        </p>
      ))}
      {result.fearGained > 0 ? <p className="cm-muted cma-small cma-note">Rolled with Fear: the GM gains a Fear.</p> : null}
    </section>
  );
}

type Last =
  | { kind: "resolved"; result: ResolvedAttack; names: Map<string, string>; weaponName: string }
  | { kind: "pending"; outOfRange: { tokenId: string; band: RangeBand }[]; names: Map<string, string> }
  | { kind: "awaiting"; held: HeldRoll; weaponName: string };

/** Player column: the Attack bar. Renders nothing for a character without a token on the live map. */
export function AttackBar(props: ActionsPanelProps) {
  const actor = useActor(props);
  if (!actor) return null;
  return <AttackForm {...props} characterId={actor.characterId} enemies={actor.enemies} allies={actor.view.others.filter((t) => t.side === "pc")} />;
}

type Named = { _id: Id<"combatTokens">; name: string };

function AttackForm({ campaignId, map, role, characterId, enemies, allies }: ActionsPanelProps & { characterId: Id<"characters">; enemies: readonly Named[]; allies: readonly Named[] }) {
  const character = useQuery(api.characters.get, { characterId });
  const { targetTokenIds, slot, setSlot } = useCombatTargets();
  const attack = useIntent(api.combatActions.attack);
  const [rollValues, setRollValues] = useState<RollValues>(NO_ROLL_OPTIONS);
  const { experienceIds, edge, help } = rollValues;
  const [trait, setTrait] = useState<TraitId>("strength");
  // dcm-xbtw (user answer 2026-10-31): "Use as Spirit Weapon", per attack; cleared after each attack.
  const [spiritWeapon, setSpiritWeapon] = useState(false);
  // Kept above the desktop / phone layout switch (user answer 2026-10-22), per character.
  const [last, setLast] = usePanelMemory<Last | null>(`attack:${characterId}`, null);
  const [pickFor, setPickFor] = useState<Id<"combatRequests"> | null>(null);
  const [riderPicks, setRiderPicks] = useState<RiderPicks>({});
  const riderList = useQuery(api.combatActions.riders, { campaignId, characterId, slot });
  // E1.4b (dcm-uxsd): a forced attack waiting on this character (Beguiled, HF p.75) opens the bar with its targets locked.
  const forcedRows = useQuery(api.combatRequests.forcedAttacks, { campaignId });
  const [forcedId, setForcedId] = useState<Id<"combatRequests"> | null>(null);
  // E1.4b (dcm-kso9; user answer 2026-11-01): a target's rider benefit (Lead by Example) is picked before rolling.
  const hints = useQuery(api.combatActions.targets, { campaignId, characterId, mapId: map._id, slot });
  const [benefitPick, setBenefitPick] = useState<string | null>(null);

  if (character === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading your weapons…
      </p>
    );
  }
  if (character === null) return null;
  const sheet = character.sheet;
  // Plan lanes E4 (dcm-bxp.99.19.64): the traits the roll uses, after effects and passive features (Beastform, CB p.30).
  const traits = derivedTraits(withEffects(sheet));
  const weapons = equippedWeapons(sheet);
  const chosen = weapons.find((w) => w.slot === slot) ?? weapons[0];
  // E1.3b (dcm-jkhp, dcm-xbtw): Versatile Fighter's trait pick, Parallela's extra target, the Spirit Weapon box.
  const mods = sheetMods(sheet);
  const traitPick = chosen !== undefined && (chosen.weapon.trait === "choice" || picksTrait(mods, chosen.slot));
  const spiritOffered = chosen !== undefined && offersSpiritWeapon(sheet, chosen.weapon);
  const spirit = spiritOffered && spiritWeapon;
  // A plain weapon attack targets one enemy (user answer 2026-10-22, CB p.96): the latest picks, one more per extra
  // target (Parallela, CB p.332; a ticked Spirit Weapon's extra adversary for a Stress, CB p.44).
  const most = 1 + extraTargets(mods) + (spirit ? 1 : 0);
  const waitingForced = (forcedRows ?? []).filter((r) => r.characterId === characterId);
  const forced = waitingForced.find((r) => r.requestId === forcedId) ?? null;
  const picked = forced !== null ? forced.targets.map((t) => t.tokenId) : seenTargets(targetTokenIds, enemies).slice(-most);
  const names = new Map<string, string>([...enemies, ...allies, ...(forced?.targets ?? []).map((t) => ({ _id: t.tokenId, name: t.name }))].map((t) => [t._id, t.name]));
  const roller: Roller = { experiences: sheet.experiences, hope: sheet.hope };
  const notEnoughHope = rollProblem(roller, rollValues);
  const riders = riderList ?? [];
  const riderMissing = riderProblem(riders, riderPicks);
  const others = enemies.filter((e) => !picked.includes(e._id));
  const benefits = (hints ?? []).filter((h) => picked.includes(h.tokenId)).flatMap((h) => h.benefits ?? []);
  const benefitOptions = benefits.flatMap((b) => b.options.map((o) => ({ ...o, from: b.label })));
  const benefit = benefitOptions.find((o) => o.id === benefitPick)?.id ?? benefitOptions[0]?.id;
  const canAttack = chosen !== undefined && picked.length > 0 && !attack.pending && !notEnoughHope && !riderMissing;

  async function fire() {
    if (!chosen) return;
    const weaponName = chosen.weapon.name;
    const out = await attack.fire({
      campaignId,
      characterId,
      mapId: map._id,
      targetTokenIds: picked,
      slot: chosen.slot,
      ...(traitPick ? { trait } : {}),
      ...(spirit ? { spiritWeapon: true } : {}),
      modifier: 0,
      experienceIds: [...experienceIds],
      advantage: Math.max(0, edge),
      disadvantage: Math.max(0, -edge),
      help,
      options: [],
      riders: ridersToSend(riders, riderPicks),
      ...(riseToSend(riders, riderPicks) === false ? { riseToTheChallenge: false } : {}),
      ...(forced !== null ? { forcedRequestId: forced.requestId } : {}),
      ...(benefit !== undefined ? { benefit } : {}),
    });
    if (!out) return;
    setForcedId(null);
    setBenefitPick(null);
    setRollValues((v) => ({ ...v, experienceIds: [] }));
    setRiderPicks({});
    setSpiritWeapon(false);
    if (out.status === "resolved") {
      setLast({ kind: "resolved", result: out, names, weaponName });
      if (out.minionOffer) setPickFor(out.minionOffer.requestId);
    } else if (out.status === "awaiting") {
      const held: HeldRoll = { requestId: out.requestId, roll: out.roll, targets: out.targets.map((t) => ({ ...t, name: names.get(t.tokenId) ?? "Target" })), options: out.options };
      setLast({ kind: "awaiting", held, weaponName });
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
      {traitPick ? (
        <label className="cma-field">
          <span className="cm-lbl">Trait</span>
          <select className="cm-in cma-select" value={trait} onChange={(e) => setTrait(e.target.value as TraitId)}>
            {TRAIT_IDS.map((t) => (
              <option key={t} value={t}>
                {TRAIT_LABEL[t]} {signed(traits[t])}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {spiritOffered ? (
        <label className="cma-field cma-check">
          <input type="checkbox" checked={spiritWeapon} onChange={(e) => setSpiritWeapon(e.target.checked)} data-testid="combat-attack-spirit-weapon" />
          <span>Use as Spirit Weapon (reach Close; mark a Stress for one more target)</span>
        </label>
      ) : null}
      {waitingForced.length > 0 && forced === null ? (
        <ul className="cma-requests" aria-label="Forced attacks">
          {waitingForced.map((r) => (
            <li key={r.requestId} className="cma-request" data-testid="combat-forced-attack">
              <span>
                {r.instanceLabel}&apos;s {r.feature}: you must attack {r.targets.map((t) => t.name).join(", ")}.
              </span>
              <button type="button" className="cm-btn cm-sm" onClick={() => setForcedId(r.requestId)} data-testid="combat-forced-attack-open">
                Make the attack
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {forced !== null ? (
        <p className="cma-small cma-note" role="status" data-testid="combat-forced-attack-locked">
          Forced by {forced.instanceLabel}&apos;s {forced.feature}: the target is locked ({forced.targets.map((t) => t.name).join(", ")}).{" "}
          <button type="button" className="cm-btn cm-sm" onClick={() => setForcedId(null)}>
            Not now
          </button>
        </p>
      ) : null}
      {most > 1 && forced === null ? <p className="cm-muted cma-small cma-note">Up to {most} targets with this attack.</p> : null}
      {benefitOptions.length > 0 ? (
        <fieldset className="cma-field" data-testid="combat-attack-benefit">
          <legend className="cm-lbl">{[...new Set(benefitOptions.map((o) => o.from))].join(", ")}: your benefit from this attack</legend>
          {benefitOptions.map((o) => (
            <label key={`${o.from}:${o.id}`} className="cma-check">
              <input type="radio" name={`benefit-${characterId}`} checked={benefit === o.id} onChange={() => setBenefitPick(o.id)} />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <RollOptions roller={roller} values={rollValues} onChange={(patch) => setRollValues((v) => ({ ...v, ...patch }))} />
      <RiderToggles options={riders} picks={riderPicks} onChange={setRiderPicks} enemies={others} allies={allies} />
      {notEnoughHope ? <p className="cma-error">{notEnoughHope}</p> : null}
      {riderMissing ? <p className="cma-error">{riderMissing}</p> : null}
      <button type="button" className="cm-go cma-go" disabled={!canAttack} aria-busy={attack.pending} onClick={() => void fire()}>
        {attack.pending ? "Rolling…" : picked.length === 0 ? "Pick a target to attack" : `⚔ Attack ${picked.map((id) => names.get(id) ?? "target").join(", ")}${chosen ? ` with ${chosen.weapon.name}` : ""}`}
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
      ) : last?.kind === "awaiting" ? (
        <AfterRollPrompt
          campaignId={campaignId}
          held={last.held}
          gm={role === "gm"}
          onDone={(r) => {
            if (r.status === "resolved") {
              setLast({ kind: "resolved", result: r, names, weaponName: last.weaponName });
              if (r.minionOffer) setPickFor(r.minionOffer.requestId);
            } else setLast(null);
          }}
        />
      ) : last?.kind === "pending" ? (
        <p role="status" className="cma-waiting" data-testid="combat-attack-pending">
          Out of range ({last.outOfRange.map((o) => `${last.names.get(o.tokenId) ?? "target"}: ${BAND_LABEL[o.band]}`).join(", ")}). The attack waits for the GM;
          nothing is rolled until they allow it.
        </p>
      ) : null}
      <Requests campaignId={campaignId} characterId={characterId} pickFor={pickFor} onPickFor={setPickFor} shown={last?.kind === "awaiting" ? last.held.requestId : null} gm={role === "gm"} />
    </div>
  );
}

/** The character's open requests: attacks waiting for the GM (Q1) and Minion offers to pick (Q6). */
function Requests({
  campaignId,
  characterId,
  pickFor,
  onPickFor,
  shown,
  gm,
}: {
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  pickFor: Id<"combatRequests"> | null;
  onPickFor: (id: Id<"combatRequests"> | null) => void;
  /** The held attack the bar already shows (not listed twice). */
  shown: Id<"combatRequests"> | null;
  /** The GM answers a held attack with Resolve now. */
  gm: boolean;
}) {
  const rows = useQuery(api.combatRequests.mine, { campaignId });
  if (!rows) return null;
  const mine = rows.filter((r) => r.characterId === characterId && r.requestId !== shown);
  if (mine.length === 0) return null;
  return (
    <ul className="cma-requests" aria-label="Waiting">
      {mine.map((r) =>
        r.kind === "afterRoll" ? (
          <li key={r.requestId} className="cma-request">
            <AfterRollPrompt campaignId={campaignId} held={r} gm={gm} />
          </li>
        ) : r.kind === "riderPick" ? (
          <li key={r.requestId} className="cma-request">
            <RiderPickPrompt campaignId={campaignId} view={r} />
          </li>
        ) : r.kind === "sanction" ? (
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
