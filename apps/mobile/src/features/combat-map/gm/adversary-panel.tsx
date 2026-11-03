import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { type Id } from "../../../convex";
import { Button } from "../../../ui/button";
import { Panel, QueryLoading } from "../../dashboard/chrome";

import { useCombatGm } from "./context";
import { useAdversaryActions } from "./use-adversary-actions";
import { gmStyles } from "./styles";

export function CombatGmAdversary() {
  const { campaignId, tokens, encounters } = useCombatGm();
  const [picked, setPicked] = useState<Id<"combatTokens"> | null>(null);
  const acts = useAdversaryActions(campaignId);

  const running = encounters?.active.find((e) => e.status === "running") ?? null;
  const adversaries = (tokens ?? []).filter((t) => t.kind === "adversary");
  const pcs = (tokens ?? []).filter((t) => t.kind === "pc" && t.characterId !== undefined);
  const token = adversaries.find((t) => t._id === picked) ?? null;

  async function attack() {
    if (!token?.instanceId || pcs.length === 0) return;
    const target = pcs[0]!;
    await acts.fire({
      kind: "attack",
      actor: token.name,
      label: `${token.name} attacks`,
      args: {
        instanceId: token.instanceId,
        targets: [target.characterId!],
      },
    });
  }

  return (
    <Panel title="Adversary actions">
      <QueryLoading label="Loading adversaries" value={tokens} />
      {tokens === undefined ? null : (
        <>
          {running ? (
            <Text style={gmStyles.muted}>Running: {running.name}</Text>
          ) : (
            <Text style={gmStyles.muted} testID="adversary-hint">
              No encounter is running. Start one on Adversaries.
            </Text>
          )}
          <View style={gmStyles.row}>
            {adversaries.length === 0 ? <Text style={gmStyles.muted}>No adversary tokens on the map.</Text> : null}
            {adversaries.map((t) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: picked === t._id }}
                key={t._id}
                onPress={() => setPicked(t._id)}
                style={[gmStyles.chip, picked === t._id ? gmStyles.chipOn : null]}
              >
                <Text style={gmStyles.chipText}>{t.name}</Text>
              </Pressable>
            ))}
          </View>
          {token && running && token.instanceId ? (
            <Button disabled={acts.pending || pcs.length === 0} onPress={() => void attack()} variant="outline">
              {`Attack ${pcs[0]?.name ?? "PC"}`}
            </Button>
          ) : null}
          {acts.confirm ? (
            <View style={gmStyles.panel}>
              <Text style={gmStyles.muted}>{`Spend ${acts.confirm.fear.fear} Fear?`}</Text>
              <View style={gmStyles.row}>
                <Button onPress={() => void acts.spend()} variant="outline">
                  Spend Fear
                </Button>
                <Button onPress={() => acts.cancel()} variant="outline">
                  Cancel
                </Button>
              </View>
            </View>
          ) : null}
          {acts.error ? (
            <Text accessibilityRole="alert" style={gmStyles.error}>
              {acts.error}
            </Text>
          ) : null}
        </>
      )}
    </Panel>
  );
}
