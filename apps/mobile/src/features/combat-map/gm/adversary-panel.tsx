import { useState } from "react";
import { Text, View } from "react-native";

import { type Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { Button } from "../../../ui/button";
import { Panel, QueryLoading } from "../../dashboard/chrome";
import { earlierText } from "../../sheet/dice/roll-copy";

import { Chip, ChipRow } from "../chip";
import { useCombatGm } from "./context";
import { useAdversaryActions, type Resolved } from "./use-adversary-actions";
import { gmStyles } from "./styles";

/** The GM's line for one target of a resolved attack: hit or miss, the damage waiting for the PC's answer. */
function targetLine(t: Resolved["targets"][number], name: string): string {
  if (!t.hit) return `${name}: Miss`;
  const dmg = t.damage !== undefined ? ` · ${t.damage} damage` : "";
  const state = t.deathMove ? " · their death move is due" : t.resolved ? "" : " · waiting for their answer";
  return `${name}: Hit${dmg}${state}`;
}

/**
 * An adversary's standard attack from the phone (CB p.160; dcm-gdzi.17): pick the attacking adversary token (one of
 * the running encounter), pick the PC it attacks (one target, CB p.161, unless a feature says otherwise), Attack.
 * Fear asked for first comes back as a confirmation (Q19). The result shows the roll and Hit / Miss per target.
 */
export function CombatGmAdversary() {
  const { campaignId, tokens, encounters } = useCombatGm();
  const writes = useWritesEnabled();
  const [attackerId, setAttackerId] = useState<Id<"combatTokens"> | null>(null);
  const [targetId, setTargetId] = useState<Id<"characters"> | null>(null);
  const [result, setResult] = useState<Resolved | null>(null);
  const acts = useAdversaryActions(campaignId);

  const running = encounters?.active.find((e) => e.status === "running") ?? null;
  const adversaries = (tokens ?? []).filter((t) => t.kind === "adversary" && t.instanceId !== undefined);
  const pcs = (tokens ?? []).filter((t): t is typeof t & { characterId: Id<"characters"> } => t.kind === "pc" && t.characterId !== undefined);
  const attacker = adversaries.find((t) => t._id === attackerId) ?? null;
  const target = pcs.find((t) => t.characterId === targetId) ?? null;
  const pcName = (id: string | undefined) => pcs.find((p) => p.characterId === id)?.name ?? "PC";

  function shown(answer: Awaited<ReturnType<typeof acts.fire>>) {
    if (answer && answer.status === "resolved") setResult(answer);
  }

  async function attack() {
    if (!attacker?.instanceId || !target) return;
    setResult(null);
    shown(
      await acts.fire({
        kind: "attack",
        actor: attacker.name,
        label: `${attacker.name} attacks ${target.name}`,
        args: { instanceId: attacker.instanceId, targets: [target.characterId] },
      }),
    );
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
          <Text style={gmStyles.muted}>Attacker:</Text>
          {adversaries.length === 0 ? <Text style={gmStyles.muted}>No adversary tokens on the map.</Text> : null}
          <ChipRow label="Attacking adversary">
            {adversaries.map((t) => (
              <Chip key={t._id} label={t.name} onPress={() => setAttackerId(attackerId === t._id ? null : t._id)} selected={attackerId === t._id} testID={`combat-adversary-${t._id}`} />
            ))}
          </ChipRow>
          {attacker ? (
            <>
              <Text style={gmStyles.muted}>Target:</Text>
              {pcs.length === 0 ? <Text style={gmStyles.muted}>No PC tokens on the map.</Text> : null}
              <ChipRow label="Attack target">
                {pcs.map((p) => (
                  <Chip
                    accessibilityLabel={`Target ${p.name}`}
                    key={p.characterId}
                    label={p.name}
                    onPress={() => setTargetId(targetId === p.characterId ? null : p.characterId)}
                    selected={targetId === p.characterId}
                    testID={`combat-adversary-target-${p.characterId}`}
                  />
                ))}
              </ChipRow>
            </>
          ) : null}
          {attacker && running ? (
            <Button disabled={!writes || acts.pending || !target} onPress={() => void attack()} variant="outline">
              {target ? `${attacker.name} attacks ${target.name}` : "Pick a target"}
            </Button>
          ) : null}
          {acts.confirm ? (
            <View style={gmStyles.panel}>
              <Text style={gmStyles.muted}>{`Spend ${acts.confirm.fear.fear} Fear?`}</Text>
              <View style={gmStyles.row}>
                <Button disabled={!writes || acts.pending} onPress={() => void acts.spend().then(shown)} variant="outline">
                  Spend Fear
                </Button>
                <Button onPress={() => acts.cancel()} variant="outline">
                  Cancel
                </Button>
              </View>
            </View>
          ) : null}
          {result ? (
            <View accessibilityLiveRegion="polite" style={gmStyles.panel} testID="combat-adversary-result">
              <Text style={gmStyles.chipText}>{result.roll ? earlierText(result.roll) : result.success ? "Success" : "No roll"}</Text>
              {result.targets.map((t, i) => (
                <Text key={`${t.characterId ?? t.instanceId ?? i}`} style={gmStyles.muted}>
                  {targetLine(t, pcName(t.characterId))}
                </Text>
              ))}
              {result.prompts.map((p, i) => (
                <Text key={`p${i}`} style={gmStyles.muted}>
                  {p.text}
                </Text>
              ))}
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
