"use client";

import { useQuery } from "convex/react";
import { useId, useRef, useState } from "react";

import { cardEffect } from "@/lib/srd/card-effects";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useViewerFlag } from "../../map-view/use-viewer-flag";
import { useAreaPick } from "../../map-view/area-pick";
import { AfterRollDialog, type DialogRequest } from "../../actions/hand/dialog";
import { VaultDeck } from "../../actions/hand/dock";
import { HandCardFace } from "../../actions/hand/face";
import { handHiddenKey } from "../../actions/hand";
import { areaPickOf, formFor, LOADOUT_MAX, needsDialog, playableUses, rollOf, usedRollOptions, type AreaPick, type Creature, type HandCard, type UseOutcome } from "../../actions/hand/model";
import { CardResult, type LastCard } from "../../actions/hand/result";
import { useRecall } from "../../actions/hand/use-card";
import { NO_ROLL_OPTIONS, rollProblem, rollSummary, type Roller, type RollValues } from "../../actions/roll-controls";
import { usePick, type PickOutcome } from "../pick";
import { cardPatch, cardSession, cardSessionId, classicPointPicker, useCardPlay, type CardPickData, type CardPickEnv, type PointPicker } from "../pick-card";
import { CardBacks, catchMore, FanCard, FullCard, RollOptionsBody, SidePop } from "./parts";
import { cardLook, loadoutFullText, recallText, type HandMode, type LookContext } from "./states";

/**
 * The HUD hand (plan combat-hud H2.3; boards CmpCards and Main): the loadout as the domains tab's fan along the bottom
 * of the map with every CmpCards state around the app's own face, and beside it the vault deck, Roll options and Hide
 * cards. The writes are the classic hand's (`useCardActions` → `combatCards.useCard`, `useRecall` → `characters.moveCard`).
 *
 * Use (H3.1, boards CmpPicking / Main "Picking a target") raises the card ("Casting · pick a target") and opens the
 * picking panel (H3.0's session, `hud/pick-card`): the card's rule, the targets (the enemy picked on the map first),
 * every choice the classic Use dialog asks, the add-ons as rider switches with cost pills, and one primary ("Cast on
 * Lieutenant"). A card that asks nothing at all (no target, no choice) fires at once; an area asks the map for its
 * square next (`pointPicker`: the classic banner until H3.3's picker). Out of range goes to the GM ("Waiting for the
 * GM", H3.0); a choice after the roll opens the classic after-roll dialog; the result shows above the fan until H4.1.
 * Drag-to-play stays the classic dock's.
 *
 * Hide cards (answer 16a) folds the viewer's own fan on their screen only: this browser's flag, never a server call.
 */

export type HudHandBodyProps = {
  campaignId: Id<"campaigns">;
  mapId: Id<"combatMaps">;
  characterId: Id<"characters">;
  /** The character's name: the GM's lock tag and the view-only tag name it. */
  name: string;
  mode: HandMode;
  /** The GM's "Play for this character" (true for the player's own hand, false for a view-only hand). */
  canPlay: boolean;
  creatures: readonly Creature[];
  /** Enemies picked on the map (the player's targets): a card's panel starts with the last one picked. */
  pickedEnemies: readonly Id<"combatTokens">[];
  /** H3.1: where an area card asks the map for its square (the classic banner until H3.3's HUD picker). */
  pointPicker?: PointPicker;
};

/**
 * "Hide cards": this browser's flag (the classic hand's key, so both views agree), and the choice held for the visit
 * too, so it works where nothing can be stored (a private window).
 */
