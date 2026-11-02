import { Component, type ReactNode } from "react";
import { StyleSheet, Text } from "react-native";

import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";

export class DeathBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <Text accessibilityRole="alert" style={styles.alert}>
          Death moves couldn&apos;t load. Close the sheet and open it again.
        </Text>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  alert: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    fontStyle: "italic",
    paddingVertical: space[2],
  },
});
