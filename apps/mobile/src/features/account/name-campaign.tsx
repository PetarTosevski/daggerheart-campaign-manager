import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import type { FrameId } from "../../../../../src/lib/frames";
import { CAMPAIGN_NAME_MAX } from "../../../../../src/lib/validation/campaigns";
import { colors } from "../../theme/colors";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";
import { useCreateCampaign } from "./create-campaign";
import { accountStyles } from "./styles";

export function NameCampaignSheet({
  frameId,
  frameLabel,
  open,
  onClose,
}: {
  frameId: FrameId;
  frameLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const { submit, pending, error } = useCreateCampaign();
  const [name, setName] = useState("");

  return (
    <Sheet open={open} onClose={onClose} title="Name your campaign">
      <View style={styles.form}>
        <Text style={accountStyles.body}>
          A new campaign in <Text style={styles.emphasis}>{frameLabel}</Text>, starting at session zero.
        </Text>
        <Text style={accountStyles.label}>Campaign name</Text>
        <TextInput
          accessibilityLabel="Campaign name"
          autoFocus
          maxLength={CAMPAIGN_NAME_MAX}
          onChangeText={setName}
          placeholder="Name your campaign"
          placeholderTextColor={colors.faint}
          style={accountStyles.input}
          value={name}
        />
        {error ? (
          <Text accessibilityRole="alert" style={accountStyles.error}>
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button onPress={onClose} size="lg" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={pending || name.trim().length === 0}
            onPress={() => void submit({ frameId, name: name.trim() })}
            size="lg"
            variant="primary"
          >
            {pending ? "Creating…" : "Start campaign"}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
    justifyContent: "flex-end",
  },
  emphasis: {
    color: colors.parchment,
  },
  form: {
    gap: space[4],
  },
});
