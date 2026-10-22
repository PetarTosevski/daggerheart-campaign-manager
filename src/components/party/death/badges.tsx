"use client";

import "./death.css";

import { useQuery } from "convex/react";

import { BrandButton } from "@/components/brand/buttons";
import { Badge } from "@/components/party/sheet-ui";
import { AWAY_REASON_LABELS, type AwayReason } from "@/lib/domain/death/index";
import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { CardSlotProps } from "../slots";

const BADGE = "inline-flex min-h-6 items-center rounded-full px-2.5 font-display text-[11px] font-bold tracking-[0.08em] uppercase";

/** "Away · in the infirmary" / "Away · sent home" / "Away · benched" (HF 127, X6). */
export function awayLabel(character: Pick<CardSlotProps["character"], "away" | "benched">): string {
  return `Away${character.away ? ` · ${AWAY_REASON_LABELS[character.away.reason]}` : character.benched ? " · benched" : ""}`;
}

/**
 * Unconscious, away (death move or benched) and journey-ends badges (CB 106,
 * HF 127), plus the GM's "Return to play" for a Castle High away character.
 * `tone: "banner"` renders them as the board's FALLEN pills in the sheet's banner;
 * `showAway` is off there, because the banner's status badge already shows the away status.
 */
export function DeathBadges({ character, canEdit, isGm, showAway, tone }: CardSlotProps & { showAway: boolean; tone: "banner" | "card" }) {
  const back = useIntent(api.deathMoves.returnFromAway);
  const unconscious = character.status === "active" && character.sheet.conditions?.includes("unconscious");
  const away = character.status === "away";
  // Shown to the GM (and the sheet's editors), who ends the journey at the end of the session (CB 106).
  const journeyEnds = Boolean(character.sheet.journeyEnds) && (isGm || canEdit) && character.status !== "dead";
  // A benched character (X6) comes back through the card's "Bring back".
  const returnToPlay = away && isGm && !character.benched;
  // A Castle High away character: its reason may still be the player's request (LL1).
  const deathAway = away && character.away !== undefined;
  if (!unconscious && !(away && (showAway || returnToPlay)) && !deathAway && !journeyEnds) return null;
  const request = deathAway ? <AwayRequest character={character} isGm={isGm} tone={tone} /> : null;

  if (tone === "banner") {
    return (
      <span className="db-banner">
        {unconscious ? <Badge data-testid="death-unconscious">Unconscious</Badge> : null}
        {away && showAway ? (
          <Badge tone="paper" data-testid="death-away">
            {awayLabel(character)}
          </Badge>
        ) : null}
        {request}
        {journeyEnds ? (
          <Badge tone="wine" data-testid="death-journey-ends">
            Journey ends
          </Badge>
        ) : null}
        {returnToPlay ? (
          <button type="button" className="db-return" disabled={back.pending} onClick={() => void back.fire({ characterId: character._id })}>
            Return to play
          </button>
        ) : null}
        {back.error ? (
          <span role="alert" className="db-error">
            {back.error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {unconscious ? (
        <span data-testid="death-unconscious" className={cn(BADGE, "bg-[#2a2140] text-[#d9ccff]")}>
          Unconscious
        </span>
      ) : null}
      {away && showAway ? (
        <span data-testid="death-away" className={cn(BADGE, "bg-[#24343a] text-[#cfe3e8]")}>
          {awayLabel(character)}
        </span>
      ) : null}
      {request}
      {journeyEnds ? (
        <span data-testid="death-journey-ends" className={cn(BADGE, "bg-[#3a1414] text-[#ffb0a8]")}>
          Journey ends
        </span>
      ) : null}
      {returnToPlay ? (
        <BrandButton size="sm" variant="pill" disabled={back.pending} onClick={() => void back.fire({ characterId: character._id })}>
          Return to play
        </BrandButton>
      ) : null}
      {back.error ? (
        <span role="alert" className="text-[13px] text-danger">
          {back.error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * LL1: a player's less-lethal pick is a request until the GM settles it. Everyone
 * sees "Requested"; the GM gets "Confirm" and "Change to …" (the GM's choice is final).
 */
function AwayRequest({ character, isGm, tone }: { character: CardSlotProps["character"]; isGm: boolean; tone: "banner" | "card" }) {
  const state = useQuery(api.deathMoves.state, { characterId: character._id });
  const settle = useIntent(api.deathMoves.settleAway);
  const reason = character.away?.reason;
  if (!state?.awayRequested || reason === undefined) return null;
  const other: AwayReason = reason === "infirmary" ? "sentHome" : "infirmary";
  const choices = [
    [reason, "Confirm"],
    [other, `Change to ${AWAY_REASON_LABELS[other]}`],
  ] as const;
  const fire = (r: AwayReason) => void settle.fire({ characterId: character._id, reason: r });
  return (
    <>
      {tone === "banner" ? (
        <Badge tone="paper" data-testid="death-away-requested">
          Requested
        </Badge>
      ) : (
        <span data-testid="death-away-requested" className={cn(BADGE, "bg-[#3a3014] text-[#f3dfa8]")}>
          Requested
        </span>
      )}
      {isGm
        ? choices.map(([r, text]) =>
            tone === "banner" ? (
              <button key={r} type="button" className="db-return" disabled={settle.pending} onClick={() => fire(r)}>
                {text}
              </button>
            ) : (
              <BrandButton key={r} size="sm" variant="pill" disabled={settle.pending} onClick={() => fire(r)}>
                {text}
              </BrandButton>
            ),
          )
        : null}
      {settle.error ? (
        <span role="alert" className={tone === "banner" ? "db-error" : "text-[13px] text-danger"}>
          {settle.error}
        </span>
      ) : null}
    </>
  );
}
