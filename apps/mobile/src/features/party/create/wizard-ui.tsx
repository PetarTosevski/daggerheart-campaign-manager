import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { wizardStyles as s } from "./styles";

/** Shared domain cards (CB p.21, plan rule-switches OSC): the campaign's mode and who holds which card. */
export type SharedCards = {
  mode: import("../../../../../../src/lib/domain/characters").SharedCardsMode;
  holders: ReadonlyMap<string, readonly string[]>;
};

export type StepProps = {
  state: import("./wizard-logic").WizardState;
  update: (patch: Partial<import("./wizard-logic").WizardState>) => void;
  opts: import("./wizard-logic").WizardOptions;
  /** Undefined while `ruleSettings.get` or the party loads. */
  shared?: SharedCards;
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
