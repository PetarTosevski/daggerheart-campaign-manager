"use client";

import "./death.css";

import { BrandButton } from "@/components/brand/buttons";
import { Badge } from "@/components/party/sheet-ui";
import { AWAY_REASON_LABELS } from "@/lib/domain/death/index";
import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { SlotProps } from "../slots";

const BADGE = "inline-flex min-h-6 items-center rounded-full px-2.5 font-display text-[11px] font-bold tracking-[0.08em] uppercase";

/** "Away · in the infirmary" / "Away · sent home" / "Away · benched" (HF 127, X6). */
export function awayLabel(character: Pick<SlotProps["character"], "away" | "benched">): string {
  return `Away${character.away ? ` · ${AWAY_REASON_LABELS[character.away.reason]}` : character.benched ? " · benched" : ""}`;
}

/**
 * Unconscious, away (death move or benched) and journey-ends badges (CB 106,
 * HF 127), plus the GM's "Return to play" for a Castle High away character.
 * `tone: "banner"` renders them as the board's FALLEN pills in the sheet's banner;
 * `showAway` is off there, because the banner's status badge already shows the away status.
 */
export function DeathBadges({ character, canEdit, isGm, showAway, tone }: SlotProps & { showAway: boolean; tone: "banner" | "card" }) {
  const back = useIntent(api.deathMoves.returnFromAway);
  const unconscious = character.status === "active" && character.sheet.conditions?.includes("unconscious");
  const away = character.status === "away";
  // Shown to the GM (and the sheet's editors), who ends the journey at the end of the session (CB 106).
  const journeyEnds = Boolean(character.sheet.journeyEnds) && (isGm || canEdit) && character.status !== "dead";
  // A benched character (X6) comes back through the card's "Bring back".
  const returnToPlay = away && isGm && !character.benched;
  if (!unconscious && !(away && (showAway || returnToPlay)) && !journeyEnds) return null;

  if (tone === "banner") {
    return (
      <span className="db-banner">
        {unconscious ? <Badge data-testid="death-unconscious">Unconscious</Badge> : null}
        {away && showAway ? (
          <Badge tone="paper" data-testid="death-away">
            {awayLabel(character)}
          </Badge>
        ) : null}
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
