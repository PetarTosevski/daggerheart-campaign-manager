import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { api } from "../../../convex";
import { Button } from "../../../ui/button";
import { Panel, QueryLoading } from "../../dashboard/chrome";
import { newKey } from "../../adversaries/intent";

import { useCombatGm } from "./context";
import { gmStyles } from "./styles";

const CONFIRM_MS = 3000;

export function CombatGmCombatants() {
  const { campaignId, layout, combatants: info, tokens } = useCombatGm();
  const mapId = layout._id;
  const addParty = useMutation(api.combatTokens.addParty);
  const place = useMutation(api.combatTokens.placeAdversaries);
  const addCustom = useMutation(api.combatTokens.addCustom);
  const clear = useMutation(api.combatTokens.clear);
  const [confirmClear, setConfirmClear] = useState(false);
  const [name, setName] = useState("");
  const [hp, setHp] = useState("3");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  async function run(call: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await call();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  }

  const loading = info === undefined || tokens === undefined;

  return (
    <Panel title="Combatants">
      <QueryLoading label="Loading combatants" value={loading ? undefined : info} />
      {loading ? null : (
        <>
          <Text accessibilityLabel="Token count" style={gmStyles.muted} testID="combat-token-count">
            {tokens.length === 0
              ? "None placed"
              : `${tokens.filter((t) => t.side === "pc").length} party · ${tokens.filter((t) => t.side === "enemy").length} enemies`}
          </Text>
          <View style={gmStyles.row}>
            <Button
              disabled={pending || info.partyLeft === 0}
              onPress={() => void run(() => addParty({ campaignId, mapId, idempotencyKey: newKey() }))}
              variant="outline"
            >
              {`+ Party (${info.partyLeft})`}
            </Button>
            {info.queue[0] ? (
              <Button
                disabled={pending}
                onPress={() =>
                  void run(() =>
                    place({
                      campaignId,
                      mapId,
                      instanceIds: [info.queue[0]!.instanceId],
                      idempotencyKey: newKey(),
                    }),
                  )
                }
                variant="outline"
              >
                {`Place ${info.queue[0].name}`}
              </Button>
            ) : null}
          </View>
          <View style={gmStyles.row}>
            <TextInput
              accessibilityLabel="Custom token name"
              onChangeText={setName}
              placeholder="Custom name"
              style={gmStyles.chip}
              value={name}
            />
            <TextInput
              accessibilityLabel="Custom token hit points"
              keyboardType="number-pad"
              onChangeText={setHp}
              placeholder="HP"
              style={[gmStyles.chip, { minWidth: 64 }]}
              value={hp}
            />
            <Button
              disabled={pending || name.trim() === ""}
              onPress={() => {
                const points = Number(hp);
                if (!Number.isInteger(points) || points < 0 || points > 99) {
                  setError("Hit Points must be 0–99.");
                  return;
                }
                void run(async () => {
                  await addCustom({
                    campaignId,
                    mapId,
                    name: name.trim(),
                    hp: points,
                    side: "enemy",
                    idempotencyKey: newKey(),
                  });
                  setName("");
                });
              }}
              variant="outline"
            >
              Add custom
            </Button>
          </View>
          <Button
            disabled={pending || tokens.length === 0}
            onPress={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              void run(() => clear({ campaignId, mapId }));
              setConfirmClear(false);
            }}
            variant="outline"
          >
            {confirmClear ? "Confirm clear tokens" : "Clear tokens"}
          </Button>
          {error ? (
            <Text accessibilityRole="alert" style={gmStyles.error}>
              {error}
            </Text>
          ) : null}
        </>
      )}
    </Panel>
  );
}
