import { useMutation } from "convex/react";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { optionsFor } from "../../../../../src/lib/frames/options";
import type { FrameId } from "../../../../../src/lib/frames";
import { api, type Id } from "../../convex";
import type { LoadedCampaign } from "../../shell/campaign-provider";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type as textType } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";
import { AlertLine } from "./chrome";
import { useIntent } from "./intent";

export function EndScene({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  if (!isGm) return null;
  return <EndSceneControls campaignId={campaignId} />;
}

function EndSceneControls({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const end = useIntent(api.scenes.end);
  const writes = useWritesEnabled();
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  async function run() {
    setConfirm(false);
    setReport(null);
    const result = await end.fire({ campaignId });
    if (!result) return;
    setReport(
      result.ended > 0
        ? `Scene ended: ${result.ended} scene effect${result.ended === 1 ? "" : "s"} ended.`
        : "Scene ended. No scene effects were active.",
    );
  }

  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={styles.title}>
        Scene
      </Text>
      <Text style={styles.body}>A scene lasts until its narrative situation has played out.</Text>
      <Button accessibilityLabel="End scene" disabled={!writes} onPress={() => setConfirm(true)} variant="outline">
        End scene
      </Button>
      <Sheet onClose={() => setConfirm(false)} open={confirm} title="End the scene?">
        <Text style={styles.body}>Effects that last until the end of the scene end on every PC.</Text>
        <Button accessibilityLabel="Confirm end scene" disabled={!writes} onPress={() => void run()} variant="primary">
          End scene
        </Button>
      </Sheet>
      <AlertLine message={end.error ?? report} />
    </View>
  );
}

export function FrameRules({ campaign }: { campaign: LoadedCampaign }) {
  if (campaign.role !== "gm") return null;
  return <FrameRulesEditor campaign={campaign} />;
}

function FrameRulesEditor({ campaign }: { campaign: LoadedCampaign }) {
  const setOption = useMutation(api.campaigns.setOption);
  const writes = useWritesEnabled();
  const [error, setError] = useState<string | null>(null);
  const available = optionsFor(campaign.frameId as FrameId);
  if (available.length === 0) return null;
  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={styles.title}>
        Campaign Rules
      </Text>
      {available.map((option) => {
        const enabled = campaign.options[option.id];
        return (
          <View key={option.id} style={styles.rule}>
            <Text style={styles.body}>{option.label}</Text>
            <Text style={styles.hint}>{option.description}</Text>
            <Button
              accessibilityLabel={option.label}
              disabled={!writes}
              onPress={() => {
                setError(null);
                Promise.resolve(
                  setOption({ campaignId: campaign._id, option: option.id, enabled: !enabled }),
                ).catch(() => setError("That rule could not be saved."));
              }}
              variant={enabled ? "primary" : "outline"}
            >
              {enabled ? "On" : "Off"}
            </Button>
          </View>
        );
      })}
      <AlertLine message={error} />
    </View>
  );
}

export function NewCountdownForm({
  campaignId,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  onClose: () => void;
}) {
  const create = useIntent(api.countdowns.create);
  const writes = useWritesEnabled();
  const [name, setName] = useState("");
  const [starting, setStarting] = useState("6");
  const value = Number.parseInt(starting, 10);
  const ready = name.trim().length > 0 && Number.isInteger(value) && value >= 1 && value <= 20;
  return (
    <View style={styles.block}>
      <TextInput
        accessibilityLabel="Countdown name"
        onChangeText={setName}
        placeholder="Name"
        placeholderTextColor={colors.subtle}
        style={styles.input}
        value={name}
      />
      <TextInput
        accessibilityLabel="Starting value"
        keyboardType="number-pad"
        onChangeText={setStarting}
        placeholder="Start"
        placeholderTextColor={colors.subtle}
        style={styles.input}
        value={starting}
      />
      <Button
        accessibilityLabel="Create countdown"
        disabled={!writes || !ready}
        onPress={() => {
          void create
            .fire({
              campaignId,
              name: name.trim(),
              description: "",
              category: "other",
              startingValue: value,
              consequence: "",
            })
            .then((result) => {
              if (result) onClose();
            });
        }}
        variant="primary"
      >
        Create countdown
      </Button>
      <AlertLine message={create.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space[2],
  },
  title: {
    color: colors.parchment,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: textType.displayBold.fontWeight,
  },
  body: {
    color: colors.body,
    fontFamily: textType.sans.fontFamily,
    fontSize: 15,
    fontWeight: textType.sans.fontWeight,
  },
  hint: {
    color: colors.subtle,
    fontFamily: textType.sans.fontFamily,
    fontSize: 13,
    fontWeight: textType.sans.fontWeight,
  },
  rule: {
    gap: space[1],
  },
  input: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: textType.sans.fontFamily,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: space[3],
  },
});
