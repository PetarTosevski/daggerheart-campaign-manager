"use client";

import { BrandButton } from "@/components/brand/buttons";
import { AWAY_REASON_LABELS } from "@/lib/domain/death/index";
import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { SlotProps } from "../slots";

const BADGE = "inline-flex min-h-6 items-center rounded-full px-2.5 font-display text-[11px] font-bold tracking-[0.08em] uppercase";

/**
 * Unconscious, away (death move or benched) and journey-ends badges (CB 106,
 * HF 127), plus the GM's "Return to play" for a Castle High away character.
 * `showAway` is off on the sheet,
 * whose header already shows the away status.
 */
export function DeathBadges({ character, canEdit, isGm, showAway, tone }: SlotProps & { showAway: boolean; tone: "paper" | "card" }) {
  const back = useIntent(api.deathMoves.returnFromAway);
  const unconscious = character.status === "active" && character.sheet.conditions?.includes("unconscious");
  const away = character.status === "away";
  // Shown to the GM (and the sheet's editors), who ends the journey at the end of the session (CB 106).
  const journeyEnds = Boolean(character.sheet.journeyEnds) && (isGm || canEdit) && character.status !== "dead";
  if (!unconscious && !away && !journeyEnds) return null;
  const paper = tone === "paper";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {unconscious ? (
        <span data-testid="death-unconscious" className={cn(BADGE, paper ? "bg-[#3a2a14] text-[#f6ead2]" : "bg-[#2a2140] text-[#d9ccff]")}>
          Unconscious
        </span>
      ) : null}
      {away && showAway ? (
        <span data-testid="death-away" className={cn(BADGE, paper ? "bg-[#d9c8a8] text-[#3a2a14]" : "bg-[#24343a] text-[#cfe3e8]")}>
          Away{character.away ? ` · ${AWAY_REASON_LABELS[character.away.reason]}` : character.benched ? " · benched" : ""}
        </span>
      ) : null}
      {journeyEnds ? (
        <span data-testid="death-journey-ends" className={cn(BADGE, paper ? "bg-[#5b2b2b] text-[#f6ead2]" : "bg-[#3a1414] text-[#ffb0a8]")}>
          Journey ends
        </span>
      ) : null}
      {/* A benched character (X6) comes back through the card's "Bring back". */}
      {away && isGm && !character.benched ? (
        <BrandButton size="sm" variant={paper ? "outline" : "pill"} disabled={back.pending} onClick={() => void back.fire({ characterId: character._id })} className={paper ? "border-[#8a6a3a] text-[#3a2a14]" : undefined}>
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
