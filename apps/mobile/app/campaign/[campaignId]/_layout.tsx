import { Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CampaignProvider, firstParam, useCampaignState } from "../../../src/shell/campaign-provider";
import { LiveOffline } from "../../../src/shell/offline";
import { dashboardHref, moreItems, sectionLabel, stackName, tabItems } from "../../../src/shell/sections";
import { CampaignTabBar } from "../../../src/shell/tab-bar";
import { colors } from "../../../src/theme/colors";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function CampaignLayout() {
  const params = useLocalSearchParams<{ campaignId: string }>();
  const campaignId = firstParam(params.campaignId);
  return (
    <CampaignProvider campaignId={campaignId}>
      <CampaignShell campaignId={campaignId} />
    </CampaignProvider>
  );
}

function CampaignShell({ campaignId }: { campaignId: string }) {
  const insets = useSafeAreaInsets();
  const state = useCampaignState();
  const campaign = state.status === "ready" ? state.campaign : null;
  const isGm = campaign?.role === "gm";
  const tabs = tabItems().filter((tab) => tab.slug.length > 0);
  const more = moreItems(true).filter((item) => item.slug !== "adversaries" && item.slug !== "switch-campaign");

  return (
    <LiveOffline>
      <View style={styles.screen}>
        <View style={[styles.body, { paddingTop: insets.top }]}>
          <Stack screenOptions={{ contentStyle: { backgroundColor: colors.ink }, headerShown: false }}>
            <Stack.Screen name="index" options={{ title: "Dashboard" }} />
            {tabs.map((tab) => (
              <Stack.Screen key={tab.slug} name={stackName(tab.slug)} options={{ title: tab.label }} />
            ))}
            {more.map((item) => (
              <Stack.Screen key={item.slug} name={item.slug} options={{ title: item.label }} />
            ))}
            <Stack.Screen name="party/new" options={{ title: "New character" }} />
            <Stack.Screen name="party/[characterId]" options={{ title: "Character" }} />
            <Stack.Screen name="codex/[entryId]" options={{ title: sectionLabel("codex") }} />
            <Stack.Screen name="notes/[pageId]" options={{ title: sectionLabel("journal") }} />
            <Stack.Screen name="sessions/[sessionId]" options={{ title: sectionLabel("journal") }} />
            <Stack.Protected
              guard={isGm}
              redirectTo={campaignId.length > 0 ? dashboardHref(campaignId) : "/campaign"}
            >
              <Stack.Screen name="(gm)" options={{ headerShown: false }} />
            </Stack.Protected>
          </Stack>
        </View>
        {campaign ? <CampaignTabBar campaignId={campaign._id} isGm={isGm} /> : null}
      </View>
    </LiveOffline>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.ink,
    flex: 1,
  },
  body: {
    flex: 1,
  },
});
