import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { api, type Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { useIntent } from "../../sheet/dice/intent";

import { dockText } from "../chip";
import { addMinion, minionIds, type MinionOffer, type ResultView } from "./results";

/** The last attack's or card's outcome (dcm-gdzi.16): the player's dice, Hit / Miss per target, damage, waiting. */
export function ResultCard({ view, onDismiss, testID }: { view: ResultView; onDismiss: () => void; testID?: string }) {
  return (
    <View accessibilityLiveRegion="polite" style={[styles.card, view.tone === "waiting" ? styles.waiting : view.tone === "hit" ? styles.hit : null]} testID={testID}>
      <Text accessibilityRole="header" style={dockText.title}>
        {view.headline}
      </Text>
      {view.lines.map((line, i) => (
        // The lines are a fixed list for this result (a new result replaces the card).
        <Text key={`${i}-${line}`} style={dockText.body}>
          {line}
        </Text>
      ))}
      <Button accessibilityLabel="Dismiss result" onPress={onDismiss} variant="outline">
        OK
      </Button>
    </View>
  );
}

/**
 * The extra Minions the attacker picks (Q6, CB p.201 "Minion (X)": "let them choose which Minions they defeat"):
 * one stepper per candidate, at most `extra` in all; Done sends `combatActions.pickMinions` (an empty pick passes).
 * The GM's queue uses it too (rule switches D6 "GM picks", and Resolve now).
 */
export function MinionPicker({
  campaignId,
  entryId,
  offer,
  title,
  onDone,
}: {
  campaignId: Id<"campaigns">;
  entryId: Id<"actionLog">;
  offer: Pick<MinionOffer, "extra" | "candidates">;
  title?: string;
  onDone: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const pick = useIntent(api.combatActions.pickMinions);
  const writes = useWritesEnabled();
  const chosen = minionIds(counts);

  async function done() {
    const out = await pick.fire({ campaignId, entryId, instanceIds: chosen as Id<"encounterAdversaries">[] });
    if (out !== undefined) onDone();
  }

  return (
    <View style={styles.card} testID="combat-minion-picker">
      <Text accessibilityRole="header" style={dockText.title}>
        {title ?? `Defeat ${offer.extra} more Minion${offer.extra === 1 ? "" : "s"}`}
      </Text>
      <Text style={dockText.hint}>{`${chosen.length} of ${offer.extra} picked`}</Text>
      {offer.candidates.map((c) => (
        <View key={c.instanceId} style={styles.row}>
          <Text style={[dockText.body, styles.grow]}>{`${c.name} · ${counts[c.instanceId] ?? 0}/${c.available}`}</Text>
          <Button accessibilityLabel={`One fewer from ${c.name}`} onPress={() => setCounts((n) => addMinion(offer, n, c.instanceId, -1))} variant="outline">
            −
          </Button>
          <Button accessibilityLabel={`One more from ${c.name}`} onPress={() => setCounts((n) => addMinion(offer, n, c.instanceId, 1))} variant="outline">
            +
          </Button>
        </View>
      ))}
      <Button accessibilityLabel="Defeat the picked Minions" disabled={!writes || pick.pending} onPress={() => void done()} variant="solid">
        {chosen.length === 0 ? "Pass" : "Defeat them"}
      </Button>
      {pick.error ? (
        <Text accessibilityRole="alert" style={dockText.error}>
          {pick.error}
        </Text>
      ) : null}
    </View>
  );
}

/** An attack held after its roll (SD5, CB p.107): use one of the offered features on the roll, or pass. */
export function AfterRollOffer({
  campaignId,
  requestId,
  options,
  onDone,
}: {
  campaignId: Id<"campaigns">;
  requestId: Id<"combatRequests">;
  options: readonly { featureId: string; useId: string; name: string; costs: readonly string[] }[];
  onDone: (result: FunctionReturnType<typeof api.combatActions.afterRoll>) => void;
}) {
  const answer = useIntent(api.combatActions.afterRoll);
  const writes = useWritesEnabled();

  async function send(choice: { kind: "pass" } | { kind: "use"; featureId: string; useId: string; choices: [] }) {
    const out = await answer.fire({ campaignId, requestId, choice });
    if (out !== undefined) onDone(out);
  }

  return (
    <View style={styles.row} testID="combat-after-roll">
      {options.map((o) => (
        <Button
          accessibilityLabel={`Use ${o.name}`}
          disabled={!writes || answer.pending}
          key={`${o.featureId}:${o.useId}`}
          onPress={() => void send({ kind: "use", featureId: o.featureId, useId: o.useId, choices: [] })}
         
          variant="outline"
        >
          {o.costs.length > 0 ? `${o.name} (${o.costs.join(", ")})` : o.name}
        </Button>
      ))}
      <Button accessibilityLabel="Pass on the roll" disabled={!writes || answer.pending} onPress={() => void send({ kind: "pass" })} variant="outline">
        Pass
      </Button>
      {answer.error ? (
        <Text accessibilityRole="alert" style={dockText.error}>
          {answer.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.raised,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  hit: { borderColor: colors.okLine },
  waiting: { borderColor: colors.violet },
  row: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  grow: { flexGrow: 1, flexShrink: 1 },
});
