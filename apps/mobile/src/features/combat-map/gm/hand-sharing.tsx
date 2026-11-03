import { useMutation } from "convex/react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { errorMessage } from "../../../../../../src/lib/convex-errors";
import { api } from "../../../convex";
import { Panel, QueryLoading } from "../../dashboard/chrome";

import { useCombatGm } from "./context";
import { gmStyles } from "./styles";

export function CombatGmHandSharing() {
  const { campaignId, handSharing: sharing } = useCombatGm();
  const set = useMutation(api.campaigns.setPlayersSeeHands);
  const [error, setError] = useState<string | null>(null);

  async function flip(enabled: boolean) {
    setError(null);
    try {
      await set({ campaignId, enabled });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Panel title="Hands">
      <QueryLoading label="Loading hand sharing" value={sharing} />
      {sharing === undefined ? null : (
        <View accessibilityLabel="Hand sharing" testID="combat-hand-sharing">
          <Pressable
            accessibilityLabel="Players can see each other's cards"
            accessibilityRole="switch"
            accessibilityState={{ checked: sharing.playersSeeHands }}
            onPress={() => void flip(!sharing.playersSeeHands)}
            style={gmStyles.row}
          >
            <Text style={gmStyles.chipText}>
              {sharing.playersSeeHands ? "On" : "Off"} · Players can see each other&apos;s cards
            </Text>
          </Pressable>
          <Text style={gmStyles.muted}>You always see every hand on the website and here.</Text>
          {error ? (
            <Text accessibilityRole="alert" style={gmStyles.error}>
              {error}
            </Text>
          ) : null}
        </View>
      )}
    </Panel>
  );
}
