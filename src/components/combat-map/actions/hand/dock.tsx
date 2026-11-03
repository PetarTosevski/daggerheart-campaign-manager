"use client";

import "./hand.css";

import Image from "next/image";

import { deckBacks } from "@/components/cards/fan";
import { designAsset } from "@/lib/design-assets";

import type { HandCard } from "./model";

/**
 * The vault deck (plan hand-fan HF1, dcm-bxp.99.30): the small deck beside the Hand that opens the vault's cards. The
 * HUD's hand (plan combat-hud H2.3) shows it; the classic docked fan went with the cut-over (H8.1).
 */

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
