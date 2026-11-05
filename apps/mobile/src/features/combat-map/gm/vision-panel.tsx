import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api, type Id } from "../../../convex";
import { Button } from "../../../ui/button";
import { WriteButton } from "../../../shell/offline";
import { Panel, QueryLoading } from "../../dashboard/chrome";

import { useCombatGm } from "./context";
import { gmStyles } from "./styles";

function pcTokens(tokens: { kind: string; name: string; characterId?: Id<"characters"> }[] | undefined) {
  return (tokens ?? []).filter((t): t is typeof t & { characterId: Id<"characters"> } => t.kind === "pc" && t.characterId !== undefined);
}

export function CombatGmVision() {
  const { campaignId, layout, tokens, doors } = useCombatGm();
  const mapId = layout._id;
  const [previewId, setPreviewId] = useState<Id<"characters"> | null>(null);
  const preview = useQuery(
    api.combatVision.previewAs,
    previewId ? { campaignId, characterId: previewId, mapId } : "skip",
  );
  const paintFog = useMutation(api.combatVision.paintFog);
  const toggleDoor = useMutation(api.combatVision.toggleDoor);
  const [selectedTokenId, setSelectedTokenId] = useState<Id<"combatTokens"> | null>(null);
  const revealTo = useMutation(api.combatVision.revealTo);
  const pcs = pcTokens(tokens);

  async function fogMark(mark: "reveal" | "hide") {
    await paintFog({
      campaignId,
      mapId,
      squares: [0],
      mark,
    });
  }

  return (
    <Panel title="Vision & fog">
      <QueryLoading label="Loading vision tools" value={tokens} />
      {tokens === undefined ? null : (
        <>
          <Text style={gmStyles.muted}>Preview a PC view (same query as the website).</Text>
          <View style={gmStyles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: previewId === null }}
              onPress={() => setPreviewId(null)}
              style={[gmStyles.chip, previewId === null ? gmStyles.chipOn : null]}
            >
              <Text style={[gmStyles.chipText, previewId === null ? gmStyles.chipTextOn : null]}>GM view</Text>
            </Pressable>
            {pcs.map((p) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: previewId === p.characterId }}
                key={p.characterId}
                onPress={() => setPreviewId(p.characterId)}
                style={[gmStyles.chip, previewId === p.characterId ? gmStyles.chipOn : null]}
              >
                <Text style={[gmStyles.chipText, previewId === p.characterId ? gmStyles.chipTextOn : null]}>{p.name}</Text>
              </Pressable>
            ))}
          </View>
          {previewId && preview?.state === "ok" ? (
            <Text style={gmStyles.muted} testID="combat-preview-loaded">
              {`Previewing ${pcs.find((t) => t.characterId === previewId)?.name ?? "PC"}.`}
            </Text>
          ) : null}
          <View style={gmStyles.row}>
            <WriteButton onPress={() => void fogMark("reveal")} variant="outline">
              Reveal corner
            </WriteButton>
            <WriteButton onPress={() => void fogMark("hide")} variant="outline">
              Hide corner
            </WriteButton>
          </View>
          {doors?.doors.length ? (
            <View style={gmStyles.row}>
              {doors.doors.slice(0, 3).map((d) => (
                <Button
                  key={d._id}
                  onPress={() => void toggleDoor({ campaignId, objectId: d._id, open: !d.open })}
                  variant="outline"
                >
                  {d.open ? "Close door" : "Open door"}
                </Button>
              ))}
            </View>
          ) : null}
          <Text style={gmStyles.muted}>Reveal a hidden token to a PC:</Text>
          <View style={gmStyles.row}>
            {(tokens ?? [])
              .filter((t) => t.kind !== "pc")
              .slice(0, 4)
              .map((t) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedTokenId === t._id }}
                  key={t._id}
                  onPress={() => setSelectedTokenId(t._id)}
                  style={[gmStyles.chip, selectedTokenId === t._id ? gmStyles.chipOn : null]}
                >
                  <Text style={gmStyles.chipText}>{t.name}</Text>
                </Pressable>
              ))}
          </View>
          {selectedTokenId && pcs[0] ? (
            <Button
              onPress={() =>
                void revealTo({
                  campaignId,
                  tokenId: selectedTokenId,
                  characterId: pcs[0]!.characterId,
                })
              }
              variant="outline"
            >
              {`Reveal to ${pcs[0].name}`}
            </Button>
          ) : null}
        </>
      )}
    </Panel>
  );
}
