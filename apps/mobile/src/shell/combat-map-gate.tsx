import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { api } from "../convex";
import { combatMapEnabled } from "../features/combat-map/flag";
import { colors } from "../theme/colors";
import { type } from "../theme/fonts";
import { space } from "../theme/spacing";
import { Button } from "../ui/button";
import { Loading } from "../ui/loading";
import { QueryBoundary } from "../ui/query-boundary";
import { useCampaign } from "./campaign-provider";

const SITE = process.env.EXPO_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "https://dualityheart.com";

export const USE_THE_WEBSITE_TEXT = "The Combat Map isn't on your phone yet. Open it on the website.";

/**
 * The phone combat map's two switches, both needed (dcm-gdzi.34): the build flag (`EXPO_PUBLIC_PHONE_COMBAT_MAP`, PX14,
 * `combatMapEnabled`) and the owner's `phoneLayout` feature switch for this user (`features.mine`, config AF1: "The
 * Combat Map on screens under 600 px wide"). Either off shows the 'use the website' screen with a link to this
 * campaign's map on the website.
 */
export function PhoneCombatMapGate({ children }: { children: ReactNode }) {
  if (!combatMapEnabled()) return <UseTheWebsite />;
  return (
    <QueryBoundary>
      <FeatureGate>{children}</FeatureGate>
    </QueryBoundary>
  );
}

function FeatureGate({ children }: { children: ReactNode }) {
  const flags = useQuery(api.features.mine, {});
  if (flags === undefined) return <Loading label="Loading the combat map" />;
  if (!flags.phoneLayout) return <UseTheWebsite />;
  return <>{children}</>;
}

function UseTheWebsite() {
  const campaignId = useCampaign()._id;
  return (
    <View style={styles.off} testID="combat-map-off">
      <Text style={styles.offText}>{USE_THE_WEBSITE_TEXT}</Text>
      <Button onPress={() => void Linking.openURL(`${SITE}/campaigns/${campaignId}/combat-map`)} variant="outline">
        Open the website
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  off: {
    alignItems: "flex-start",
    backgroundColor: colors.ink,
    flex: 1,
    gap: space[3],
    padding: space[4],
  },
  offText: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
});
