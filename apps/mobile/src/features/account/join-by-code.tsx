import { useMutation } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { api } from "../../convex";
import { colors } from "../../theme/colors";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { AccountHeader } from "./chrome";
import { accountStyles } from "./styles";

/** Join dialog from `src/app/(gm)/join-dialog.tsx` as a full screen. */
export function JoinByCodeScreen() {
  const join = useMutation(api.members.joinByCode);
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <ScrollView contentContainerStyle={accountStyles.content} keyboardShouldPersistTaps="handled" style={accountStyles.screen}>
      <AccountHeader backHref="/home" backLabel="Back to main menu" title="Join a campaign" />
      <Text style={accountStyles.body}>Enter the join code your GM gave you.</Text>
      <Text style={accountStyles.label}>Join code</Text>
      <TextInput
        accessibilityLabel="Join code"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect={false}
        onChangeText={setCode}
        placeholder="e.g. K7QM-3XRP"
        placeholderTextColor={colors.faint}
        style={[accountStyles.input, accountStyles.codeInput]}
        value={code}
      />
      {error ? (
        <Text accessibilityRole="alert" style={accountStyles.error}>
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button onPress={() => router.back()} size="lg" variant="outline">
          Cancel
        </Button>
        <Button
          disabled={pending || code.trim().length === 0}
          onPress={() => {
            setPending(true);
            setError(null);
            void Promise.resolve(join({ code }))
              .then((result) => {
                if (result.ok) {
                  router.replace(`/campaign/${result.campaignId}`);
                  return;
                }
                setError(result.message);
                setPending(false);
              })
              .catch((e) => {
                setError(errorMessage(e));
                setPending(false);
              });
          }}
          size="lg"
          variant="primary"
        >
          {pending ? "Joining…" : "Join"}
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
    justifyContent: "flex-end",
  },
});
