import { useConvexConnectionState } from "convex/react";
import { createContext, useContext, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors } from "../theme/colors";
import { space } from "../theme/spacing";
import { Button, type ButtonVariant } from "../ui/button";
import { StaleBanner } from "../ui/stale-banner";

const WritesContext = createContext(true);

/**
 * Offline after a connection has succeeded and dropped, or after a connect
 * attempt has failed. The first attempt, before any retry, stays online so
 * the banner does not flash while the socket opens.
 */
export function offlineFromConnection(state: {
  isWebSocketConnected: boolean;
  hasEverConnected: boolean;
  connectionRetries: number;
}): boolean {
  return !state.isWebSocketConnected && (state.hasEverConnected || state.connectionRetries > 0);
}

export function useWritesEnabled(): boolean {
  return useContext(WritesContext);
}

export function OfflineFrame({ offline, children }: { offline: boolean; children: ReactNode }) {
  return (
    <WritesContext.Provider value={!offline}>
      <View style={styles.frame}>
        {offline ? (
          <View style={styles.banner}>
            <StaleBanner />
          </View>
        ) : null}
        {children}
      </View>
    </WritesContext.Provider>
  );
}

/** Live Convex connection. Renders `OfflineFrame`. */
export function LiveOffline({ children }: { children: ReactNode }) {
  const state = useConvexConnectionState();
  return <OfflineFrame offline={offlineFromConnection(state)}>{children}</OfflineFrame>;
}

/** A `Button` that does nothing while the campaign is offline. */
export function WriteButton({
  children,
  onPress,
  variant = "solid",
  accessibilityLabel,
}: {
  children: string;
  onPress: () => void;
  variant?: ButtonVariant;
  accessibilityLabel?: string;
}) {
  const enabled = useWritesEnabled();
  return (
    <Button
      accessibilityLabel={accessibilityLabel}
      disabled={!enabled}
      onPress={onPress}
      variant={variant}
    >
      {children}
    </Button>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.ink,
    flex: 1,
  },
  banner: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
  },
});
