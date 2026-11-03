import { Pressable, StyleSheet, Text, View } from "react-native";

import { BRUSHES, BRUSH_SIZES, type TerrainCode } from "../../../../../../src/lib/world/terrain";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { hit, radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";

export function TerrainToolbar({
  painting,
  onTogglePaint,
  brush,
  onBrush,
  brushSize,
  onBrushSize,
  onReset,
}: {
  painting: boolean;
  onTogglePaint: () => void;
  brush: TerrainCode;
  brushSize: number;
  onBrush: (code: TerrainCode) => void;
  onBrushSize: (size: number) => void;
  onReset: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        Terrain paint
      </Text>
      <Button accessibilityLabel={painting ? "Stop painting terrain" : "Paint terrain"} onPress={onTogglePaint} variant={painting ? "solid" : "outline"}>
        {painting ? "Painting…" : "Paint terrain"}
      </Button>
      {painting ? (
        <>
          <Text style={styles.note}>Drag on the edit map to paint. Pinch elsewhere on the board to zoom the main map.</Text>
          <View style={styles.brushes}>
            {BRUSHES.map((b) => (
              <Pressable
                key={b.code}
                accessibilityRole="button"
                accessibilityState={{ selected: brush === b.code }}
                onPress={() => onBrush(b.code)}
                style={[styles.brush, { backgroundColor: b.bg }, brush === b.code ? styles.brushOn : null]}
              >
                <Text style={styles.brushLabel}>{b.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.sizes}>
            {BRUSH_SIZES.map((s) => (
              <Pressable
                key={s.size}
                accessibilityRole="button"
                accessibilityState={{ selected: brushSize === s.size }}
                onPress={() => onBrushSize(s.size)}
                style={[styles.sizeBtn, brushSize === s.size ? styles.sizeBtnOn : null]}
              >
                <Text style={styles.sizeLabel}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <Button onPress={onReset} variant="outline">
        Reset terrain
      </Button>
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
  brushes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
  },
  brush: {
    borderRadius: radius.md,
    minHeight: hit.minHeight,
    minWidth: 72,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  brushOn: {
    borderColor: colors.brand,
    borderWidth: 2,
  },
  brushLabel: {
    color: "#fff",
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 11,
    textAlign: "center",
  },
  sizes: {
    flexDirection: "row",
    gap: space[2],
  },
  sizeBtn: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: hit.minHeight,
    minWidth: hit.minHeight,
    paddingHorizontal: space[2],
  },
  sizeBtnOn: {
    borderColor: colors.brand,
  },
  sizeLabel: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    textAlign: "center",
  },
});
