import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { frameName, plural } from "../../../../../src/lib/campaign-display";
import { api } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Loading } from "../../ui/loading";
import { QueryBoundary } from "../../ui/query-boundary";
import { accountStyles } from "./styles";

/** Title menu from `src/app/(gm)/title-menu.tsx`. */
export function HomeScreen() {
  return (
    <QueryBoundary>
      <HomeBody />
    </QueryBoundary>
  );
}

function HomeBody() {
  const campaigns = useQuery(api.campaigns.list);
  const settings = useQuery(api.settings.get);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const latest = campaigns?.[0];

  if (campaigns === undefined || settings === undefined) {
    return <Loading label="Loading menu" />;
  }

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + space[4] }]} style={accountStyles.screen}>
      <View style={styles.hero}>
        <Text accessibilityRole="header" style={styles.title}>
          DAGGERHEART
        </Text>
        <Text style={styles.kicker}>Campaign Ledger</Text>
      </View>

      <View accessibilityRole="menu" style={styles.menu}>
        {latest ? (
          <MenuRow
            label="Continue"
            onPress={() => router.push(`/campaign/${latest._id}`)}
            sub={`${latest.name} · ${frameName(latest.frameId)}${latest.role === "player" ? " · Player" : ""}`}
          />
        ) : null}
        <MenuRow
          label="Create New Campaign"
          onPress={() => router.push("/new")}
          sub="Frame or custom · start at session zero"
        />
        <MenuRow
          label="Load Campaign"
          onPress={() => router.push("/campaigns")}
          sub={campaigns.length === 0 ? "No saved campaigns" : plural(campaigns.length, "saved campaign")}
        />
        <MenuRow label="Join Campaign" onPress={() => router.push("/join")} sub="Play in a friend's game with their code" />
        <MenuRow label="Settings" onPress={() => router.push("/settings")} sub="Table, display & account" />
      </View>

      <Text style={styles.footer}>{settings.tableName || "Daggerheart Campaign Ledger"}</Text>
    </ScrollView>
  );
}

function MenuRow({ label, sub, onPress }: { label: string; sub: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="menuitem" onPress={onPress} style={({ pressed }) => [accountStyles.menuItem, pressed && styles.pressed]}>
      <Text style={accountStyles.menuLabel}>{label}</Text>
      <Text style={accountStyles.menuSub}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space[8],
    paddingBottom: space[12],
    paddingHorizontal: space[6],
    paddingTop: space[16],
  },
  footer: {
    ...type.sans,
    color: colors.faint,
    fontSize: 13,
    letterSpacing: 1,
    marginTop: space[8],
    textAlign: "center",
  },
  hero: {
    alignItems: "center",
    gap: space[3],
  },
  kicker: {
    ...type.displayBold,
    color: colors.brand,
    fontSize: 13,
    letterSpacing: 4.8,
    textTransform: "uppercase",
  },
  menu: {
    gap: space[2],
    maxWidth: 440,
    width: "100%",
    alignSelf: "center",
  },
  pressed: {
    backgroundColor: colors.raised,
    borderColor: colors.line2,
  },
  title: {
    ...type.displayBold,
    color: colors.parchment,
    fontSize: 32,
    letterSpacing: 1.4,
    paddingHorizontal: space[10],
    textAlign: "center",
  },
});
