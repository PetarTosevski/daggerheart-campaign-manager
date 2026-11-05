import { Component, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";

import { HIT_RETRY_DELAYS_MS, HIT_RETRY_STABLE_MS } from "./model";

type State = { failed: boolean; attempts: number };

/** Retries a failing `adversaryActionsReads.pending` read before surfacing an error (website HitBoundary). */
export class HitBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false, attempts: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error("The incoming hit failed to load", error);
    this.clearTimer();
    const delay = HIT_RETRY_DELAYS_MS[this.state.attempts];
    if (delay === undefined) return;
    this.timer = setTimeout(() => {
      this.setState((s) => ({ failed: false, attempts: s.attempts + 1 }));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.setState({ attempts: 0 });
      }, HIT_RETRY_STABLE_MS);
    }, delay);
  }

  override componentWillUnmount() {
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.state.attempts < HIT_RETRY_DELAYS_MS.length) return null;
    return (
      <View accessibilityRole="alert" style={styles.alert}>
        <Text style={styles.alertText}>The incoming hit failed to load.</Text>
        <Button onPress={() => this.setState({ failed: false, attempts: 0 })} variant="outline">
          Try again
        </Button>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  alert: {
    gap: space[3],
    paddingVertical: space[2],
  },
  alertText: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
  },
});
