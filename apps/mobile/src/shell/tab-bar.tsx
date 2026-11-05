import { usePathname, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "../theme/colors";
import { type } from "../theme/fonts";
import { hit, space } from "../theme/spacing";
import { MoreSheet } from "./more-sheet";
import { activeTab, CAMPAIGNS_HREF, sectionHref, tabItems } from "./sections";

export function TabBar({
  active,
  bottomInset,
  onMore,
  onSelect,
}: {
  active: string | null;
  bottomInset: number;
  onMore: () => void;
  onSelect: (slug: string) => void;
}) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(bottomInset, space[2]) }]}>
      {tabItems().map((tab) => {
        const selected = active === tab.slug;
        return (
          <Pressable
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={tab.slug || "dashboard"}
            onPress={() => onSelect(tab.slug)}
            style={styles.tab}
          >
            <Text style={selected ? styles.labelOn : styles.label}>{tab.label}</Text>
          </Pressable>
        );
      })}
      <Pressable accessibilityLabel="More" accessibilityRole="button" onPress={onMore} style={styles.tab}>
        <Text style={styles.label}>More</Text>
      </Pressable>
    </View>
  );
}

export function CampaignTabBar({ campaignId, isGm }: { campaignId: string; isGm: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  function select(slug: string) {
    setOpen(false);
    if (slug === "switch-campaign") {
      router.replace(CAMPAIGNS_HREF);
      return;
    }
    router.navigate(sectionHref(campaignId, slug));
  }

  return (
    <>
      <TabBar
        active={activeTab(pathname, campaignId)}
        bottomInset={insets.bottom}
        onMore={() => setOpen(true)}
        onSelect={select}
      />
      <MoreSheet isGm={isGm} onClose={() => setOpen(false)} onSelect={select} open={open} />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.panel,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
  },
  tab: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: hit.minHeight,
    paddingHorizontal: space[1],
    paddingVertical: space[1],
  },
  label: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
    fontWeight: type.sans.fontWeight,
    textAlign: "center",
  },
  labelOn: {
    color: colors.brand,
    fontFamily: type.sansMedium.fontFamily,
    fontSize: 12,
    fontWeight: type.sansMedium.fontWeight,
    textAlign: "center",
  },
});
