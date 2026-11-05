import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { wizardStyles as s } from "./styles";

export type StepProps = {
  state: import("./wizard-logic").WizardState;
  update: (patch: Partial<import("./wizard-logic").WizardState>) => void;
  opts: import("./wizard-logic").WizardOptions;
};

export function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <View accessibilityRole="none" style={{ gap: 8 }}>
      <Text style={s.label}>{legend}</Text>
      {children}
    </View>
  );
}

export function Choice({
  type = "radio",
  label,
  checked,
  disabled,
  onPress,
  children,
}: {
  type?: "radio" | "checkbox";
  label: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole={type}
      accessibilityState={{ checked, disabled: disabled ?? false }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[s.choice, checked && s.choiceOn, disabled && { opacity: 0.45 }]}
    >
      {children}
    </Pressable>
  );
}

export function HopeFearTag() {
  return (
    <Text accessibilityLabel="Hope and Fear" style={s.hint}>
      Hope & Fear
    </Text>
  );
}

export function HfMini() {
  return (
    <Text accessibilityLabel="Hope and Fear" style={s.hint}>
      H&F
    </Text>
  );
}
