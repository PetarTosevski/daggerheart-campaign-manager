import { useMutation } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { api } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { accountStyles } from "./styles";

/** `/join/<code>` from `src/app/(gm)/join/[code]/join-by-link.tsx`. */
export function JoinByLinkScreen({ code }: { code: string }) {
  const join = useMutation(api.members.joinByCode);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = code.trim().toUpperCase();

  return (
    <View style={[accountStyles.screen, styles.center]}>
      <Text accessibilityRole="header" style={styles.title}>
        Join a campaign
      </Text>
      <Text style={[accountStyles.body, styles.copy]}>
        You were invited with the code <Text style={styles.code}>{shown}</Text>. Join as a player?
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={accountStyles.error}>
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button onPress={() => router.replace("/home")} size="lg" variant="outline">
          Not now
        </Button>
        <Button
          disabled={pending}
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
          {pending ? "Joining…" : "Join campaign"}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
    justifyContent: "center",
  },
  center: {
    alignItems: "center",
    gap: space[5],
    justifyContent: "center",
    padding: space[6],
  },
  code: {
    ...type.displayBold,
    color: colors.brand,
    letterSpacing: 2.4,
  },
  copy: {
    maxWidth: 360,
    textAlign: "center",
  },
  title: {
    ...type.displayBold,
    color: colors.parchment,
    fontSize: 30,
  },
});
