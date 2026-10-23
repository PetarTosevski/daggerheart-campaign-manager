"use client";

import "./hand.css";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { cardEffect } from "@/lib/srd/card-effects";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useViewerFlag } from "../../map-view/use-viewer-flag";
import type { ActionsPanelProps, ResolutionsProps } from "../../slots";
import { useTokens, type TokenView } from "../../tokens/use-tokens";
import { HandSharingSwitch } from "../../settings/hand-sharing";
import { usePanelMemory } from "../attack/memory";
import { BAND_LABEL } from "../targets";
import { seenTargets, useActor, useCombatTargets } from "../targets/state";
import { AfterRollDialog, UseDialog } from "./dialog";
import { HandDock, HandFan, VaultDeck } from "./dock";
import { HandCardFace } from "./face";
import { NO_ROLL_OPTIONS, rollProblem, RollOptions, type Roller, type RollValues } from "../roll-controls";
import { aimsOnMap, formFor, LOADOUT_MAX, needsDialog, playableUses, recallLabel, rollOf, usedRollOptions, type Creature, type HandCard, type UseOutcome } from "./model";
import { CardResult, type LastCard } from "./result";
import { handShared, HideHandSwitch, useHandSharing } from "./sharing";
import { useCardActions, useRecall, type UseRequest } from "./use-card";

/**
 * The Hand on the Combat Map (plan combat-actions CA6). Players: their loadout from `combatCards.hand` with card art,
 * cost and limit badges, Use on every combat card (a dialog first only when the card needs a choice), exhausted cards
 * greyed and turned with their reset label, passive cards without a button, and the vault with Recall (R6, R7, Q3).
 * The GM (user answer 2026-10-22): selecting a PC token shows that character's Hand greyed with no Use / Recall until
 * the GM turns on "Play for this character"; then both work and are logged with the GM as actor for that character.
 * F7-H4 (dcm-bxp.99.24): a player who selects another player's token sees that character's Hand read only (no Use /
 * Recall) while the GM's switch "Players can see each other's cards" is on and its player has not hidden it; each
 * player can hide their own hand under it. The GM always sees every hand. No enemy numbers anywhere (U1).
 * F8-I1 (dcm-bxp.99.28, user answer 2026-10-23): the roll options (Experiences, advantage, Help) apply to the next card
 * that rolls; a rolling card with an enemy picked and nothing else to ask fires at once with them.
 * HF1 (plan hand-fan, dcm-bxp.99.30, user answers 2026-10-23): the Hand is the domains tab's fan docked along the
 * bottom of the map, "as if you are holding the cards like in a DCG duel". A slim bar above the fan holds the GM's
 * "Play for this character" switch, the roll options and a small vault deck at the right end; "Hide cards" leaves a
 * peek tab "Show cards (N)" with the card tops peeking, remembered per player in this browser. Hover, focus or a tap
 * raises a card at full size with More / Use; dragging a card onto the table plays it, and a card that still needs
 * its enemy then waits for a tap on one on the map. Use on the raised card stays the non-drag way (WCAG 2.5.7).
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
  /** False while the GM has not turned on "Play for this character", or for another player's hand: greyed, no Use / Recall. */
  canPlay: boolean;
  /** The line under a hand that can't be played (why, and how to play it). */
  lockedNote?: string;
  /** The region's name ("Your hand", "Hand of Mira") and the bar's title ("Hand", "Hand · Mira"). */
  label?: string;
  title?: string;
  testId?: string;
  /** Controls at the start of the bar, after the title (the GM's switch and ✕, "Your hand"). */
  barStart?: ReactNode;
  /** Shown in place of the cards (a hidden hand: why). */
  instead?: ReactNode;
};

const GM_LOCKED = "Turn on “Play for this character” to use or recall these cards.";

/** localStorage key of the "Hide cards" choice: per campaign and character, in this browser only (HF1). */
export const handHiddenKey = (campaignId: Id<"campaigns">, characterId: Id<"characters">) => `dh.combat.handHidden:${campaignId}:${characterId}`;

/**
 * The "Hide cards" choice: read from this browser's storage (shown when there is none, or it is blocked) and, once the
 * player picks, held for the visit too, so Hide works in a private window where nothing can be stored.
 */
function useHiddenChoice(key: string): [boolean, (on: boolean) => void] {
  const [stored, store] = useViewerFlag(key);
  const [picked, setPicked] = useState<{ key: string; on: boolean } | null>(null);
  return [
    picked?.key === key ? picked.on : stored,
    (on) => {
      setPicked({ key, on });
      store(on);
    },
  ];
}

