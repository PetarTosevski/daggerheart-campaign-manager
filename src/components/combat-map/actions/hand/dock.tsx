"use client";

import Image from "next/image";
import { useCallback, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { deckBacks, fan } from "@/components/cards/fan";
import { designAsset } from "@/lib/design-assets";

import { DRAG_SLOP_PX, dropsOnTable, type Box, type HandCard } from "./model";

/**
 * The Hand docked along the bottom of the Combat Map (plan hand-fan HF1, dcm-bxp.99.30; user request 2026-10-23: "use
 * the same layout as the loadout in the domains tab (as if you are holding the cards like in a DCG duel) on the bottom
 * side of the map"). `HandDock` portals the Hand into the map board (`.cm-board`) so it lies over the map's bottom
 * edge; `HandFan` is the domains tab's fan (src/components/cards/fan.ts) with hover / focus / tap raising a card and a
 * drag onto the table playing it; `VaultDeck` is the small deck at the right end of the bar.
 */

// ---------------------------------------------------------------- where the hand docks

const NO_SUBSCRIPTION = () => () => {};

/**
 * The map board the Hand docks into: the `.cm-board` in the page's map area, found from an anchor in the column that
 * mounts the Hand. A MutationObserver on the map area follows the board when it is swapped (the map's error boundary
 * remounting it). null on the server, before the anchor mounts, or outside the Combat Map page (the unit tests): the
 * Hand then renders in place.
 */
export function useDockTarget(): { anchor: (el: HTMLElement | null) => void; target: Element | null } {
  const [area, setArea] = useState<Element | null>(null);
  const anchor = useCallback((el: HTMLElement | null) => setArea(el?.closest(".cm-main")?.querySelector(":scope > .cm-area") ?? null), []);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!area) return () => {};
      const observer = new MutationObserver(onChange);
      observer.observe(area, { childList: true });
      return () => observer.disconnect();
    },
    [area],
  );
  const target = useSyncExternalStore(
    area ? subscribe : NO_SUBSCRIPTION,
    () => area?.querySelector(":scope > .cm-board") ?? null,
    () => null,
  );
  return { anchor, target };
}

