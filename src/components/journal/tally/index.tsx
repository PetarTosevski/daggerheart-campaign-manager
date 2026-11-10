"use client";

import "./tally.css";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { CharacterPortrait } from "@/components/party/portrait";
import { errorMessage } from "@/lib/convex-errors";
import { leastSpotlightLine } from "@/lib/domain/journal";
import { barPercent, resetPending, tallyTiles } from "@/lib/journal/tally";

import { api } from "../../../../convex/_generated/api";
import type { PartyMember } from "../../../../convex/charactersReads";
import type { SpotlightEntry } from "../../../../convex/sessionPlay";
import type { SessionTallyProps, SpotlightProps } from "../slots";
import { Card } from "../ui";

import { TALLY_ICONS } from "./model";

/**
 * Session tally and Spotlight (JT, contract: ../slots.ts; design reference/designs/journal/journal_views.jpg, Log &
 * recap, right column). The tally tiles are every member's (dcm-z9rz.25; a player without "Players see the GM's Fear"
 * gets no Fear tiles); the spotlight bars and least-spotlight line are the GM's and co-GMs', and the players' too when
 * the table setting `spotlightToPlayers` is on (config JO3, Q5 a).
 */

/** The six tally tiles from `journalTally.tally` ('-' before the session was live; a floor note when truncated). */
export function SessionTally({ campaignId, sessionId }: SessionTallyProps) {
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
            {tallyTiles(tally.fearHidden).map(({ key, label }) => {
              const value = tally[key];
              const Icon = TALLY_ICONS[key];
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
          {tally.hopeSpent === null ? <p className="jr-muted jr-m0 jt-note">Counts itself once the session starts.</p> : null}
          {tally.truncated ? <p className="jr-muted jr-m0 jt-note">A very busy session: these are at least the counts shown.</p> : null}
        </>
      )}
    </Card>
  );
}

/**
 * A spotlight bar per PC (scaled to the highest count), Reset, the least-spotlight line. Automatic only (Q9). Reads
 * `journalTally.spotlight` (config JO3, Q5 a): the GM and co-GMs always get the bars and Reset; a player gets the bars
 * and the line (no Reset) only when the GM turned on "Show spotlight balance to players", else the query returns null
 * and nothing renders.
 */
export function Spotlight({ campaignId, sessionId, isGm }: SpotlightProps) {
  const entries = useQuery(api.journalTally.spotlight, { campaignId, sessionId });
  if (entries === null) return null;
  // A player sees nothing until the read says the bars are theirs (no "Loading" flash with the setting off).
  if (entries === undefined && !isGm) return null;
  return <SpotlightCard campaignId={campaignId} sessionId={sessionId} isGm={isGm} entries={entries} />;
}

function SpotlightCard({ campaignId, sessionId, isGm, entries }: SpotlightProps & { entries: SpotlightEntry[] | undefined }) {
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
        isGm && entries !== undefined && entries.length > 0 ? (
          <BrandButton variant="neutral" size="sm" disabled={max === 0} onClick={onReset}>
            Reset
          </BrandButton>
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
