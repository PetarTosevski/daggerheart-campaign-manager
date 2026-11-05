import { useConvexAuth } from "@convex-dev/auth/react";
import { Redirect, Slot } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors } from "../theme/colors";
import { Loading } from "../ui/loading";
import { SIGN_IN_HREF } from "./session-gate";

/**
 * Renders `children` (the campaign routes' `Slot` by default) only for a signed-in visitor, so no campaign screen
 * mounts, or subscribes, signed out. The root layout's `sessionRedirect` sends the same visitor to sign-in; this is
 * the structural guard under it.
 */
export function CampaignGate({ children }: { children?: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading) {
    return (
      <View style={styles.fill}>
        <Loading label="Checking your session" />
      </View>
    );
  }
  if (!isAuthenticated) return <Redirect href={SIGN_IN_HREF} />;
  return <>{children ?? <Slot />}</>;
}

const styles = StyleSheet.create({
  fill: { backgroundColor: colors.ink, flex: 1 },
});
