import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, space } from "../../theme/spacing";

export function AccountHeader({
  title,
  backLabel,
  backHref,
  style,
}: {
  title: string;
  backLabel?: string;
  backHref?: string;
  style?: ViewStyle;
}) {
  const router = useRouter();
  return (
    <View style={[styles.header, style]}>
      {backHref ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push(backHref)}
          style={styles.back}
        >
          <Text style={styles.backText}>{backLabel ?? "Back"}</Text>
        </Pressable>
      ) : (
        <View style={styles.backPlaceholder} />
      )}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <View style={styles.backPlaceholder} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[3],
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  back: {
    minHeight: hit.minHeight,
    justifyContent: "center",
    minWidth: 88,
  },
  backPlaceholder: {
    minWidth: 88,
  },
  backText: {
    ...type.sans,
    color: colors.brand,
    fontSize: 15,
  },
  title: {
    ...type.displayBold,
    color: colors.parchment,
    flex: 1,
    fontSize: 20,
    letterSpacing: 1.2,
    textAlign: "center",
    textTransform: "uppercase",
  },
});
