"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useId, useState, type ReactNode } from "react";

import { OUTCOME_LABEL } from "@/lib/domain/dice";
import { TRAIT_LABEL } from "@/lib/frames/extras/common";
import { TRAIT_IDS, type TraitId } from "@/lib/srd/types";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * The GM's Contest (plan rule-switches OP2; optional rule "Conflict between PCs", CB p.168: "On any other kind of action
 * roll, the instigator makes an action roll and the target makes a reaction roll. To succeed, the instigator must beat a
 * Difficulty equal to the total value of the reaction roll."). The dock's Contest button opens this pop-over body: the
 * instigator and the target (the PCs on the map, `combatHud.party`), a trait and a modifier for each; Roll calls
 * `combatActions.contest`, which rolls both on the server, and the result shows both rolls and the success. The button
 * shows only while the rule is on and the caller may edit the campaign as its GM (`useContestAllowed`).
 */

type ContestResult = FunctionReturnType<typeof api.combatActions.contest>;
type Party = FunctionReturnType<typeof api.combatHud.party>;

/** Whether the dock offers the Contest: the rule is on (`ruleSettings.get`) and the caller is the GM or a co-GM. */
export function useContestAllowed(campaignId: Id<"campaigns">): boolean {
  const rules = useQuery(api.ruleSettings.get, { campaignId });
  return rules?.modes.pcConflict === true && rules.canEdit;
}

type Side = { characterId: Id<"characters"> | null; trait: TraitId; modifier: number };

/** A modifier typed in the box: a whole number between -20 and 20 (anything else reads as 0). */
export function parseModifier(text: string): number {
  const n = Number(text);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-20, Math.min(20, Math.trunc(n)));
}

/** The pickable character of a side: its own pick while still on the map, else the first PC not on the other side. */
export function sideCharacter(party: Pick<Party[number], "characterId">[], picked: Id<"characters"> | null, other: Id<"characters"> | null): Id<"characters"> | null {
  if (picked !== null && party.some((p) => p.characterId === picked)) return picked;
  return party.find((p) => p.characterId !== other)?.characterId ?? null;
}

/** "Ash: 15 vs 12, success with Hope": one line of the result. */
export function contestLine(name: string, roll: ContestResult["action"]["roll"], difficulty?: number): string {
  const vs = difficulty === undefined ? "" : ` vs ${difficulty}`;
  const outcome = difficulty === undefined ? "" : OUTCOME_LABEL[roll.outcome] ? `, ${OUTCOME_LABEL[roll.outcome]}` : "";
  return `${name}: ${roll.total}${vs}${outcome}`;
}

export function ContestPanel({ campaignId, mapId }: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps"> }): ReactNode {
  const party = useQuery(api.combatHud.party, { campaignId, mapId });
  const { fire, pending, error } = useIntent(api.combatActions.contest);
  const [by, setBy] = useState<Side>({ characterId: null, trait: "presence", modifier: 0 });
  const [against, setAgainst] = useState<Side>({ characterId: null, trait: "instinct", modifier: 0 });
  const [result, setResult] = useState<ContestResult | null>(null);

  if (party === undefined) return <p className="hud-muted">Loading the party…</p>;
  if (party.length < 2) return <p className="hud-muted">A Contest needs two PCs on the map.</p>;

  // Derived, not copied into state: a pick that left the map falls back to the first other PC.
  const instigator = sideCharacter(party, by.characterId, against.characterId);
  const target = sideCharacter(party, against.characterId, instigator);
  const nameOf = (id: Id<"characters"> | null) => party.find((p) => p.characterId === id)?.name ?? "?";
  const ready = instigator !== null && target !== null && instigator !== target && !pending;

  async function roll() {
    if (instigator === null || target === null) return;
    setResult(null);
    const r = await fire({
      campaignId,
      instigator: { characterId: instigator, trait: by.trait, modifier: by.modifier },
      target: { characterId: target, trait: against.trait, modifier: against.modifier },
    });
    if (r) setResult(r);
  }

  return (
    <form
      className="hud-contest"
      data-testid="hud-contest"
      onSubmit={(e) => {
        e.preventDefault();
        void roll();
      }}
    >
      <p className="hud-muted">The target&apos;s reaction roll sets the Difficulty; the instigator&apos;s action roll must meet it (CB p.168).</p>
      <SideFields legend="Instigator (action roll)" party={party} characterId={instigator} side={by} onChange={setBy} testId="hud-contest-instigator" />
      <SideFields legend="Target (reaction roll)" party={party} characterId={target} side={against} onChange={setAgainst} testId="hud-contest-target" />
      {instigator !== null && instigator === target ? <p className="hud-scene-err">Pick two different PCs.</p> : null}
      <button type="submit" className="hud-contest-go" disabled={!ready} data-testid="hud-contest-roll">
        {pending ? "Rolling…" : "Roll the Contest"}
      </button>
      <div aria-live="polite" className="hud-contest-out">
        {error ? <p className="hud-scene-err">{error}</p> : null}
        {result ? (
          <div data-testid="hud-contest-result">
            <p className={result.success ? "hud-contest-win" : "hud-contest-lose"}>
              <strong>{result.success ? `${nameOf(instigator)} succeeds` : `${nameOf(instigator)} fails`}</strong>
            </p>
            <ul className="hud-contest-rolls">
              <li>Reaction · {contestLine(nameOf(target), result.reaction.roll)}</li>
              <li>Action · {contestLine(nameOf(instigator), result.action.roll, result.difficulty)}</li>
            </ul>
          </div>
        ) : null}
      </div>
    </form>
  );
}

function SideFields({
  legend,
  party,
  characterId,
  side,
  onChange,
  testId,
}: {
  legend: string;
  party: Party;
  characterId: Id<"characters"> | null;
  side: Side;
  onChange: (next: Side) => void;
  testId: string;
}) {
  const id = useId();
  return (
    <fieldset className="hud-contest-side" data-testid={testId}>
      <legend>{legend}</legend>
      <label htmlFor={`${id}-pc`}>Character</label>
      <select id={`${id}-pc`} value={characterId ?? ""} onChange={(e) => onChange({ ...side, characterId: e.target.value as Id<"characters"> })}>
        {party.map((p) => (
          <option key={p.characterId} value={p.characterId}>
            {p.name}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-trait`}>Trait</label>
      <select id={`${id}-trait`} value={side.trait} onChange={(e) => onChange({ ...side, trait: e.target.value as TraitId })}>
        {TRAIT_IDS.map((t) => (
          <option key={t} value={t}>
            {TRAIT_LABEL[t]}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-mod`}>Modifier</label>
      <input id={`${id}-mod`} type="number" inputMode="numeric" step={1} min={-20} max={20} value={side.modifier} onChange={(e) => onChange({ ...side, modifier: parseModifier(e.target.value) })} />
    </fieldset>
  );
}
