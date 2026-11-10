"use client";

import "./result.css";

import { useQuery } from "convex/react";
import { useEffect, useMemo, type ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { AttackOutcome } from "../../actions/attack";
import { useActor } from "../../actions/targets";
import { usePick } from "../pick";
import { conditionName } from "../pick/model";
import type { HudPartProps } from "../state";
import { Popup } from "../ui";
import { AsksPanel } from "./asks";
import { HeldRoll, RiderAsk, type RiderRow } from "./held";
import { attackResultView, cardResultView, featureResultView, playerResultView, weaponDamageType } from "./model";
import { ResultPanel } from "./panel";
import { hudResults, useHudResultEntry, type AsksEntry } from "./store";

/**
 * The result panel (plan combat-hud H4.1; boards Main 'Card result', CmpPromptsPlayer 'Your roll waits', CmpPicking
 * 'After the roll'), mounted by the shell in the pop region. One panel at a time, at the board's spot (Main `.res`:
 * left 820, 250 px above the bottom; it moves left with the sheet panel through `--hud-pop-res-left`), a bottom sheet
 * on a phone:
 *
 * 1. "Your roll waits" (players): an attack held for an after-roll feature (`combatRequestsReads.mine` `afterRoll`): the
 *    dice, Hit / Miss per target, the features as radio rows with their costs, Pass / "Use and roll damage";
 * 2. "After the roll": a card use's after-the-roll asks the HUD hand handed over (`hudResults.ask`): damage split
 *    steppers with "n left", each ally's pick with "n of m chose", plain choices;
 * 3. the result (`hudResults.show`): a card's (the HUD hand) or an attack's (the attack picker, the held roll's answer),
 *    with a damage-phase rider's ask under it (`riderPick`, Death Strike), which also shows on its own. The GM's HUD
 *    also shows each player's result as it lands (`usePlayerResults`, dcm-uemx), with severity and HP per hit.
 *
 * Nothing shows while a picking session is open (the panel there is the one thing to answer). Players see only their
 * own dice and damage, and Hit / Miss / Defeated (HANDOFF hard rule 2): the server sends nothing else.
 *
 * Senders: `showCardResult`, `showAttackOutcome` and `hudResults.ask` (below and store.ts).
 */

export function HudResult({ state }: HudPartProps): ReactNode {
  const pick = usePick();
  const entry = useHudResultEntry();
  const actor = useActor(state);
  const { campaignId } = state;
  const player = state.role === "player" && state.map !== null && actor !== null;
  const mine = useQuery(api.combatRequestsReads.mine, player ? { campaignId } : "skip");
  usePlayerResults(campaignId, state.role === "gm");
  // dcm-uemx: the GM's panel adds severity and HP per adversary hit (a GM-only query; players never ask, U1).
  const resultId = entry?.kind === "result" ? entry.view.id : null;
  const gmRows = useQuery(api.combatHud.resultDamage, state.role === "gm" && resultId !== null ? { campaignId, entryId: resultId as Id<"actionLog"> } : "skip");
  const gmDamage = useMemo(() => (gmRows ? new Map(gmRows.map((d) => [d.tokenId as string, d])) : undefined), [gmRows]);
  if (pick.session) return null;

  const own = (mine ?? []).filter((r) => r.characterId === actor?.characterId);
  const held = own.find((r) => r.kind === "afterRoll");
  const riders = own.filter((r): r is RiderRow => r.kind === "riderPick");

  if (held && held.kind === "afterRoll") return <HeldRoll key={held.requestId} campaignId={campaignId} row={held} />;
  if (entry?.kind === "asks") return <AsksPanel key={entry.id} entry={entry} />;

  const asks = riders.map((r) => <RiderAsk key={r.requestId} campaignId={campaignId} row={r} />);
  if (entry?.kind === "result") {
    const conditions = conditionsOf(actor?.view ?? null);
    return (
      <div className="hud-res-spot">
        <ResultPanel
          view={entry.view}
          done={entry.done}
          conditions={(id) => conditions.get(id) ?? []}
          gmDamage={gmDamage}
          onDone={(i) => hudResults.markDone(entry.view.id, i)}
          onClose={() => hudResults.clear(entry.view.id)}
        >
          {asks}
        </ResultPanel>
      </div>
    );
  }
  if (asks.length > 0) {
    return (
      <div className="hud-res-spot" data-testid="hud-result-riders">
        <Popup icon={STAR_ICON} title="After your hit" sub={riders[0]?.characterName}>
          {asks}
        </Popup>
      </div>
    );
  }
  return null;
}

/**
 * dcm-uemx (user 2026-11-09 "the GM sees every player's result"): the GM's HUD shows each player's card use, weapon attack
 * and feature use result as the same panel (`combatHud.playerResults`, GM only), the newest new one at a time; a closed one
 * never comes back (`hudResults.fromFeed` keeps the seen ids). Players never ask: other players' results stay theirs.
 * The effect only hands the list to the client store (no mutation), as the queue's withdrawal toasts do.
 */
function usePlayerResults(campaignId: Id<"campaigns">, gm: boolean): void {
  const rows = useQuery(api.combatHud.playerResults, gm ? { campaignId } : "skip");
  useEffect(() => {
    if (rows === undefined) return;
    hudResults.fromFeed(campaignId, rows.map(playerResultView));
  }, [rows, campaignId]);
}

const STAR_ICON = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M8 1l1.8 4.6L14.5 6l-3.6 3 1.1 4.7L8 11.3 4 13.7l1.1-4.7L1.5 6l4.7-.4z" />
  </svg>
);

