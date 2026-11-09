import { useQuery } from "convex/react";
import { useState } from "react";
import { Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { leastSpotlightLine } from "../../../../../src/lib/domain/journal";
import { barPercent, resetPending, tallyTiles } from "../../../../../src/lib/journal/tally";
import type { SpotlightEntry } from "../../../../../convex/sessionPlay";
import { api, type Id } from "../../convex";
import { useOptimistic } from "./optimistic";
import { js } from "./styles";
import { ActButton, Card, ErrorLine, LoadingLine } from "./ui";

type Ids = { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> };

/**
 * Session tally and Spotlight (website: src/components/journal/tally). The tally tiles are GM only (journal Q5; the
 * screen mounts them for the GM, `journalTally.tally` is a GM query). The spotlight bars and the least-spotlight line
 * are the GM's, and the players' too when the table setting "Show spotlight balance to players" is on: the server
 * returns null otherwise and nothing renders. Reset is the GM's. Automatic only (Q9): no tapping a bar.
 */
export function SessionTally({ ids }: { ids: Ids }) {
  const tally = useQuery(api.journalTally.tally, ids);
  return (
    <Card heading="Session tally">
      {tally === undefined ? (
        <LoadingLine>Loading the tally…</LoadingLine>
      ) : (
        <>
          <View accessibilityLabel="Session tally counts" style={js.tiles}>
            {tallyTiles(tally.fearHidden).map(({ key, label }) => {
              const value = tally[key];
              return (
                <View key={key} accessibilityLabel={`${label}: ${value === null ? "none yet" : value}`} accessible style={js.tile}>
                  <Text style={js.tileN}>{value === null ? "-" : String(value)}</Text>
                  <Text style={js.tileL}>{label}</Text>
                </View>
              );
            })}
          </View>
          {tally.fearGained === null ? <Text style={js.muted}>Counts itself once the session starts.</Text> : null}
          {tally.truncated ? <Text style={js.muted}>A very busy session: these are at least the counts shown.</Text> : null}
        </>
      )}
    </Card>
  );
}

export function Spotlight({ ids, isGm }: { ids: Ids; isGm: boolean }) {
  const entries = useQuery(api.journalTally.spotlight, ids);
  if (entries === null) return null;
  // A player sees nothing until the read says the bars are theirs (no loading flash with the setting off).
  if (entries === undefined && !isGm) return null;
  return <SpotlightCard entries={entries} ids={ids} isGm={isGm} />;
}

function SpotlightCard({ ids, isGm, entries }: { ids: Ids; isGm: boolean; entries: SpotlightEntry[] | undefined }) {
  const reset = useOptimistic(api.sessionPlay.resetSpotlight, resetPending);
  const [error, setError] = useState<string | null>(null);
  const max = Math.max(0, ...(entries ?? []).map((e) => e.count));
  const line = entries === undefined ? null : leastSpotlightLine(entries);

  function onReset() {
    setError(null);
    reset(ids).catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <Card
      actions={
        isGm && entries !== undefined && entries.length > 0 ? (
          <ActButton accessibilityLabel="Reset spotlight" disabled={max === 0} onPress={onReset}>
            Reset
          </ActButton>
        ) : null
      }
      heading="Spotlight"
    >
      {entries === undefined ? (
        <LoadingLine>Loading the spotlight…</LoadingLine>
      ) : entries.length === 0 ? (
        <Text style={js.muted}>No active characters in the party yet.</Text>
      ) : (
        <View accessibilityLabel="Spotlight per character" style={{ gap: 6 }}>
          {entries.map((e) => (
            <View
              key={e.characterId}
              accessibilityLabel={`${e.name}: ${e.count} spotlight ${e.count === 1 ? "moment" : "moments"}`}
              accessible
              style={js.barRow}
            >
              <View style={js.initial}>
                <Text style={js.badgeText}>{e.name.charAt(0).toUpperCase()}</Text>
              </View>
              <Text numberOfLines={1} style={js.barName}>
                {e.name}
              </Text>
              <View style={js.track}>
                <View style={[js.fill, { width: `${barPercent(e.count, max)}%` }]} />
              </View>
              <Text style={js.count}>{String(e.count)}</Text>
            </View>
          ))}
        </View>
      )}
      {line ? <Text style={js.muted}>{line}</Text> : null}
      <ErrorLine error={error} />
    </Card>
  );
}
