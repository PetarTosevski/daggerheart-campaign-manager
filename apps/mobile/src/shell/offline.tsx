import { useConvexConnectionState } from "convex/react";
import { createContext, useContext, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors } from "../theme/colors";
import { space } from "../theme/spacing";
import { Button, type ButtonVariant } from "../ui/button";
import { StaleBanner } from "../ui/stale-banner";

/** Whether this screen may write, and when it may not, why (shown as the disabled controls' hint). */
type Writes = { enabled: boolean; reason: string | null };

export const OFFLINE_REASON = "Offline: changes are paused until the connection is back.";

/** The banner over a screen whose connection dropped: what is wrong, and that the data on screen may be old. */
export const OFFLINE_BANNER = "You're offline. Showing the last update.";

const WritesContext = createContext<Writes>({ enabled: true, reason: null });

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
  return useContext(WritesContext).enabled;
}

/** Why writes are off here (offline, an archived campaign, the owner's view, read-only mode), or null while they are on. */
export function useWritesOffReason(): string | null {
  return useContext(WritesContext).reason;
}

/**
 * Turns writes off for everything inside while `reason` is set (the shell's read-only frame, `read-only.tsx`). An outer
 * frame that already turned them off (offline) keeps its reason; writes never turn back on inside.
 */
export function WritesOffFrame({ reason, children }: { reason: string | null; children: ReactNode }) {
  const outer = useContext(WritesContext);
  const value = !outer.enabled || reason === null ? outer : { enabled: false, reason };
  return <WritesContext.Provider value={value}>{children}</WritesContext.Provider>;
}

const ONLINE: Writes = { enabled: true, reason: null };
const OFFLINE: Writes = { enabled: false, reason: OFFLINE_REASON };

export function OfflineFrame({ offline, children }: { offline: boolean; children: ReactNode }) {
  return (
    <WritesContext.Provider value={offline ? OFFLINE : ONLINE}>
      <View style={styles.frame}>
        {offline ? (
          <View style={styles.banner}>
            <StaleBanner message={OFFLINE_BANNER} />
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
