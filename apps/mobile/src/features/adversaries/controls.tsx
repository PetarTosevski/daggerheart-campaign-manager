import { Component, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { ErrorState } from "../../ui/error-state";

import { advStyles } from "./styles";

type BoundaryState = { failed: boolean; message: string };

/** Keeps a failing slot (a `useQuery` that throws) from blanking the screen; "Try again" remounts it. */
export class SlotBoundary extends Component<{ children: ReactNode; label: string }, BoundaryState> {
  override state: BoundaryState = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown) {
    console.error(`${this.props.label} failed to load`, error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ErrorState
        message={this.state.message || `${this.props.label} failed to load.`}
        onRetry={() => this.setState({ failed: false, message: "" })}
        title={`${this.props.label} failed to load`}
      />
    );
  }
}

export function Chip({
  label,
  on,
  onPress,
  hint = false,
  disabled = false,
  accessibilityLabel,
  role = "button",
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  hint?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  role?: "button" | "tab" | "switch";
}) {
  const state = role === "switch" ? { checked: on, disabled } : { selected: on, disabled };
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={role}
      accessibilityState={state}
      disabled={disabled}
      onPress={onPress}
      style={[advStyles.chip, on ? advStyles.chipOn : null, hint && !on ? advStyles.chipHint : null, disabled ? advStyles.disabled : null]}
    >
      <Text style={[advStyles.tabText, on ? advStyles.tabTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

/** − value + with 44 pt targets. */
export function Stepper({
  value,
  label,
  onDown,
  onUp,
  downDisabled = false,
  upDisabled = false,
}: {
  value: string;
  label: string;
  onDown: () => void;
  onUp: () => void;
  downDisabled?: boolean;
  upDisabled?: boolean;
}) {
  return (
    <View accessibilityLabel={label} style={advStyles.stepper}>
      <Pressable
        accessibilityLabel={`Less ${label.toLowerCase()}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: downDisabled }}
        disabled={downDisabled}
        onPress={onDown}
        style={[advStyles.stepBtn, downDisabled ? advStyles.disabled : null]}
      >
        <Text style={advStyles.stepText}>−</Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" style={advStyles.stepValue}>
        {value}
      </Text>
      <Pressable
        accessibilityLabel={`More ${label.toLowerCase()}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: upDisabled }}
        disabled={upDisabled}
        onPress={onUp}
        style={[advStyles.stepBtn, upDisabled ? advStyles.disabled : null]}
      >
        <Text style={advStyles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

export function ErrorLine({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" style={advStyles.error}>
      {message}
    </Text>
  );
}

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={advStyles.card}>
      <Text accessibilityRole="header" style={advStyles.h2}>
        {title}
      </Text>
      {typeof children === "string" ? <Text style={advStyles.body}>{children}</Text> : children}
    </View>
  );
}