export function HandBody({
  campaignId,
  mapId,
  characterId,
  creatures,
  pickedEnemies,
  gm,
  canPlay,
  lockedNote = GM_LOCKED,
  label = "Your hand",
  title = "Hand",
  testId,
  barStart,
  instead,
}: BodyProps) {
  const hand = useQuery(api.combatCards.hand, instead ? "skip" : { campaignId, characterId });
  const rests = useQuery(api.rests.current, { campaignId });
  // The acting character's Experiences and Hope for the roll options (the Attack bar's subscription).
  const character = useQuery(api.characters.get, canPlay ? { characterId } : "skip");
  const actions = useCardActions({ campaignId, mapId, characterId });
  const recall = useRecall({ campaignId, characterId });
  const { aim, setAim } = useCombatTargets();
  const [dialogFor, setDialogFor] = useState<string | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [last, setLast] = usePanelMemory<LastCard | null>(`card:${characterId}`, null);
  // F8-I1 (dcm-bxp.99.28): the roll options for the next card that rolls, kept across the layout switch.
  const [rollOptions, setRollOptions] = usePanelMemory<RollValues>(`rolls:${characterId}`, NO_ROLL_OPTIONS);
  // HF1: "Hide cards", remembered per player (campaign + character) in this browser; shown when storage is unavailable.
  const [hidden, setHidden] = useHiddenChoice(handHiddenKey(campaignId, characterId));
  const roller: Roller | null = character ? { experiences: character.sheet.experiences, hope: character.sheet.hope } : null;
  const rollBlock = rollProblem(roller, rollOptions);
  const names = new Map<string, string>(creatures.map((c) => [c.tokenId, c.side === "self" ? "You" : c.name]));
  const restOpen = Boolean(rests?.open);
  const ids = useId();
  const fanId = `${ids}-fan`;
  const vaultId = `${ids}-vault`;
  const tray = useRef<HTMLDivElement>(null);
  const aiming = aim?.characterId === characterId ? aim : null;

  // The card waiting for its target on the map fires with the newest state (roll options set while it waited).
  // The provider calls this from the map click's handler; the ref only follows the latest render (rule 13).
  const fireAimed = useRef<(cardId: string, tokenId: Id<"combatTokens">) => void>(() => {});
  useLayoutEffect(() => {
    fireAimed.current = (cardId, tokenId) => {
      const card = hand?.loadout.find((c) => c.cardId === cardId);
      const start = card ? firstUse(card) : null;
      if (!card || !start || (start.form.rolls && rollBlock)) return;
      const roll = rollOf(start.form, null, gm, rollOptions);
      void submit(card, { cardId, spell: start.first.useId, targetTokenIds: [tokenId], choices: [], ...(roll ? { roll } : {}) });
    };
  });
  // A hand that goes away drops its card waiting on the map.
  useEffect(() => () => setAim((a) => (a?.characterId === characterId ? null : a)), [characterId, setAim]);

  function settle(card: HandCard, request: UseRequest, out: UseOutcome | undefined) {
    if (!out) return;
    // A choice after the roll: the Use dialog gives way to the after-the-roll dialog (never two dialogs at once).
    setDialogFor(null);
    if (out.status === "needsChoice") return;
    // The roll options apply to the next card (F8-I1): a use that took them clears them.
    if (usedRollOptions(request)) setRollOptions(NO_ROLL_OPTIONS);
    setLast(out.status === "resolved" ? { kind: "resolved", cardName: card.name, result: out, names, done: [] } : { kind: "pending", cardName: card.name, outOfRange: out.outOfRange, names });
  }

  async function submit(card: HandCard, request: UseRequest) {
    settle(card, request, await actions.submit(request));
  }

  /** The card's first ready action use and its form, or null when nothing can start. */
  function firstUse(card: HandCard) {
    const first = playableUses(card).find((u) => u.ready);
    const effectUse = first ? cardEffect(card.cardId)?.uses.find((u) => u.id === first.useId) : undefined;
    return first && effectUse ? { first, form: formFor(effectUse) } : null;
  }

  /** Use (the button on the raised card), and the end of every drag onto the table. */
  function playNow(card: HandCard) {
    actions.clearError();
    const start = firstUse(card);
    if (!start) return;
    const { first, form } = start;
    if (needsDialog(form, { spells: playableUses(card).length, pickedEnemies: pickedEnemies.length, gm })) {
      setDialogFor(card.cardId);
      return;
    }
    // Nothing to ask (F8-I1, dcm-bxp.99.28): it fires at once, with the roll options when it rolls.
    if (form.rolls && rollBlock) return;
    const targets = form.targets ? pickedEnemies.slice(-1) : [];
    const roll = rollOf(form, null, gm, rollOptions);
    void submit(card, { cardId: card.cardId, spell: first.useId, targetTokenIds: [...targets], choices: [], ...(roll ? { roll } : {}) });
  }

  /**
   * A card dragged onto the table (HF1): played the way Use plays it, except that a one-enemy card with no enemy
   * picked waits for a tap on one on the map ("targeting on the map happens after it is played").
   */
  function play(card: HandCard) {
    const start = firstUse(card);
    if (start && aimsOnMap(start.form, { spells: playableUses(card).length, pickedEnemies: pickedEnemies.length, gm })) {
      actions.clearError();
      if (start.form.rolls && rollBlock) return;
      setAim({ characterId, cardId: card.cardId, cardName: card.name, onTarget: (tokenId) => fireAimed.current(card.cardId, tokenId) });
      return;
    }
    playNow(card);
  }

  /** Too many Experiences for the Hope: a card that rolls waits until the roll options are fixed. */
  const blocked = (card: HandCard) => rollBlock !== null && firstUse(card)?.form.rolls === true;
  const ready = (card: HandCard) => card.state === "ready" && playableUses(card).some((u) => u.ready);
  const canDrag = (card: HandCard) => canPlay && ready(card) && !blocked(card) && !actions.pending;

  const loadout = hand?.loadout ?? [];
  const vault = hand?.vault ?? [];
  const dialogCard = loadout.find((c) => c.cardId === dialogFor);
  const waitingCard = actions.waiting ? loadout.find((c) => c.cardId === actions.waiting?.request.cardId) : undefined;
  const full = loadout.length >= LOADOUT_MAX;
  const peek = hidden && !instead && hand !== undefined && loadout.length > 0;

  const over = (
    <div className="cmh-over">
      {aiming ? (
        <div className="cmh-panel cmh-aim" data-testid="combat-hand-aim">
          <p role="status" className="cmh-aim-text">
            {aiming.cardName}: tap an enemy on the map to target it.
          </p>
          <span className="cma-row">
            <button
              type="button"
              className="cm-btn cm-sm"
              onClick={() => {
                setAim(null);
                setDialogFor(aiming.cardId);
              }}
            >
              Pick from a list
            </button>
            <button type="button" className="cm-btn cm-sm" onClick={() => setAim(null)}>
              Cancel
            </button>
          </span>
        </div>
      ) : null}
      {!canPlay && !instead && loadout.length > 0 ? <p className="cmh-panel cm-muted cma-note">{lockedNote}</p> : null}
      {dialogFor === null && !actions.waiting && actions.error ? (
        <p aria-live="polite" className="cmh-panel cma-error">
          {actions.error}
        </p>
      ) : null}
      {actions.pending && dialogFor === null ? (
        <p role="status" className="cmh-panel cma-rolling">
          The card is in play…
        </p>
      ) : last ? (
        <div className="cmh-panel cmh-result">
          <button type="button" className="cm-btn cm-sm cmh-close" aria-label="Close the card result" onClick={() => setLast(null)}>
            ✕
          </button>
          <CardResult last={last} onDone={(i) => last.kind === "resolved" && setLast({ ...last, done: [...last.done, i] })} />
        </div>
      ) : null}
      <CardsWaiting campaignId={campaignId} characterId={characterId} names={names} />
      {vaultOpen && hand ? (
        <section id={vaultId} className="cmh-panel cmh-vault" aria-label={`Vault (${vault.length})`}>
          <h3 className="cm-lbl">Vault ({vault.length})</h3>
          {vault.length === 0 ? (
            <p className="cm-muted cma-small cma-note">The vault is empty.</p>
          ) : (
            <ul className="cmh-strip" aria-label="Vault" data-testid="combat-hand-vault">
              {vault.map((card) => (
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
          {canPlay && full && vault.length > 0 ? <p className="cm-muted cma-small cma-note">The loadout holds 5 cards: vault one on the sheet first.</p> : null}
          <p aria-live="polite" className="cma-error">
            {recall.error}
          </p>
        </section>
      ) : null}
    </div>
  );

  return (
    <section className="cmh-hand" aria-label={label} data-testid={testId} data-hidden={peek ? "true" : undefined}>
      {peek ? null : over}
      <div ref={tray} className="cmh-tray">
        {peek ? (
          <button type="button" className="cmh-peek-tab" aria-expanded={false} aria-controls={fanId} onClick={() => setHidden(false)}>
            Show cards ({loadout.length})
          </button>
        ) : (
          <div className="cmh-bar" data-testid="combat-hand-bar">
            <h2 className="cmh-title">{title}</h2>
            {barStart}
            {canPlay && loadout.length > 0 ? (
              <>
                <RollOptions
                  className="cmh-rolls"
                  testId="combat-hand-roll-options"
                  roller={roller}
                  values={rollOptions}
                  onChange={(patch) => setRollOptions({ ...rollOptions, ...patch })}
                  hint="Applies to the next card that rolls."
                />
                {rollBlock ? <p className="cma-error cmh-bar-error">{rollBlock}</p> : null}
              </>
            ) : null}
            <span className="cmh-bar-gap" />
            {loadout.length > 0 ? (
              <button type="button" className="cm-btn cm-sm cmh-hide" aria-expanded={true} aria-controls={fanId} onClick={() => setHidden(true)}>
                Hide cards
              </button>
            ) : null}
            {hand ? <VaultDeck cards={vault} open={vaultOpen} controls={vaultId} onToggle={() => setVaultOpen((o) => !o)} /> : null}
          </div>
        )}
        {instead ? (
          <div className="cmh-instead">{instead}</div>
        ) : hand === undefined ? (
          <p role="status" className="cmh-instead cm-muted">
            Loading the hand…
          </p>
        ) : loadout.length === 0 ? (
          <p className="cmh-instead cm-muted cma-note">No cards in the loadout.</p>
        ) : (
          <HandFan id={fanId} cards={loadout} peek={peek} locked={!canPlay} aimingCardId={aiming?.cardId ?? null} trayRef={tray} canDrag={canDrag} onPlay={play}>
            {(card) => {
              const playable = playableUses(card);
              return (
                <HandCardFace card={card} locked={!canPlay}>
                  {!canPlay ? null : card.state === "exhausted" ? (
                    <span className="cmh-status">Used</span>
                  ) : playable.length > 0 ? (
                    <button
                      type="button"
                      className="cmh-use"
                      disabled={!ready(card) || actions.pending || blocked(card)}
                      title={blocked(card) ? (rollBlock ?? undefined) : undefined}
                      aria-label={`Use ${card.name}`}
                      aria-busy={actions.pending && dialogFor === null}
                      onClick={() => playNow(card)}
                    >
                      Use
                    </button>
                  ) : null}
                </HandCardFace>
              );
            }}
          </HandFan>
        )}
        {canPlay && !peek && loadout.length > 0 ? <p className="sr-only">Drag a card onto the map to play it, or press its Use button.</p> : null}
      </div>
      {dialogCard ? (
        <UseDialog
          key={dialogCard.cardId}
          card={dialogCard}
          uses={playableUses(dialogCard)}
          effectUses={cardEffect(dialogCard.cardId)?.uses ?? []}
          creatures={creatures}
          pickedEnemies={pickedEnemies}
          gm={gm}
          roller={roller}
          rollOptions={rollOptions}
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
          onAnswer={(choices) => {
            const request = actions.waiting?.request;
            void actions.answer(choices).then((out) => request && settle(waitingCard, request, out));
          }}
        />
      ) : null}
    </section>
  );
}

/** The character's card uses waiting for the GM (Q1): names and bands only. */
function CardsWaiting({ campaignId, characterId, names }: { campaignId: Id<"campaigns">; characterId: Id<"characters">; names: ReadonlyMap<string, string> }) {
  const rows = useQuery(api.combatCards.pending, { campaignId });
  const mine = (rows ?? []).filter((r) => r.characterId === characterId);
  if (mine.length === 0) return null;
  return (
    <ul className="cmh-panel cma-requests" aria-label="Cards waiting for the GM">
      {mine.map((r) => (
        <li key={r.requestId} className="cma-request" data-testid="combat-card-waiting">
          Waiting for the GM: {r.cardName} → {r.targets.map((t) => names.get(t.tokenId) ?? t.name).join(", ")} ({r.outOfRange.map((o) => BAND_LABEL[o.band]).join(", ")})
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- players

/** The selected token when it is another player's character (F7-H4), or null. */
function otherPc(props: ActionsPanelProps, actor: NonNullable<ReturnType<typeof useActor>>) {
  const other = actor.view.pcs.find((t) => t._id === props.selectedTokenId && !t.mine && t.characterId !== undefined);
  return other?.characterId !== undefined ? { characterId: other.characterId, name: other.name } : null;
}

/**
 * The player's Hand, docked along the bottom of the map (HF1): their own, or the Hand of another player's character
 * whose token they selected (read only, F7-H4). Renders nothing without their character's token on the live map.
 */
export function Hand(props: ActionsPanelProps) {
  const actor = useActor(props);
  const { targetTokenIds } = useCombatTargets();
  if (!actor) return null;
  const other = otherPc(props, actor);
  return (
    <HandDock>
      {other ? (
        <OtherHand
          campaignId={props.campaignId}
          mapId={props.map._id}
          characterId={other.characterId}
          name={other.name}
          creatures={playerCreatures(actor.view)}
          onBack={() => props.onSelectToken(null)}
        />
      ) : (
        <HandBody
          campaignId={props.campaignId}
          mapId={props.map._id}
          characterId={actor.characterId}
          creatures={playerCreatures(actor.view)}
          pickedEnemies={seenTargets(targetTokenIds, actor.enemies)}
          gm={false}
          canPlay
        />
      )}
    </HandDock>
  );
}

/**
 * The player column's Hand card (the first card, or the phone sheet's Hand tab): where the cards are and how to play
 * them, and the player's "Hide my hand from the other players" switch.
 */
export function HandColumn(props: ActionsPanelProps) {
  const actor = useActor(props);
  if (!actor) return null;
  const other = otherPc(props, actor);
  return (
    <section className="cm-card cma-card cmh-card" aria-label="Hand">
      <h2 className="cm-h">Hand</h2>
      <p className="cm-muted cma-small cma-note">
        {other
          ? `${other.name}’s hand lies along the bottom of the map, read only.`
          : "Your cards lie along the bottom of the map. Drag one onto the map to play it, or raise it and press Use."}
      </p>
      {other ? null : <HideHandSwitch campaignId={props.campaignId} characterId={actor.characterId} />}
    </section>
  );
}

/** Another player's Hand, read only, or why it is not shown (the GM's switch is off, or its player hid it). */
function OtherHand({
  campaignId,
  mapId,
  characterId,
  name,
  creatures,
  onBack,
}: {
  campaignId: Id<"campaigns">;
  mapId: Id<"combatMaps">;
  characterId: Id<"characters">;
  name: string;
  creatures: readonly Creature[];
  onBack: () => void;
}) {
  const sharing = useHandSharing(campaignId);
  const back = (
    <button type="button" className="cm-btn cm-sm" onClick={onBack}>
      Your hand
    </button>
  );
  // A hidden hand is never asked for, so it never trips the error boundary (F7-H4).
  const instead =
    sharing === undefined ? (
      <p role="status" className="cm-muted">
        Loading the hand…
      </p>
    ) : handShared(sharing, characterId) ? undefined : (
      <p className="cm-muted cma-note" data-testid="combat-hand-hidden">
        {sharing.playersSeeHands ? `${name}’s player keeps their hand hidden.` : "The GM keeps every player’s cards private."}
      </p>
    );
  return (
    <HandBody
      campaignId={campaignId}
      mapId={mapId}
      characterId={characterId}
      creatures={creatures}
      pickedEnemies={[]}
      gm={false}
      canPlay={false}
      lockedNote={`Read only: ${name}’s player plays these cards.`}
      label={`Hand of ${name}`}
      title={`Hand · ${name}`}
      testId="combat-other-hand"
      barStart={back}
      instead={instead}
    />
  );
}

// ---------------------------------------------------------------- the GM

/**
 * GM column: the hand-sharing switch and the card uses waiting for the GM's call (Q1); the Hand of the PC whose token
 * the GM selected (it stays while the GM picks other tokens, until closed) docks along the bottom of the map (HF1).
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
      <HandSharingSwitch campaignId={campaignId} />
      <GmCardSanctions campaignId={campaignId} />
      {held && tokens && token ? (
        <HandDock>
          <HandBody
            campaignId={campaignId}
            mapId={map._id}
            characterId={held}
            creatures={gmCreatures(tokens, held)}
            pickedEnemies={[]}
            gm
            canPlay={playingFor === held}
            label={`Hand of ${token.name}`}
            title={`Hand · ${token.name}`}
            testId="combat-gm-hand"
            barStart={
              <>
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
                <button type="button" className="cm-btn cm-sm" aria-label={`Close the hand of ${token.name}`} onClick={() => setHeld(null)}>
                  ✕
                </button>
              </>
            }
          />
        </HandDock>
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
