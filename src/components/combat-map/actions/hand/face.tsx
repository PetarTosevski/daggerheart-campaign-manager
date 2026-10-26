"use client";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import { CardMore, type CardDialogCard } from "@/components/cards/card-dialog";
import { designAsset } from "@/lib/design-assets";
import { DOMAIN_CARD_ART } from "@/lib/srd/art";
import { cardEffect } from "@/lib/srd/card-effects";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";
import { DOMAINS } from "@/lib/srd/domains";

import { cardBadges, type HandCard } from "./model";

/**
 * One card of the Hand (plan combat-actions CA6): the board's card face (`hc-face`, as the sheet's felt table and
 * SC1's CardDialog draw it) made compact for the map column: domain-coloured head with the level, the art with the
 * blue Recall badge, the cost and limit badges, the first lines of the text, and a footer with 'More' (SC1's
 * CardDialog) and the card's action (`children`: Use, Recall, or a note). An exhausted card is greyed and turned with
 * its reset label in a ribbon and in its accessible name (R6, Q3, as CA7 on the sheet); `locked` greys a card the GM
 * may not play yet.
 */

const TYPE_LABEL: Record<string, string> = { ability: "Ability", spell: "Spell", grimoire: "Grimoire" };

const BY_ID = new Map(DOMAIN_CARDS.map((c) => [c.id, c]));

/** The display fields of a card for the face and CardDialog: the SRD card with its art (the sheet's fallback table). */
export function cardDisplay(card: Pick<HandCard, "cardId" | "name" | "domain" | "level" | "type" | "recallCost">): CardDialogCard {
  const srd = BY_ID.get(card.cardId);
  return {
    name: card.name,
    domain: card.domain as CardDialogCard["domain"],
    level: card.level,
    type: card.type as CardDialogCard["type"],
    recallCost: card.recallCost,
    text: srd?.text ?? "",
    art: srd?.art ?? DOMAIN_CARD_ART[card.cardId],
  };
}

export function HandCardFace({ card, locked = false, children }: { card: HandCard; locked?: boolean; children?: ReactNode }) {
  const display = cardDisplay(card);
  const domain = DOMAINS.find((d) => d.id === card.domain);
  const art = display.art ? designAsset(display.art) : undefined;
  const used = card.state === "exhausted" ? (card.resetLabel ?? "Back after a rest") : null;
  const badges = cardBadges(card, cardEffect(card.cardId));
  const label = used ? `${card.name}, used: ${used}` : card.name;
  return (
    <article
      className="cmh-face"
      style={{ "--dc": domain?.color ?? "#5b2b2b" } as CSSProperties}
      aria-label={label}
      data-exhausted={used ? "true" : undefined}
      data-locked={locked ? "true" : undefined}
      data-testid="combat-hand-card"
    >
      <header className="cmh-head">
        <h3 className="cmh-name">{card.name}</h3>
        <span className="cmh-lvl" aria-label={`Level ${card.level}`}>
          {card.level}
        </span>
      </header>
      <div className="cmh-art">
        {/* Decoration: the name, level and recall cost are all in text. */}
        {art ? <Image className="cmh-art-img" src={art} alt="" fill sizes="200px" /> : null}
        <span className="cmh-rc" aria-hidden="true">
          {card.recallCost}
        </span>
      </div>
      {used ? <p className="cmh-used">Used · {used}</p> : null}
      <div className="cmh-meta">
        {domain?.name ?? card.domain} {TYPE_LABEL[card.type] ?? card.type} · Recall {card.recallCost}
        {card.tokens > 0 ? ` · ${card.tokens} token${card.tokens === 1 ? "" : "s"}` : ""}
      </div>
      {badges.length > 0 ? (
        <ul className="cmh-badges" aria-label="Cost and limit">
          {badges.map((b) => (
            <li key={`${b.kind}:${b.text}`} className="cmh-badge" data-kind={b.kind}>
              {b.text}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="cmh-text">{display.text}</p>
      <footer className="cmh-acts">
        <CardMore card={display} used={used} className="cmh-more" />
        {children}
      </footer>
    </article>
  );
}