/** Renders the Hand over the bottom edge of the map board, or in place when there is no board to dock into. */
export function HandDock({ children }: { children: ReactNode }) {
  const { anchor, target } = useDockTarget();
  return (
    <>
      <span ref={anchor} hidden />
      {target ? (
        createPortal(<div className="cmh-dock">{children}</div>, target)
      ) : (
        <div className="cmh-dock" data-inline="true">
          {children}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- the fan

/** The map's viewport (the table a card is dropped on): one map per page. */
function tableBox(): Box | null {
  return document.querySelector(".cm-vp")?.getBoundingClientRect() ?? null;
}

type Press = { cardId: string; pointerId: number; sx: number; sy: number; moved: boolean };
type Drag = { cardId: string; dx: number; dy: number };

/**
 * The loadout as the domains tab's fan along the bottom edge (7° per step, raised out of the fan on hover, focus or a
 * tap). A card `canDrag` allows is dragged with the pointer (mouse, pen or touch) and, let go over the map outside the
 * tray, played through `onPlay`, the same path as its Use button (WCAG 2.5.7: Use stays the single-pointer way).
 * Exhausted and greyed cards can't be dragged. `peek` hides the fan below the edge with only the card tops showing.
 */
export function HandFan({
  id,
  cards,
  peek,
  locked,
  aimingCardId,
  trayRef,
  canDrag,
  onPlay,
  children,
}: {
  id: string;
  cards: readonly HandCard[];
  peek: boolean;
  locked: boolean;
  aimingCardId: string | null;
  /** The bar and the fan: a card let go over it stays in the hand. */
  trayRef: RefObject<HTMLElement | null>;
  canDrag: (card: HandCard) => boolean;
  onPlay: (card: HandCard) => void;
  /** The card face with its action (Use, Used, nothing), per card. */
  children: (card: HandCard) => ReactNode;
}) {
  const press = useRef<Press | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  function down(card: HandCard, e: ReactPointerEvent<HTMLLIElement>) {
    if (e.button !== 0 || peek) return;
    // The face's own buttons (More, Use) keep their clicks.
    if ((e.target as Element).closest("button, a, input, summary")) return;
    press.current = { cardId: card.cardId, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
    if (canDrag(card)) e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function move(card: HandCard, e: ReactPointerEvent<HTMLLIElement>) {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId || p.cardId !== card.cardId || !canDrag(card)) return;
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    if (!p.moved && Math.hypot(dx, dy) > DRAG_SLOP_PX) p.moved = true;
    if (p.moved) setDrag({ cardId: card.cardId, dx, dy });
  }

  function up(card: HandCard, e: ReactPointerEvent<HTMLLIElement>) {
    const p = press.current;
    press.current = null;
    setDrag(null);
    if (!p || p.pointerId !== e.pointerId || p.cardId !== card.cardId) return;
    const moved = p.moved || Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > DRAG_SLOP_PX;
    if (!moved) {
      // A tap raises the card (focus keeps it raised until the next tap elsewhere).
      e.currentTarget.focus();
      return;
    }
    // The press focused the card; once it is let go after a drag it drops back into the fan.
    e.currentTarget.blur();
    if (!canDrag(card)) return;
    if (dropsOnTable({ x: e.clientX, y: e.clientY }, tableBox(), trayRef.current?.getBoundingClientRect() ?? null)) onPlay(card);
  }

  function cancel() {
    press.current = null;
    setDrag(null);
  }

  return (
    <ul
      id={id}
      className="cmh-fan"
      aria-label="Loadout"
      data-testid="combat-hand-loadout"
      data-peek={peek ? "true" : undefined}
      aria-hidden={peek ? true : undefined}
      inert={peek}
    >
      {cards.map((card, i) => {
        const dragging = drag?.cardId === card.cardId;
        const style = { ...fan(i, cards.length, card.state === "exhausted"), ...(dragging ? { "--dx": `${drag.dx}px`, "--dy": `${drag.dy}px` } : {}) } as CSSProperties;
        return (
          // A list item that takes focus on a tap (tabIndex -1: not a tab stop; keyboard users raise a card by tabbing
          // to its More or Use button).
          <li
            key={card.cardId}
            className="cmh-fan-card"
            style={style}
            tabIndex={-1}
            data-draggable={!locked && canDrag(card) ? "true" : undefined}
            data-dragging={dragging ? "true" : undefined}
            data-aiming={aimingCardId === card.cardId ? "true" : undefined}
            onPointerDown={(e) => down(card, e)}
            onPointerMove={(e) => move(card, e)}
            onPointerUp={(e) => up(card, e)}
            onPointerCancel={cancel}
          >
            {children(card)}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- the vault deck

/** The small vault deck at the right end of the bar: three card backs and the count; it opens the vault's cards. */
export function VaultDeck({ cards, open, controls, onToggle }: { cards: readonly HandCard[]; open: boolean; controls: string; onToggle: () => void }) {
  const backs = deckBacks(cards.map((c) => c.domain));
  const label = `${open ? "Close" : "Open"} vault, ${cards.length} card${cards.length === 1 ? "" : "s"}`;
  return (
    <button
      type="button"
      className={`cmh-deck${cards.length ? "" : " empty"}${open ? " open" : ""}`}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      title={label}
      data-testid="combat-hand-vault-deck"
      onClick={onToggle}
    >
      {backs
        .map((back, i) => {
          const src = designAsset(back);
          return (
            <span key={i} className={`cmh-deck-card v${i + 1}`}>
              {src ? <Image src={src} alt="" fill sizes="48px" className="cmh-deck-img" /> : null}
            </span>
          );
        })
        .reverse()}
      <span className="cmh-deck-count" aria-hidden="true">
        {cards.length}
      </span>
    </button>
  );
}
