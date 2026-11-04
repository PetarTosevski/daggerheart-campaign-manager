"use client";

import Image from "next/image";

import { designAsset } from "@/lib/design-assets";
import type { RollRecord } from "@/lib/domain/duality";
import { DOMAIN_CARD_ART } from "@/lib/srd/art";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";
import { cn } from "@/lib/utils";

import { dualityParts, gainsOf, signedPart, type Verdict } from "./model";

/** Small pieces the result panel, the held roll and the after-roll asks share (Main `.res-*`). */

const CARD_ART = new Map(DOMAIN_CARDS.map((c) => [c.id, c.art]));

/** The card's art URL (the picking panel's rule), or null. */
export function cardArt(cardId: string | null): string | null {
  if (!cardId) return null;
  const id = CARD_ART.get(cardId) ?? DOMAIN_CARD_ART[cardId];
  return id ? (designAsset(id) ?? null) : null;
}

export function CardArt({ cardId }: { cardId: string | null }) {
  const art = cardArt(cardId);
  if (!art) return null;
  return (
    <span className="hud-res-art">
      <Image src={art} alt="" fill sizes="58px" />
    </span>
  );
}

export const STAR = (
  <svg className="hud-res-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <path d="M8 1l1.8 4.6L14.5 6l-3.6 3 1.1 4.7L8 11.3 4 13.7l1.1-4.7L1.5 6l4.7-.4z" />
  </svg>
);

export const FLAME = (
  <svg className="hud-res-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <path d="M8 1c1.5 3 4.5 4.5 4.5 8.2A4.5 4.5 0 0 1 3.5 9.2C3.5 7 5 6 5.5 4.5 6.5 6 7 6.2 7.3 6 7.6 4 8 2.5 8 1z" />
  </svg>
);

/**
 * The duality line (Main `.res-dice`): the Hope die, the Fear die, everything else as one signed number, "= total", then
 * what the roll gave ("+1 Hope", the GM's Fear). A roll without duality dice shows its total only.
 */
export function DiceLine({ roll, fear }: { roll: RollRecord; fear: number }) {
  const parts = dualityParts(roll);
  const gains = gainsOf(roll, fear);
  return (
    <div className="hud-res-dice" data-testid="hud-result-dice">
      {parts ? (
        <>
          <span className="hud-die hud-die-hope" role="img" aria-label={`Hope die ${parts.hope}`}>
            <small aria-hidden="true">Hope</small>
            <b aria-hidden="true">{parts.hope}</b>
          </span>
          <span className="hud-die hud-die-fear" role="img" aria-label={`Fear die ${parts.fear}`}>
            <small aria-hidden="true">Fear</small>
            <b aria-hidden="true">{parts.fear}</b>
          </span>
          {parts.rest !== 0 ? (
            <span className="hud-res-plus" aria-label={`Modifier ${signedPart(parts.rest)}`}>
              {signedPart(parts.rest)}
            </span>
          ) : null}
          <span className="hud-res-eq">
            = <b data-testid="hud-result-total">{parts.total}</b>
          </span>
        </>
      ) : (
        <span className="hud-res-eq">
          Total <b data-testid="hud-result-total">{roll.total}</b>
        </span>
      )}
      {gains.length > 0 ? (
        <span className="hud-res-gains">
          {gains.map((g) => (
            <span key={g.text} className={cn("hud-res-gain", g.tone === "fear" && "hud-res-gain-fear")}>
              {g.tone === "fear" ? FLAME : STAR}
              {g.text}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/** The Hit / Miss / Defeated pill (`.rr-hit`). */
export function VerdictPill({ verdict }: { verdict: Verdict }) {
  return (
    <span className="hud-res-v" data-verdict={verdict.toLowerCase()}>
      {verdict}
    </span>
  );
}
