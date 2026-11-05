import { Component, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { colors } from "../../theme/colors";
import { type as textType } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { ErrorState } from "../../ui/error-state";
import { Loading } from "../../ui/loading";

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function QueryLoading({ label, value }: { label: string; value: unknown }) {
  if (value !== undefined) return null;
  return <Loading label={label} />;
}

type BoundaryProps = { title: string; children: ReactNode };
type BoundaryState = { error: unknown };

/** One failing query leaves the rest of the dashboard on screen. */
export class PanelBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          message={errorMessage(this.state.error)}
          onRetry={() => this.setState({ error: null })}
          title={this.props.title}
        />
      );
    }
    return this.props.children;
  }
}

export function AlertLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.alert}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  title: {
    color: colors.parchment,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: textType.displayBold.fontWeight,
  },
  alert: {
    color: colors.danger,
    fontFamily: textType.sans.fontFamily,
    fontSize: 14,
    fontWeight: textType.sans.fontWeight,
  },
});
