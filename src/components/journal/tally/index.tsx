"use client";

import "./tally.css";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { brandButton } from "@/components/brand/buttons";
import { CharacterPortrait } from "@/components/party/portrait";
import { errorMessage } from "@/lib/convex-errors";
import { leastSpotlightLine } from "@/lib/domain/journal";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { PartyMember } from "../../../../convex/charactersReads";
import type { SessionTallyProps, SpotlightProps } from "../slots";
import { Card } from "../ui";

import { barPercent, resetPending, TALLY_TILES } from "./model";

/**
 * Session tally and Spotlight (JT, contract: ../slots.ts; design reference/designs/journal/journal_views.jpg, Log &
 * recap, right column). GM only (user Q5: players see neither); a player gets nothing.
 */

/** The six tally tiles from `journalTally.tally` ('-' before the session was live; a floor note when truncated). */
export function SessionTally({ campaignId, sessionId, isGm }: SessionTallyProps) {
  if (!isGm) return null;
  return <TallyCard campaignId={campaignId} sessionId={sessionId} />;
}

function TallyCard({ campaignId, sessionId }: Omit<SessionTallyProps, "isGm">) {
  const tally = useQuery(api.journalTally.tally, { campaignId, sessionId });
  return (
    <Card heading="Session tally" kind="label" className="jt-tally">
      {tally === undefined ? (
        <p role="status" className="jr-muted jr-m0">
          Loading the tally…
        </p>
      ) : (
        <>
          <ul className="jt-tiles" aria-label="Session tally counts">
            {TALLY_TILES.map(({ key, label, Icon }) => {
              const value = tally[key];
              return (
                <li key={key} className="jt-tile" data-tile={key}>
                  <Icon aria-hidden="true" className="jt-tile-icon" />
                  <span className="jt-tile-n">
                    {value === null ? (
                      <>
                        <span aria-hidden="true">-</span>
                        <span className="sr-only">none yet</span>
                      </>
                    ) : (
                      value
                    )}
                  </span>{" "}
                  <span className="jt-tile-l">{label}</span>
                </li>
              );
            })}
          </ul>
          {tally.fearGained === null ? <p className="jr-muted jr-m0 jt-note">Counts itself once the session starts.</p> : null}
          {tally.truncated ? <p className="jr-muted jr-m0 jt-note">A very busy session: these are at least the counts shown.</p> : null}
        </>
      )}
    </Card>
  );
}

/** A spotlight bar per PC (scaled to the highest count), Reset, the least-spotlight line. Automatic only (Q9). */
export function Spotlight({ campaignId, sessionId, isGm }: SpotlightProps) {
  if (!isGm) return null;
  return <SpotlightCard campaignId={campaignId} sessionId={sessionId} />;
}

function SpotlightCard({ campaignId, sessionId }: Omit<SpotlightProps, "isGm">) {
  const entries = useQuery(api.sessionPlay.spotlight, { campaignId, sessionId });
  const party = useQuery(api.charactersReads.partySummary, { campaignId });
  const reset = useMutation(api.sessionPlay.resetSpotlight).withOptimisticUpdate(resetPending);
  const [error, setError] = useState<string | null>(null);

  const members = new Map<string, PartyMember>((party ?? []).map((c) => [c._id, c]));
  const max = Math.max(0, ...(entries ?? []).map((e) => e.count));
  const line = entries === undefined ? null : leastSpotlightLine(entries);

  function onReset() {
    setError(null);
    reset({ campaignId, sessionId }).catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <Card
      heading="Spotlight"
      kind="label"
      className="jt-spot"
      actions={
        entries !== undefined && entries.length > 0 ? (
          <button type="button" className={cn(brandButton({ variant: "pill", size: "sm" }), "jt-reset")} disabled={max === 0} onClick={onReset}>
            Reset
          </button>
        ) : null
      }
    >
      {entries === undefined ? (
        <p role="status" className="jr-muted jr-m0">
          Loading the spotlight…
        </p>
      ) : entries.length === 0 ? (
        <p className="jr-muted jr-m0">No active characters in the party yet.</p>
      ) : (
        <ul className="jt-bars" aria-label="Spotlight per character">
          {entries.map((e) => {
            const member = members.get(e.characterId);
            return (
              <li key={e.characterId} className="jt-bar-row" aria-label={`${e.name}: ${e.count} spotlight ${e.count === 1 ? "moment" : "moments"}`}>
                <span className="jt-face" aria-hidden="true">
                  {member ? <CharacterPortrait character={member} size={28} /> : <span className="jt-initial">{e.name.charAt(0).toUpperCase()}</span>}
                </span>
                <span className="jt-name" aria-hidden="true">
                  {e.name}
                </span>
                <span className="jt-track" aria-hidden="true">
                  <span className="jt-fill" style={{ width: `${barPercent(e.count, max)}%` }} />
                </span>
                <span className="jt-count" aria-hidden="true">
                  {e.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {line ? <p className="jr-muted jr-m0 jt-least">{line}</p> : null}
      {error ? (
        <p role="alert" className="jr-alert jr-m0">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
