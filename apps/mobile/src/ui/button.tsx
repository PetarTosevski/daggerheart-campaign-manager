import { Pressable, StyleSheet, Text } from "react-native";
import { createAnimatedComponent, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { colors } from "../theme/colors";
import { type } from "../theme/fonts";
import { useDuration } from "../theme/motion";
import { hit, radius, space } from "../theme/spacing";

export type ButtonVariant = "primary" | "solid" | "outline" | "pill" | "danger" | "dangerSolid";
export type ButtonSize = "md" | "lg";

const AnimatedPressable = createAnimatedComponent(Pressable);

const variantStyle = {
  primary: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
    color: colors.brandInk,
    borderRadius: radius.pill,
    text: type.displayBold,
    letterSpacing: 1.6,
  },
  solid: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
    color: colors.brandInk,
    borderRadius: radius.md,
    text: type.sansSemibold,
    letterSpacing: 0,
  },
  outline: {
    backgroundColor: "transparent",
    borderColor: colors.line2,
    color: colors.parchment,
    borderRadius: radius.md,
    text: type.sans,
    letterSpacing: 0,
  },
  pill: {
    backgroundColor: "transparent",
    borderColor: colors.line2,
    color: colors.parchment,
    borderRadius: radius.pill,
    text: type.sans,
    letterSpacing: 0,
  },
  danger: {
    backgroundColor: "transparent",
    borderColor: colors.dangerLine,
    color: colors.danger,
    borderRadius: radius.md,
    text: type.sans,
    letterSpacing: 0,
  },
  dangerSolid: {
    backgroundColor: colors.dangerSolid,
    borderColor: colors.dangerSolid,
    color: colors.parchment,
    borderRadius: radius.md,
    text: type.sansSemibold,
    letterSpacing: 0,
  },
} as const;

const sizeStyle = {
  md: { minHeight: hit.minHeight, paddingHorizontal: space[4] },
  lg: { minHeight: hit.lg, paddingHorizontal: space[5] },
} as const;

export function Button({
  children,
  onPress,
  variant = "solid",
  size = "md",
  disabled = false,
  accessibilityLabel,
}: {
  children: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const motion = useDuration();
  const pressed = useSharedValue(0);
  const look = variantStyle[variant];
  const metrics = sizeStyle[size];
  const animated = useAnimatedStyle(() => {
    return {
      opacity: disabled ? 0.5 : 1 - pressed.value * 0.08,
      transform: [{ scale: 1 - pressed.value * 0.02 }],
    };
  }, [disabled]);

  function pressIn() {
    pressed.value = withTiming(disabled ? 0 : 1, { duration: motion.press });
  }

  function pressOut() {
    pressed.value = withTiming(0, { duration: motion.press });
  }

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={[
        styles.base,
        {
          minHeight: metrics.minHeight,
          paddingHorizontal: metrics.paddingHorizontal,
          backgroundColor: look.backgroundColor,
          borderColor: look.borderColor,
          borderRadius: look.borderRadius,
        },
        animated,
      ]}
    >
      <Text
        style={{
          fontFamily: look.text.fontFamily,
          fontWeight: look.text.fontWeight,
          letterSpacing: look.letterSpacing,
          color: look.color,
          fontSize: 16,
        }}
      >
        {children}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    paddingVertical: space[2],
  },
});
