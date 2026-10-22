"use client";

import "./hand.css";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { cardEffect } from "@/lib/srd/card-effects";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ActionsPanelProps, ResolutionsProps } from "../../slots";
import { useTokens, type TokenView } from "../../tokens/use-tokens";
import { usePanelMemory } from "../attack/memory";
import { BAND_LABEL } from "../targets";
import { seenTargets, useActor, useCombatTargets } from "../targets/state";
import { AfterRollDialog, UseDialog } from "./dialog";
import { HandCardFace } from "./face";
import { formFor, LOADOUT_MAX, needsDialog, playableUses, recallLabel, type Creature, type HandCard, type UseOutcome } from "./model";
import { CardResult, type LastCard } from "./result";
import { useCardActions, useRecall, type UseRequest } from "./use-card";

/**
 * The Hand on the Combat Map (plan combat-actions CA6). Players: their loadout from `combatCards.hand` with card art,
 * cost and limit badges, Use on every combat card (a dialog first only when the card needs a choice), exhausted cards
 * greyed and turned with their reset label, passive cards without a button, and the vault with Recall (R6, R7, Q3).
 * The GM (user answer 2026-10-22): selecting a PC token shows that character's Hand greyed with no Use / Recall until
 * the GM turns on "Play for this character"; then both work and are logged with the GM as actor for that character.
 * A player only ever sees their own character's cards. No enemy numbers anywhere (U1).
 */

// ---------------------------------------------------------------- creatures

/** The player's creatures: their own token, the other PCs, and every other token their character sees (R4). */
function playerCreatures(view: NonNullable<ReturnType<typeof useActor>>["view"]): Creature[] {
  const out: Creature[] = [{ tokenId: view.tokenId, name: "You", side: "self" }];
  for (const pc of view.pcs) if (pc._id !== view.tokenId) out.push({ tokenId: pc._id, name: pc.name, side: "pc" });
  for (const t of view.others) out.push({ tokenId: t._id, name: t.name, side: t.side === "pc" ? "pc" : t.side });
  return out;
}

/** The GM's creatures for a character: its token is "self", every other token by its side. */
function gmCreatures(tokens: readonly TokenView[], characterId: Id<"characters">): Creature[] {
  return tokens.map((t) => ({ tokenId: t._id, name: t.name, side: t.characterId === characterId ? "self" : t.side }));
}

// ---------------------------------------------------------------- the hand

export type BodyProps = {
  campaignId: Id<"campaigns">;
  mapId: Id<"combatMaps">;
  characterId: Id<"characters">;
  creatures: readonly Creature[];
  /** Enemies already picked on the map (players: CA5's targets the character sees). */
  pickedEnemies: readonly Id<"combatTokens">[];
  gm: boolean;
  /** False while the GM has not turned on "Play for this character": greyed, no Use / Recall. */
  canPlay: boolean;
};

