import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { choseLine, myPicks, pickSub, waitingOn, waitingRows, withAnswered } from "../../../../../src/components/combat-map/hud/ally-picks/model";
import { errorMessage } from "../../../../../src/lib/convex-errors";

import { api, type Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { radius, space } from "../../theme/spacing";
import { newKey } from "../adversaries/intent";
import { withOptimistic } from "../adversaries/use-tracker";

import { Chip, ChipRow, dockText } from "./chip";

/**
 * Per-ally picks (FH-AP, user 2026-11-05; Rousing Strike, Critical Inspiration): the picks waiting on the caller's
 * characters, each a card with its options (`allyPicks.answer`, keyed, the pick shown answered at once), and the
 * caller's own uses still waiting on others ("1 of 2 chose · waiting on Bryn"). The GM gets every outstanding pick
 * (a no-show) the same way. The server decides who may answer (`mine`); the model is the website's.
 */
export function AllyPicks({ campaignId, gm }: { campaignId: Id<"campaigns">; gm: boolean }) {
  const rows = useQuery(api.allyPicksReads.open, { campaignId });
  const answer = withOptimistic(useMutation(api.allyPicks.answer), (store, args) => {
    const open = store.getQuery(api.allyPicksReads.open, { campaignId });
    if (open !== undefined) store.setQuery(api.allyPicksReads.open, { campaignId }, withAnswered(open, args.requestId, args.stepId, args.chooserId));
  });
  const writes = useWritesEnabled();
  const inFlight = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (rows === undefined || rows.length === 0) return null;
  const mine = myPicks(rows);
  const waiting = waitingRows(rows);
  if (mine.length === 0 && waiting.length === 0) return null;

  async function pick(requestId: Id<"combatRequests">, stepId: string, chooserId: string, option: string) {
    const key = `${requestId}:${stepId}:${chooserId}`;
    if (inFlight.current !== null) return;
    inFlight.current = key;
    setError(null);
    try {
      await answer({ campaignId, requestId, stepId, chooserId, options: [option], idempotencyKey: newKey() });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      inFlight.current = null;
    }
  }

  return (
    <View accessibilityLabel="Ally picks" style={styles.wrap} testID="combat-ally-picks">
      {mine.map((p) => (
        <View key={p.key} style={styles.card} testID={`combat-ally-pick-${p.key}`}>
          <Text accessibilityRole="header" style={dockText.title}>
            {p.chooser.label}
          </Text>
          <Text style={dockText.hint}>{pickSub(p, gm)}</Text>
          <ChipRow label={p.chooser.label}>
            {p.chooser.options.map((o) => (
              <Chip disabled={!writes} key={o.id} label={o.label} onPress={() => void pick(p.row.requestId, p.chooser.stepId, p.chooser.chooserId, o.id)} />
            ))}
          </ChipRow>
        </View>
      ))}
      {waiting.map((row) => (
        <Text key={row.requestId} style={dockText.hint}>{`${row.name} · ${choseLine(row)} · waiting on ${waitingOn(row)}`}</Text>
      ))}
      {error ? (
        <Text accessibilityRole="alert" style={dockText.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  card: {
    backgroundColor: colors.raised,
    borderColor: colors.violet,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
});
