import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";
import { NotesScreen } from "../notes";
import { SessionsScreen } from "../sessions";
import { JOURNAL_TAB_LABEL, JOURNAL_TABS, type JournalTab } from "./tabs";

export { JOURNAL_TABS, journalHref, parseJournalTab, type JournalTab } from "./tabs";

/**
 * Journal: one tab for Sessions and Notes (the website's Journal, JX1). For now it hosts the existing phone Sessions
 * and Notes screens as two sub-tabs; the full Journal port is PX12. The selected sub-tab is URL state owned by the
 * route (`?tab=`), so this screen only reports presses. Both hosted screens carry their own query boundary.
 */
export function JournalScreen({ tab, onTab }: { tab: JournalTab; onTab: (tab: JournalTab) => void }) {
  return (
    <View style={styles.screen}>
      <View accessibilityLabel="Journal" accessibilityRole="tablist" style={styles.tabRow}>
        {JOURNAL_TABS.map((id) => (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
            onPress={() => onTab(id)}
            style={[styles.tab, tab === id ? styles.tabOn : null]}
          >
            <Text style={[styles.tabText, tab === id ? styles.tabTextOn : null]}>{JOURNAL_TAB_LABEL[id]}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.body}>{tab === "notes" ? <NotesScreen /> : <SessionsScreen />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: space[3],
  },
  tabRow: {
    backgroundColor: colors.ink2,
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: space[1],
    padding: space[1],
  },
  tab: {
    alignItems: "center",
    borderRadius: radius.pill,
    flex: 1,
    justifyContent: "center",
    minHeight: hit.minHeight,
  },
  tabOn: {
    backgroundColor: colors.brand,
  },
  tabText: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  tabTextOn: {
    color: colors.brandInk,
    fontFamily: type.sansSemibold.fontFamily,
    fontWeight: type.sansSemibold.fontWeight,
  },
  body: {
    flex: 1,
  },
});