export function HandBody({ campaignId, mapId, characterId, creatures, pickedEnemies, gm, canPlay }: BodyProps) {
  const hand = useQuery(api.combatCards.hand, { campaignId, characterId });
  const rests = useQuery(api.rests.current, { campaignId });
  const actions = useCardActions({ campaignId, mapId, characterId });
  const recall = useRecall({ campaignId, characterId });
  const [dialogFor, setDialogFor] = useState<string | null>(null);
  const [last, setLast] = usePanelMemory<LastCard | null>(`card:${characterId}`, null);
  const names = new Map<string, string>(creatures.map((c) => [c.tokenId, c.side === "self" ? "You" : c.name]));
  const restOpen = Boolean(rests?.open);
  const vaultId = useId();

  if (hand === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading the hand…
      </p>
    );
  }

  function settle(card: HandCard, out: UseOutcome | undefined) {
    if (!out || out.status === "needsChoice") return;
    setDialogFor(null);
    setLast(out.status === "resolved" ? { kind: "resolved", cardName: card.name, result: out, names, done: [] } : { kind: "pending", cardName: card.name, outOfRange: out.outOfRange, names });
  }

  async function submit(card: HandCard, request: UseRequest) {
    settle(card, await actions.submit(request));
  }

  function use(card: HandCard) {
    actions.clearError();
    const uses = playableUses(card).filter((u) => u.ready);
    const effect = cardEffect(card.cardId);
    const first = uses[0];
    const effectUse = first ? effect?.uses.find((u) => u.id === first.useId) : undefined;
    if (!first || !effectUse) return;
    const form = formFor(effectUse);
    if (needsDialog(form, { spells: playableUses(card).length, pickedEnemies: pickedEnemies.length, gm })) {
      setDialogFor(card.cardId);
      return;
    }
    const targets = form.targets ? pickedEnemies.slice(-1) : [];
    void submit(card, { cardId: card.cardId, spell: first.useId, targetTokenIds: [...targets], choices: [] });
  }

  const dialogCard = hand.loadout.find((c) => c.cardId === dialogFor);
  const waitingCard = actions.waiting ? hand.loadout.find((c) => c.cardId === actions.waiting?.request.cardId) : undefined;
  const full = hand.loadout.length >= LOADOUT_MAX;

  return (
    <div className="cmh-body">
      {hand.loadout.length === 0 ? (
        <p className="cm-muted cma-note">No cards in the loadout.</p>
      ) : (
        <ul className="cmh-strip" aria-label="Loadout" data-testid="combat-hand-loadout">
          {hand.loadout.map((card) => {
            const playable = playableUses(card);
            const ready = card.state === "ready" && playable.some((u) => u.ready);
            return (
              <li key={card.cardId} className="cmh-slot">
                <HandCardFace card={card} locked={!canPlay}>
                  {!canPlay ? null : card.state === "exhausted" ? (
                    <span className="cmh-status">Used</span>
                  ) : playable.length > 0 ? (
                    <button
                      type="button"
                      className="cmh-use"
                      disabled={!ready || actions.pending}
                      aria-label={`Use ${card.name}`}
                      aria-busy={actions.pending && dialogFor === null}
                      onClick={() => use(card)}
                    >
                      Use
                    </button>
                  ) : null}
                </HandCardFace>
              </li>
            );
          })}
        </ul>
      )}
      {!canPlay ? (
        <p className="cm-muted cma-note">Turn on “Play for this character” to use or recall these cards.</p>
      ) : null}
      <p aria-live="polite" className="cma-error">
        {dialogFor === null && !actions.waiting ? actions.error : ""}
      </p>
      {actions.pending && dialogFor === null ? (
        <p role="status" className="cma-rolling">
          The card is in play…
        </p>
      ) : last ? (
        <CardResult last={last} onDone={(i) => last.kind === "resolved" && setLast({ ...last, done: [...last.done, i] })} />
      ) : null}
      <CardsWaiting campaignId={campaignId} characterId={characterId} names={names} />
      <section className="cmh-vault" aria-labelledby={vaultId}>
        <h3 id={vaultId} className="cm-lbl">
          Vault ({hand.vault.length})
        </h3>
        {hand.vault.length === 0 ? (
          <p className="cm-muted cma-small cma-note">The vault is empty.</p>
        ) : (
          <ul className="cmh-strip" aria-label="Vault" data-testid="combat-hand-vault">
            {hand.vault.map((card) => (
              <li key={card.cardId} className="cmh-slot">
                <HandCardFace card={card} locked={!canPlay}>
                  {canPlay ? (
                    <button
                      type="button"
                      className="cmh-use cmh-recall"
                      disabled={full || recall.pending !== null}
                      aria-label={`${recallLabel(card.recallCost, restOpen)}, ${card.name}`}
                      title={full ? "The loadout holds 5 cards: vault one first." : undefined}
                      onClick={() => void recall.recall(card.cardId, restOpen)}
                    >
                      {recallLabel(card.recallCost, restOpen)}
                    </button>
                  ) : (
                    <span className="cmh-status">{recallLabel(card.recallCost, restOpen)}</span>
                  )}
                </HandCardFace>
              </li>
            ))}
          </ul>
        )}
        {canPlay && full && hand.vault.length > 0 ? <p className="cm-muted cma-small cma-note">The loadout holds 5 cards: vault one on the sheet first.</p> : null}
        <p aria-live="polite" className="cma-error">
          {recall.error}
        </p>
      </section>
      {dialogCard ? (
        <UseDialog
          key={dialogCard.cardId}
          card={dialogCard}
          uses={playableUses(dialogCard)}
          effectUses={cardEffect(dialogCard.cardId)?.uses ?? []}
          creatures={creatures}
          pickedEnemies={pickedEnemies}
          gm={gm}
          open
          pending={actions.pending}
          error={actions.waiting ? null : actions.error}
          onClose={() => setDialogFor(null)}
          onSubmit={(request) => void submit(dialogCard, request)}
        />
      ) : null}
      {actions.waiting && waitingCard ? (
        <AfterRollDialog
          cardName={waitingCard.name}
          asks={actions.waiting.asks}
          names={names}
          pending={actions.pending}
          error={actions.error}
          onCancel={() => actions.cancelWaiting()}
          onAnswer={(choices) => void actions.answer(choices).then((out) => settle(waitingCard, out))}
        />
      ) : null}
    </div>
  );
}

