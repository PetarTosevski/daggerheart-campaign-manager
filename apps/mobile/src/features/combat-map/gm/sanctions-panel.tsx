import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import { Text, View } from "react-native";

import { errorMessage } from "../../../../../../src/lib/convex-errors";
import { api } from "../../../convex";
import { Button } from "../../../ui/button";
import { Panel, QueryLoading } from "../../dashboard/chrome";
import { newKey } from "../../adversaries/intent";

import { useCombatGm } from "./context";
import { gmStyles } from "./styles";

type MineRow = FunctionReturnType<typeof api.combatRequests.mine>[number];
type SanctionRow = Extract<MineRow, { kind: "sanction" }>;

export function CombatGmSanctions() {
  const { campaignId, requests: rows } = useCombatGm();
  const sanction = useMutation(api.combatRequests.sanction);
  const waiting = (rows ?? []).filter((r): r is SanctionRow => r.kind === "sanction");

  return (
    <Panel title="Out of range">
      <QueryLoading label="Loading combat requests" value={rows} />
      {rows === undefined ? null : waiting.length === 0 ? (
        <Text style={gmStyles.muted}>No attacks waiting for your call.</Text>
      ) : (
        waiting.map((r) => (
          <View key={r.requestId} style={gmStyles.mapRow}>
            <Text style={gmStyles.chipText}>
              {r.characterName} → {r.targets.map((t) => t.name).join(", ")}
            </Text>
            <View style={gmStyles.row}>
              <Button
                onPress={() =>
                  void sanction({
                    campaignId,
                    requestId: r.requestId,
                    approve: true,
                    idempotencyKey: newKey(),
                  }).catch((e) => console.warn(errorMessage(e)))
                }
                variant="outline"
              >
                Allow
              </Button>
              <Button
                onPress={() =>
                  void sanction({
                    campaignId,
                    requestId: r.requestId,
                    approve: false,
                    idempotencyKey: newKey(),
                  }).catch((e) => console.warn(errorMessage(e)))
                }
                variant="outline"
              >
                Decline
              </Button>
            </View>
          </View>
        ))
      )}
    </Panel>
  );
}
