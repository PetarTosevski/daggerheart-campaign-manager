import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { MapToken } from "../../../../../../src/lib/world/map-state";
import { tokenType, type TokenType } from "../../../../../../src/lib/world/token-types";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { hit, radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import type { MapActions } from "./map-actions";
import { TokenIcon } from "./palette";

export function TokenPanel({
  tokens,
  types,
  selectedId,
  onSelect,
  movingId,
  onMovePick,
  actions,
}: {
  tokens: MapToken[];
  types: TokenType[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  movingId: number | null;
  onMovePick: (id: number | null) => void;
  actions: MapActions;
}) {
  const selected = selectedId !== null ? (tokens.find((t) => t.id === selectedId) ?? null) : null;
  const selType = selected ? tokenType(types, selected.type) : null;

  return (
    <View accessibilityLabel="Map markers" style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        Markers
      </Text>
      {tokens.map((t) => {
        const kind = tokenType(types, t.type);
        const active = selectedId === t.id;
        return (
          <Pressable
            key={t.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(active ? null : t.id)}
            style={[styles.row, active ? styles.rowActive : null]}
          >
            <TokenIcon kind={kind} size={30} />
            <Text numberOfLines={1} style={styles.rowLabel}>
              {t.name || kind.label}
            </Text>
          </Pressable>
        );
      })}
      {selected && selType ? (
        <View style={styles.editor}>
          <View style={styles.editorHead}>
            <TokenIcon kind={selType} size={34} />
            <Text style={styles.editorType}>{selType.label}</Text>
          </View>
          <TextInput
            accessibilityLabel="Marker name"
            defaultValue={selected.name}
            maxLength={80}
            onEndEditing={(e) => void actions.updateToken(selected.id, { name: e.nativeEvent.text.trim() })}
            style={styles.input}
          />
          <Button onPress={() => onMovePick(movingId === selected.id ? null : selected.id)} variant={movingId === selected.id ? "solid" : "outline"}>
            {movingId === selected.id ? "Tap the map to move" : "Move on map"}
          </Button>
          <Button onPress={() => void actions.removeToken(selected.id).then(() => onSelect(null))} variant="danger">
            Remove marker
          </Button>
        </View>
      ) : (
        <Text style={styles.note}>Select a marker to rename, move, or remove it.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.ink2,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
    fontWeight: type.displayBold.fontWeight,
  },
  note: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  row: {
    alignItems: "center",
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: space[2],
    minHeight: hit.minHeight,
    paddingHorizontal: space[2],
  },
  rowActive: {
    borderColor: colors.brand,
  },
  rowLabel: {
    color: colors.parchment,
    flex: 1,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  editor: {
    gap: space[2],
  },
  editorHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[2],
  },
  editorType: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: colors.ink,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minHeight: hit.minHeight,
    paddingHorizontal: space[2],
  },
});
