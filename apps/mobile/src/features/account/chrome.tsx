import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space[2] }, style]}>
      {backHref ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => router.navigate(backHref)}
          style={styles.back}
        >
          <Text style={styles.backText}>{backLabel ?? "Back"}</Text>
        </Pressable>
      ) : null}
      <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[3],
  },
  back: {
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: hit.minHeight,
  },
  backText: {
    ...type.sans,
    color: colors.brand,
    fontSize: 15,
  },
  title: {
    ...type.displayBold,
    color: colors.parchment,
    fontSize: 22,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
});
