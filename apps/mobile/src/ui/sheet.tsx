import { useEffect, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { colors } from "../theme/colors";
import { type } from "../theme/fonts";
import { useDuration } from "../theme/motion";
import { radius, space } from "../theme/spacing";
import { Button } from "./button";

/** `colors.ink` at the website dialog backdrop strength (`dialog::backdrop` is 0.78). */
function inkOverlay(alpha: number): string {
  const hex = colors.ink.slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const motion = useDuration();
  const settled = motion.sheet === 0;
  const opacity = useSharedValue(settled && open ? 1 : 0);
  const translateY = useSharedValue(settled && open ? 0 : space[6]);
  const closeLabel = `Close ${title.toLowerCase()}`;

  useEffect(() => {
    opacity.value = withTiming(open ? 1 : 0, { duration: motion.sheet });
    translateY.value = withTiming(open ? 0 : space[6], { duration: motion.sheet });
  }, [motion.sheet, opacity, open, translateY]);

  const backdropStyle = useAnimatedStyle(() => {
    return { opacity: opacity.value };
  }, []);

  const sheetStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
      transform: [{ translateY: translateY.value }],
    };
  }, []);

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={open}
    >
      <View style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable
            accessibilityLabel={closeLabel}
            accessibilityRole="button"
            onPress={onClose}
            style={styles.backdropHit}
            testID="sheet-backdrop"
          />
        </Animated.View>
        <Animated.View accessibilityViewIsModal style={[styles.sheet, sheetStyle]}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Button accessibilityLabel={closeLabel} onPress={onClose} variant="outline">
              Close
            </Button>
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    backgroundColor: inkOverlay(0.78),
  },
  backdropHit: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.panel,
    borderColor: colors.line2,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    gap: space[4],
    padding: space[6],
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[3],
    justifyContent: "space-between",
  },
  title: {
    color: colors.parchment,
    flexShrink: 1,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 30,
    fontWeight: type.displayBold.fontWeight,
    letterSpacing: 1.8,
  },
});
