import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { groupBadgeColors } from "../../../../../src/lib/codex/view";
import { colors } from "../../theme/colors";

import type { ListRow } from "./list-model";
import { codexStyles } from "./styles";

export function EntryRow({
  entry,
  selected,
  gm,
  onPress,
}: {
  entry: ListRow;
  selected: boolean;
  gm: boolean;
  onPress: () => void;
}) {
  const badge = groupBadgeColors(entry.group);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : undefined}
      onPress={onPress}
      style={[codexStyles.entryRow, selected ? codexStyles.entryRowOn : null]}
    >
      <View style={codexStyles.thumb}>
        {entry.coverUrl ? (
          <Image accessibilityIgnoresInvertColors source={{ uri: entry.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Text style={codexStyles.thumbLetter}>{entry.initial}</Text>
        )}
      </View>
      <View style={styles.meta}>
        <Text style={codexStyles.entryName}>{entry.name}</Text>
        <Text numberOfLines={1} style={codexStyles.entrySub}>
          {entry.subtitle}
        </Text>
        <View style={codexStyles.row}>
          {entry.groupText ? (
            <View style={[codexStyles.badge, { backgroundColor: badge.background }]}>
              <Text style={[codexStyles.badgeText, { color: badge.color }]}>{entry.groupText}</Text>
            </View>
          ) : null}
          {gm ? (
            <>
              <View
                style={[
                  codexStyles.badge,
                  { backgroundColor: entry.known ? colors.okBg : colors.dangerBg },
                ]}
              >
                <Text style={[codexStyles.badgeText, { color: entry.known ? colors.ok : colors.danger }]}>
                  {entry.known ? "Known" : "Secret"}
                </Text>
              </View>
              <View style={[codexStyles.badge, { backgroundColor: colors.panel2 }]}>
                <Text style={[codexStyles.badgeText, { color: colors.body }]}>{entry.imageText}</Text>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  meta: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
});