type View = NonNullable<ReturnType<typeof useActor>>["view"];

/** Condition names per token from the player's own view (names only, answer 10a). */
function conditionsOf(view: View | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!view) return out;
  for (const pc of view.pcs) out.set(pc._id, (pc.stats?.conditions ?? []).map(conditionName));
  for (const t of view.others) out.set(t._id, (t.conditions ?? []).map((c) => c.label));
  return out;
}

// ---------------------------------------------------------------- senders

/** A resolved card use (the HUD hand): shows its result. */
export function showCardResult(input: Parameters<typeof cardResultView>[0]): void {
  hudResults.show(cardResultView(input));
}

/** A resolved feature use (the picking panel, dcm-bxp.99.32.26): shows its result. */
export function showFeatureResult(input: Parameters<typeof featureResultView>[0]): void {
  hudResults.show(featureResultView(input));
}

/**
 * What `combatActions.attack` answered (the attack picker): a resolved attack shows its result; a held one ("awaiting")
 * is remembered by weapon so "Your roll waits" (from the server's request) can name it once answered; pending shows
 * nothing here ("Waiting for the GM", H3.0).
 */
export function showAttackOutcome(input: {
  characterId: string;
  actorName: string;
  weapon: { name: string; damage: string } | null;
  names: ReadonlyMap<string, string>;
  out: AttackOutcome;
}): void {
  const { out, weapon } = input;
  const weaponName = weapon?.name ?? "Attack";
  const damageType = weapon ? weaponDamageType(weapon.damage) : null;
  if (out.status === "resolved") {
    hudResults.show(attackResultView({ characterId: input.characterId, actorName: input.actorName, weaponName, damageType, result: out, names: input.names }));
  } else if (out.status === "awaiting") {
    hudResults.clear();
    hudResults.noteHeld(out.requestId, { weaponName, damageType, actorName: input.actorName });
  }
}

/** A card use's after-the-roll asks (the HUD hand): the panel asks them and calls `answer`. */
export function askAfterRoll(input: Omit<AsksEntry, "kind" | "id">): void {
  hudResults.ask({ ...input, id: crypto.randomUUID() });
}

export { hudResults, useHudResultEntry, type AsksEntry, type HudResultEntry } from "./store";
export { attackResultView, cardResultView, featureResultView, withAnswers, type ResultView } from "./model";