/** The character's card uses waiting for the GM (Q1): names and bands only. */
function CardsWaiting({ campaignId, characterId, names }: { campaignId: Id<"campaigns">; characterId: Id<"characters">; names: ReadonlyMap<string, string> }) {
  const rows = useQuery(api.combatCards.pending, { campaignId });
  const mine = (rows ?? []).filter((r) => r.characterId === characterId);
  if (mine.length === 0) return null;
  return (
    <ul className="cma-requests" aria-label="Cards waiting for the GM">
      {mine.map((r) => (
        <li key={r.requestId} className="cma-request" data-testid="combat-card-waiting">
          Waiting for the GM: {r.cardName} → {r.targets.map((t) => names.get(t.tokenId) ?? t.name).join(", ")} ({r.outOfRange.map((o) => BAND_LABEL[o.band]).join(", ")})
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- players

/** Player column, first: the player's own Hand. Renders nothing without their character's token on the live map. */
export function Hand(props: ActionsPanelProps) {
  const actor = useActor(props);
  const { targetTokenIds } = useCombatTargets();
  if (!actor) return null;
  return (
    <section className="cm-card cma-card cmh-card" aria-label="Your hand">
      <h2 className="cm-h">Hand</h2>
      <HandBody
        campaignId={props.campaignId}
        mapId={props.map._id}
        characterId={actor.characterId}
        creatures={playerCreatures(actor.view)}
        pickedEnemies={seenTargets(targetTokenIds, actor.enemies)}
        gm={false}
        canPlay
      />
    </section>
  );
}

// ---------------------------------------------------------------- the GM

/**
 * GM column: the Hand of the PC whose token the GM selected (it stays while the GM picks other tokens, until closed),
 * and the card uses waiting for the GM's call (Q1).
 */
export function GmHand(props: ResolutionsProps) {
  if (props.role !== "gm" || props.mode !== "play") return null;
  return <GmHandFor {...props} />;
}

function GmHandFor(props: ResolutionsProps) {
  const { campaignId, map, selectedTokenId } = props;
  const tokens = useTokens(campaignId, "gm", map._id);
  const [held, setHeld] = useState<Id<"characters"> | null>(null);
  const [seenSelection, setSeenSelection] = useState<Id<"combatTokens"> | null>(null);
  const [playingFor, setPlayingFor] = useState<Id<"characters"> | null>(null);
  const switchId = useId();

  // A newly selected PC token opens its Hand (adjusting state during render, not in an effect: rule 13).
  const selectedPc = tokens?.find((t) => t._id === selectedTokenId && t.characterId !== undefined)?.characterId ?? null;
  if (tokens !== undefined && selectedTokenId !== seenSelection) {
    setSeenSelection(selectedTokenId);
    if (selectedPc !== null && selectedPc !== held) {
      setHeld(selectedPc);
      setPlayingFor(null);
    }
  }

  const token = held ? tokens?.find((t) => t.characterId === held) : undefined;
  return (
    <>
      <GmCardSanctions campaignId={campaignId} />
      {held && tokens && token ? (
        <section className="cm-card cma-card cmh-card" aria-label={`Hand of ${token.name}`} data-testid="combat-gm-hand">
          <div className="cma-row">
            <h2 className="cm-h">Hand · {token.name}</h2>
            <button type="button" className="cm-btn cm-sm" aria-label={`Close the hand of ${token.name}`} onClick={() => setHeld(null)}>
              ✕
            </button>
          </div>
          <label className="cmh-switch" htmlFor={switchId}>
            <input
              id={switchId}
              type="checkbox"
              role="switch"
              checked={playingFor === held}
              onChange={(e) => setPlayingFor(e.target.checked ? held : null)}
            />
            <span className="cmh-switch-track" aria-hidden="true" />
            <span>Play for this character</span>
          </label>
          <HandBody
            campaignId={campaignId}
            mapId={map._id}
            characterId={held}
            creatures={gmCreatures(tokens, held)}
            pickedEnemies={[]}
            gm
            canPlay={playingFor === held}
          />
        </section>
      ) : null}
    </>
  );
}

/** The card uses out of range waiting for the GM (Q1): Allow runs the stored use, Decline drops it. */
function GmCardSanctions({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const rows = useQuery(api.combatCards.pending, { campaignId });
  const sanction = useMutation(api.combatCards.sanction).withOptimisticUpdate((store, { requestId }) => {
    const current = store.getQuery(api.combatCards.pending, { campaignId });
    if (current !== undefined) store.setQuery(api.combatCards.pending, { campaignId }, current.filter((r) => r.requestId !== requestId));
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!rows || (rows.length === 0 && !error)) return null;

  async function answer(requestId: Id<"combatRequests">, approve: boolean) {
    setError(null);
    setPending(true);
    try {
      const out = await sanction({ campaignId, requestId, approve, idempotencyKey: crypto.randomUUID() });
      if (out.status === "needsChoice") setError("The card needs a choice: decline it and ask the player to use it again.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="cm-card cma-card" aria-label="Cards waiting for you">
      <h2 className="cm-h">Cards: your call</h2>
      <ul className="cma-res-list">
        {rows.map((r) => {
          const bands = new Map<string, string>(r.outOfRange.map((o) => [o.tokenId, BAND_LABEL[o.band]]));
          const text = `${r.characterName} uses ${r.cardName} on ${r.targets.map((t) => (bands.has(t.tokenId) ? `${t.name} (${bands.get(t.tokenId)})` : t.name)).join(", ")}`;
          return (
            <li key={r.requestId} className="cma-res" data-testid="combat-card-sanction">
              <span className="cma-res-text">{text}</span>
              <span className="cma-row">
                <button type="button" className="cm-btn cm-sm" disabled={pending} aria-label={`Allow: ${text}`} onClick={() => void answer(r.requestId, true)}>
                  Allow
                </button>
                <button type="button" className="cm-btn cm-sm cm-danger" disabled={pending} aria-label={`Decline: ${text}`} onClick={() => void answer(r.requestId, false)}>
                  Decline
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="cma-error">
        {error}
      </p>
    </section>
  );
}
