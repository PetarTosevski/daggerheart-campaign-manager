import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import type { SessionListItem } from "../../../../../convex/sessionRecords";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { Button, type ButtonVariant } from "../../ui/button";
import { QueryBoundary } from "../../ui/query-boundary";
import { journalColors, js } from "./styles";

/** A Journal card: a heading (a header for screen readers), optional actions on its right, the body. */
export function Card({ heading, actions, children }: { heading: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <View style={js.card}>
      <View style={js.cardHead}>
        <Text accessibilityRole="header" style={js.heading}>
          {heading}
        </Text>
        {actions}
      </View>
      {children}
    </View>
  );
}

/** Every `useQuery` subtree of the Journal sits in its own boundary (CL1), named after the slot. */
export function Slot({ label, children }: { label: string; children: ReactNode }) {
  return <QueryBoundary title={label}>{children}</QueryBoundary>;
}

/** A loading line inside a slot. */
export function LoadingLine({ children }: { children: string }) {
  return (
    <Text accessibilityLiveRegion="polite" style={js.muted}>
      {children}
    </Text>
  );
}

export function ErrorLine({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <Text accessibilityRole="alert" style={js.error}>
      {error}
    </Text>
  );
}

/** A button that writes: disabled while offline (as `WriteButton`) or when `disabled`. */
export function ActButton({
  children,
  onPress,
  variant = "outline",
  disabled = false,
  accessibilityLabel,
}: {
  children: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const writes = useWritesEnabled();
  return (
    <Button accessibilityLabel={accessibilityLabel} disabled={disabled || !writes} onPress={onPress} variant={variant}>
      {children}
    </Button>
  );
}

/** A segmented control (ARIA tabs): the Journal's sub-tabs and the GM's Plan / Log & recap toggle. */
export function Tabs<T extends string>({
  label,
  tabs,
  selected,
  onSelect,
}: {
  label: string;
  tabs: readonly { id: T; label: string }[];
  selected: T;
  onSelect: (id: T) => void;
}) {
  return (
    <View accessibilityLabel={label} accessibilityRole="tablist" style={js.tabRow}>
      {tabs.map((tab) => {
        const on = tab.id === selected;
        return (
          <Pressable
            key={tab.id}
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(tab.id)}
            style={[js.tab, on ? js.tabOn : null]}
          >
            <Text style={[js.tabText, on ? js.tabTextOn : null]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A choice among a few (a scene type, an encounter to link): pressed state for screen readers. */
export function Option({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  const writes = useWritesEnabled();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: disabled || !writes }}
      disabled={disabled || !writes}
      onPress={onPress}
      style={[js.option, on ? js.optionOn : null]}
    >
      <Text style={[js.optionText, on ? js.optionTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

/** Planned (gold) / Live (green dot) / Played; `played` shows only where the website shows it (the heading). */
export function StatusChip({ status, showPlayed = false }: { status: SessionListItem["status"]; showPlayed?: boolean }) {
  if (status === "played" && !showPlayed) return null;
  const look =
    status === "live"
      ? { bg: journalColors.liveBg, fg: journalColors.live, text: "Live" }
      : status === "planned"
        ? { bg: journalColors.plannedBg, fg: journalColors.planned, text: "Planned" }
        : { bg: colors.raised, fg: colors.label, text: "Played" };
  return (
    <View style={[js.chip, js.row, { backgroundColor: look.bg, gap: 6 }]}>
      {status === "live" ? <View style={[js.dot, { backgroundColor: journalColors.live }]} /> : null}
      <Text style={[js.chipText, { color: look.fg }]}>{look.text}</Text>
    </View>
  );
}