function useFolded(key: string): [boolean, (on: boolean) => void] {
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

type Open = "vault" | "rolls" | null;

export function HudHandBody({ campaignId, mapId, characterId, name, mode, canPlay, creatures, pickedEnemies, pointPicker = classicPointPicker }: HudHandBodyProps) {
  const gm = mode === "gm";
  const own = mode !== "view";
  const hand = useQuery(api.combatCards.hand, { campaignId, characterId });
  const rests = useQuery(api.rests.current, own ? { campaignId } : "skip");
  const character = useQuery(api.characters.get, canPlay ? { characterId } : "skip");
  const actions = useCardPlay({ campaignId, mapId, characterId });
  const recall = useRecall({ campaignId, characterId });
  const areaPick = useAreaPick();
  const pick = usePick();

  const [casting, setCasting] = useState<string | null>(null);
  const [areaFor, setAreaFor] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [full, setFull] = useState<string | null>(null);
  const [last, setLast] = useState<LastCard | null>(null);
  const [rollOptions, setRollOptions] = useState<RollValues>(NO_ROLL_OPTIONS);
  const [checkedRiders, setCheckedRiders] = useState<string[]>([]);
  const [folded, setFolded] = useFolded(handHiddenKey(campaignId, characterId));
  const moreFrom = useRef<HTMLElement | null>(null);
  const deck = useRef<HTMLSpanElement>(null);
  const rollsButton = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const fanId = `${ids}-fan`;
  const vaultId = `${ids}-vault`;
  const rollsId = `${ids}-rolls`;

  const roller: Roller | null = character ? { experiences: character.sheet.experiences, hope: character.sheet.hope } : null;
  const rollBlock = rollProblem(roller, rollOptions);
  const names = new Map<string, string>(creatures.map((c) => [c.tokenId, c.side === "self" ? "You" : c.name]));
  const restOpen = Boolean(rests?.open);
  const loadout = hand?.loadout ?? [];
  const vault = hand?.vault ?? [];
  const fullCard = [...loadout, ...vault].find((c) => c.cardId === full);
  const vaultPicks = vault.filter((c) => c.level <= (character?.sheet.level ?? 0)).map((c) => ({ cardId: c.cardId, name: c.name, level: c.level }));
  const selfToken = creatures.find((c) => c.side === "self")?.tokenId;
  const waitingCard = actions.waiting ? loadout.find((c) => c.cardId === actions.waiting?.request.cardId) : undefined;
  const loadoutFull = loadoutFullText(loadout.length, LOADOUT_MAX);
  const recallRiders = restOpen ? [] : (hand?.recallRiders ?? []).filter((r) => r.ready);
  const sentRiders = recallRiders.filter((r) => checkedRiders.includes(r.id)).map((r) => r.id);

  /** The card being played: its picking panel, its square on the map, its use on the way, its after-the-roll choice. */
  const sessionCard = loadout.find((c) => pick.session?.spec.id === cardSessionId(characterId, c.cardId));
  const playingId = sessionCard?.cardId ?? (areaFor !== null && areaPick.request !== null ? areaFor : null) ?? waitingCard?.cardId ?? (actions.pending ? casting : null);
  const ctx = (card: HandCard): LookContext => ({
    mode,
    canPlay,
    name,
    hope: roller?.hope ?? null,
    playing: playingId === card.cardId,
    rollBlock,
  });

  // ------------------------------------------------------------ playing a card (H3.1)

  /** What a use came back with: the result above the fan, the roll options cleared once used, how the panel ends. */
  function settle(card: HandCard, request: DialogRequest, out: UseOutcome | null | undefined): PickOutcome {
    if (!out || out.status === "needsChoice") return { kind: "done" }; // the after-the-roll dialog asks next
    if (usedRollOptions(request)) setRollOptions(NO_ROLL_OPTIONS);
    if (out.status === "resolved") {
      setLast({ kind: "resolved", cardName: card.name, result: out, names, done: [] });
      return { kind: "done" };
    }
    // Out of range: the player's "Waiting for the GM" card shows it (H3.0); the GM has no such card, so the line stays.
    if (gm) setLast({ kind: "pending", cardName: card.name, outOfRange: out.outOfRange, names });
    return { kind: "pending", requestId: out.requestId };
  }

  /** An area use: the map asks for its square (two for a wall), then the use goes with them (lanes-2 E1.4a). */
  function placeArea(card: HandCard, request: DialogRequest, area: AreaPick) {
    setAreaFor(card.cardId);
    pointPicker({
      mapId,
      cardName: card.name,
      area,
      send: async ([point, ...rest]) => {
        const sent: DialogRequest = { ...request, point: point!, ...(rest.length > 0 ? { points: rest } : {}) };
        const out = await actions.send(sent);
        settle(card, sent, out);
        if (out?.status === "resolved") return `${card.name}: ${area.label} placed.`;
        if (out?.status === "pending") return `${card.name} waits for the GM.`;
        if (out?.status === "needsChoice") return `${card.name} needs a choice.`;
        return null;
      },
    });
  }

  /** The panel's primary: sends the use (a refusal throws: the panel shows it), or hands an area to the map first. */
  async function sendFromPanel(card: HandCard, request: DialogRequest, area: AreaPick | null): Promise<PickOutcome> {
    if (area && request.point === undefined) {
      placeArea(card, request, area);
      return { kind: "done" };
    }
    setCasting(card.cardId);
    try {
      return settle(card, request, await actions.send(request));
    } finally {
      setCasting(null);
    }
  }

  function envFor(card: HandCard, options: RollValues): CardPickEnv {
    return {
      characterId,
      card,
      uses: playableUses(card),
      effectUses: cardEffect(card.cardId)?.uses ?? [],
      creatures,
      ...(gm && selfToken ? { actor: { tokenId: selfToken, characterId } } : {}),
      mapPicks: pickedEnemies,
      block: { gm, roller, rollOptions: options, vault: vaultPicks },
      play: (request, area) => sendFromPanel(card, request, area),
    };
  }

  /**
   * Use: the picking panel (H3.1). A card that asks nothing (no target, no choice) fires at once with the roll options
   * (user answer 2026-10-23: no dialog when nothing is asked); an area of that kind asks the map for its square.
   */
  function play(card: HandCard) {
    actions.clearError();
    setLast(null);
    const uses = playableUses(card);
    const first = uses.find((u) => u.ready);
    const effectUse = first ? cardEffect(card.cardId)?.uses.find((u) => u.id === first.useId) : undefined;
    if (!first || !effectUse) return;
    const form = formFor(effectUse);
    if (needsDialog(form, { spells: uses.length, pickedEnemies: 0, gm })) {
      pick.open(cardSession(envFor(card, rollOptions)));
      return;
    }
    if (form.rolls && rollBlock) return;
    const roll = rollOf(form, null, gm, rollOptions);
    const request: DialogRequest = { cardId: card.cardId, spell: first.useId, targetTokenIds: [], choices: [], ...(roll ? { roll } : {}) };
    const area = areaPickOf(effectUse);
    if (area) {
      placeArea(card, request, area);
      return;
    }
    setCasting(card.cardId);
    void actions.trySend(request).then((out) => {
      setCasting(null);
      settle(card, request, out);
    });
  }

  /** New roll options while a card's panel is open: its footer, blocked reason and request follow them. */
  function changeRollOptions(next: RollValues) {
    setRollOptions(next);
    if (sessionCard && pick.session) pick.update(cardPatch(envFor(sessionCard, next), pick.session.spec.data as CardPickData));
  }

  async function recallCard(cardId: string) {
    if (await recall.recall(cardId, restOpen, sentRiders)) setCheckedRiders([]);
  }

  function openMore(cardId: string, from: HTMLElement) {
    moreFrom.current = from;
    setFull(cardId);
  }

  function closePop() {
    const back = open === "vault" ? deck.current?.querySelector("button") : rollsButton.current;
    setOpen(null);
    back?.focus();
  }

  // ------------------------------------------------------------ render

  const label = mode === "own" ? "Your hand" : `Hand of ${name}`;
  const showFan = !(folded && own);

  return (
    <section className="hud-hand" aria-label={label} data-testid="hud-hand" data-mode={mode} data-folded={folded && own ? "true" : undefined}>
      <div className="hud-hand-over" aria-live="polite">
        {actions.pending && !pick.session ? (
          <p role="status" className="hud-hand-note">
            The card is in play…
          </p>
        ) : null}
        {!actions.waiting && actions.error ? <p className="hud-hand-note hud-hand-err">{actions.error}</p> : null}
        {last && !actions.pending ? (
          <div className="hud-hand-note hud-hand-result" data-testid="hud-hand-result">
            <button type="button" className="hud-hand-pop-x" aria-label="Close the card result" onClick={() => setLast(null)}>
              ✕
            </button>
            <CardResult last={last} onDone={(i) => last.kind === "resolved" && setLast({ ...last, done: [...last.done, i] })} />
          </div>
        ) : null}
      </div>

      <div className="hud-hand-row">
        {hand === undefined ? (
          <p role="status" className="hud-hand-note hud-hand-loading">
            Loading the hand…
          </p>
        ) : loadout.length === 0 ? (
          <p className="hud-hand-note hud-hand-empty">No cards in the loadout.</p>
        ) : showFan ? (
          <ul id={fanId} className="hud-fan" aria-label="Loadout" data-testid="hud-hand-fan">
            {loadout.map((card, i) => {
              const look = cardLook(card, ctx(card));
              return (
                <FanCard
                  key={card.cardId}
                  card={card}
                  index={i}
                  count={loadout.length}
                  look={look}
                  locked={mode === "gm" && !canPlay}
                  pending={actions.pending}
                  onUse={() => play(card)}
                  onMore={(from) => openMore(card.cardId, from)}
                />
              );
            })}
          </ul>
        ) : (
          <div className="hud-folded" data-testid="hud-hand-folded">
            <CardBacks domains={loadout.map((c) => c.domain)} />
            <span className="sr-only">{`${loadout.length} cards folded`}</span>
          </div>
        )}

        {own && hand ? (
          // Escape on the side buttons closes their open popover too (the popover handles it while focus is inside).
          <div
            className="hud-fanside"
            onKeyDown={(e) => {
              if (e.key === "Escape" && open !== null) {
                e.stopPropagation();
                closePop();
              }
            }}
          >
            {open === "vault" ? (
              <SidePop id={vaultId} title={`Vault (${vault.length})`} sub={restOpen ? "Resting: recall is free" : "In combat the recall cost is paid"} onClose={closePop} testId="hud-hand-vault">
                {canPlay && vault.length > 0 && recallRiders.length > 0 ? (
                  <fieldset className="hud-vault-riders">
                    <legend>With the next recall</legend>
                    {recallRiders.map((r) => (
                      <label key={r.id}>
                        <input
                          type="checkbox"
                          checked={checkedRiders.includes(r.id)}
                          onChange={(e) => setCheckedRiders((now) => (e.target.checked ? [...now, r.id] : now.filter((id) => id !== r.id)))}
                        />{" "}
                        {r.name}: -{r.amount} Recall Cost
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                {vault.length === 0 ? (
                  <p className="hud-hand-pop-empty">The vault is empty.</p>
                ) : (
                  <ul className="hud-vault" aria-label="Vault">
                    {vault.map((card) => (
                      <li key={card.cardId} className="hud-rec" onClickCapture={(e) => catchMore(e, (from) => openMore(card.cardId, from))}>
                        <div className={cn("hud-rec-card", loadoutFull && "is-locked")}>
                          <HandCardFace card={card} locked={!canPlay} />
                        </div>
                        {canPlay ? (
                          <button
                            type="button"
                            className="hud-rec-btn"
                            disabled={loadoutFull !== null || recall.pending !== null}
                            aria-label={`${loadoutFull ?? recallText(card.recallCost, restOpen)}, ${card.name}`}
                            onClick={() => void recallCard(card.cardId)}
                          >
                            {loadoutFull ?? recallText(card.recallCost, restOpen)}
                          </button>
                        ) : (
                          <span className="hud-rec-btn" data-off="true">
                            {recallText(card.recallCost, restOpen)}
                          </span>
                        )}
                        {canPlay && loadoutFull ? <small>Send a card to the vault first</small> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {recall.error ? (
                  <p role="alert" className="hud-hand-err">
                    {recall.error}
                  </p>
                ) : null}
              </SidePop>
            ) : null}
            {open === "rolls" && canPlay ? (
              <SidePop id={rollsId} title="Roll options" onClose={closePop} testId="hud-hand-rolls">
                <RollOptionsBody roller={roller} values={rollOptions} problem={rollBlock} onChange={(patch) => changeRollOptions({ ...rollOptions, ...patch })} />
              </SidePop>
            ) : null}
            <span className="hud-deck" ref={deck}>
              <VaultDeck cards={vault} open={open === "vault"} controls={vaultId} onToggle={() => setOpen((o) => (o === "vault" ? null : "vault"))} />
            </span>
            {canPlay ? (
              <button
                ref={rollsButton}
                type="button"
                className="hud-fs-b"
                aria-expanded={open === "rolls"}
                aria-controls={open === "rolls" ? rollsId : undefined}
                data-set={rollSummary(rollOptions) ? "true" : undefined}
                title={rollSummary(rollOptions) ?? undefined}
                onClick={() => setOpen((o) => (o === "rolls" ? null : "rolls"))}
              >
                <DiceIcon />
                Roll options
              </button>
            ) : null}
            {loadout.length > 0 ? (
              <button
                type="button"
                className="hud-fs-b"
                aria-expanded={!folded}
                aria-controls={folded ? undefined : fanId}
                data-testid="hud-hand-hide"
                onClick={() => setFolded(!folded)}
              >
                {folded ? `Show cards (${loadout.length})` : "Hide cards"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {fullCard ? (
        <FullCard
          card={fullCard}
          useLabel={fullCard.place === "loadout" && cardLook(fullCard, ctx(fullCard)).showUse ? "Use" : null}
          canUse={cardLook(fullCard, ctx(fullCard)).canUse && !actions.pending}
          reason={cardLook(fullCard, ctx(fullCard)).reason}
          onUse={() => play(fullCard)}
          onClose={() => {
            setFull(null);
            moreFrom.current?.focus();
          }}
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
            void actions.answer(choices).then((sent) => sent && settle(waitingCard, sent.request, sent.out));
          }}
        />
      ) : null}
    </section>
  );
}

function DiceIcon() {
  return (
    <svg className="hud-hc-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5.5" cy="5.5" r="1.1" />
      <circle cx="10.5" cy="10.5" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
    </svg>
  );
}

/**
 * Another player's hand that is not shared (board CmpCards "Hidden hand"): three card backs and why. The hand itself is
 * never asked for, so the server's FORBIDDEN never trips the boundary (F7-H4).
 */
export function HiddenHand({ name, gmPrivate }: { name: string; gmPrivate: boolean }) {
  return (
    <section className="hud-hand" aria-label={`Hand of ${name}`} data-testid="hud-hand" data-mode="hidden">
      <div className="hud-hand-row">
        <div className="hud-folded hud-hidden">
          <CardBacks domains={[]} />
          <p className="hud-hand-note">{gmPrivate ? "The GM keeps every player’s cards private." : `${name} keeps their hand hidden.`}</p>
        </div>
      </div>
    </section>
  );
}
