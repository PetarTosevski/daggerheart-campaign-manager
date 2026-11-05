import { useState } from "react";
import { Text } from "react-native";

import { useMutation } from "convex/react";
import { randomUUID } from "expo-crypto";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { api } from "../../convex";
import type { Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { Button } from "../../ui/button";

/** The GM's party level-up. Hidden for a player, so the player tree never calls it. */
export function PartyLevelUp({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const levelUp = useMutation(api.levelUp.partyLevelUp);
  const writes = useWritesEnabled();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!isGm) return null;

  async function press() {
    setError(null);
    setNotice(null);
    try {
      const result = await levelUp({ campaignId, idempotencyKey: randomUUID() });
      const flagged = result?.flagged ?? 0;
      setNotice(flagged === 1 ? "1 character can level up." : `${flagged} characters can level up.`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <>
      <Button disabled={!writes} onPress={() => void press()} variant="primary">
        Party levels up
      </Button>
      {notice ? <Text style={{ color: colors.body, fontFamily: type.sans.fontFamily, fontSize: 15 }}>{notice}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontFamily: type.sans.fontFamily, fontSize: 15 }}>
          {error}
        </Text>
      ) : null}
    </>
  );
}
