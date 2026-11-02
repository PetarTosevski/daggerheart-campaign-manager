import { StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme/colors";
import { type as textType } from "../../theme/fonts";
import { QueryLoading } from "./chrome";
import type { SessionDashboard } from "./header";

export function LastSession({ summary }: { summary: SessionDashboard | undefined }) {
  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={styles.title}>
        Last Session
      </Text>
      <QueryLoading label="Loading the last session" value={summary} />
      {summary ? <Text style={styles.body}>{summary.lastSessionText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 8,
  },
  title: {
    color: colors.parchment,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: textType.displayBold.fontWeight,
  },
  body: {
    color: colors.body,
    fontFamily: textType.serif.fontFamily,
    fontSize: 18,
    fontStyle: textType.serif.fontStyle,
    fontWeight: textType.serif.fontWeight,
  },
});
