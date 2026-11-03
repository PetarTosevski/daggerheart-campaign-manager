import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Path as SvgPath } from "react-native-svg";

import { BUILTIN_TOKEN_TYPES } from "../../../../../../src/lib/world/map-state";
import { MARKER_SWATCHES, TOKEN_TYPE_ART, type TokenType } from "../../../../../../src/lib/world/token-types";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { hit, radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import type { MapActions } from "./map-actions";

export function TokenIcon({ kind, size = 26 }: { kind: Pick<TokenType, "colour" | "path">; size?: number }) {
  const icon = Math.round(size * 0.58);
  return (
    <View style={[styles.tokenIcon, { width: size, height: size, backgroundColor: kind.colour }]}>
      <Svg height={icon} width={icon} viewBox="0 0 24 24">
        <SvgPath d={kind.path} fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} />
      </Svg>
    </View>
  );
}

/** Place-on-map palette: pick a marker type, then tap the edit map. */
export function WorldPalette({
  types,
  placing,
  onPick,
  actions,
}: {
  types: TokenType[];
  placing: string | null;
  onPick: (id: string | null) => void;
  actions: MapActions;
}) {
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("landmark");
  const [colour, setColour] = useState<string>(MARKER_SWATCHES[0]);
  const [customOpen, setCustomOpen] = useState(false);

  async function saveRename(t: TokenType) {
    const v = renaming?.draft.trim();
    setRenaming(null);
    if (v && v !== t.label) await actions.renameType(t.id, v);
  }

  async function addCustom() {
    const label = name.trim();
    if (!label) return;
    const added = await actions.addCustomType(label, icon, colour);
    if (added) {
      setName("");
      onPick(added.id);
    }
  }

  return (
    <View accessibilityLabel="Map tokens" testID="world-palette" style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        Place on map
      </Text>
      <Text style={styles.note}>Pick a marker, then tap the map below to drop it.</Text>
      {types.map((t) =>
        renaming?.id === t.id ? (
          <View key={t.id} style={styles.row}>
            <TextInput
              accessibilityLabel={`New name for ${t.label}`}
              autoFocus
              maxLength={40}
              onChangeText={(draft) => setRenaming({ id: t.id, draft })}
              style={styles.input}
              value={renaming.draft}
            />
            <Button onPress={() => void saveRename(t)} size="md" variant="outline">
              Save
            </Button>
          </View>
        ) : (
          <View key={t.id} style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: placing === t.id }}
              onPress={() => onPick(placing === t.id ? null : t.id)}
              style={[styles.pick, placing === t.id ? styles.pickActive : null]}
            >
              <TokenIcon kind={t} />
              <Text numberOfLines={1} style={styles.pickLabel}>
                {t.label}
              </Text>
            </Pressable>
            <Button onPress={() => setRenaming({ id: t.id, draft: t.label })} size="md" variant="outline">
              Rename
            </Button>
          </View>
        ),
      )}
      <Button onPress={() => setCustomOpen((v) => !v)} variant="outline">
        {customOpen ? "Hide custom marker" : "Custom marker"}
      </Button>
      {customOpen ? (
        <View style={styles.custom}>
          <TextInput accessibilityLabel="Custom marker name" maxLength={40} onChangeText={setName} placeholder="Name" style={styles.input} value={name} />
          <Text style={styles.note}>Icon: {TOKEN_TYPE_ART[icon as keyof typeof TOKEN_TYPE_ART]?.label ?? icon}</Text>
          <View style={styles.swatches}>
            {BUILTIN_TOKEN_TYPES.slice(0, 6).map((id) => (
              <Pressable key={id} accessibilityRole="button" onPress={() => setIcon(id)} style={[styles.swatchBtn, icon === id ? styles.swatchBtnOn : null]}>
                <Text style={styles.swatchText}>{TOKEN_TYPE_ART[id].label}</Text>
              </Pressable>
            ))}
          </View>
          <View accessibilityRole="radiogroup" accessibilityLabel="Colour" style={styles.swatches}>
            {MARKER_SWATCHES.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="radio"
                accessibilityState={{ selected: colour === c }}
                onPress={() => setColour(c)}
                style={[styles.colourDot, { backgroundColor: c }, colour === c ? styles.colourDotOn : null]}
              />
            ))}
          </View>
          <Button onPress={() => void addCustom()} variant="solid">
            Add marker type
          </Button>
        </View>
      ) : null}
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
    flexDirection: "row",
    gap: space[2],
  },
  pick: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: space[2],
    minHeight: hit.minHeight,
    paddingHorizontal: space[2],
  },
  pickActive: {
    borderColor: colors.brand,
  },
  pickLabel: {
    color: colors.parchment,
    flex: 1,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  tokenIcon: {
    alignItems: "center",
    borderColor: "rgba(255, 243, 214, 0.85)",
    borderRadius: radius.pill,
    borderWidth: 2,
    justifyContent: "center",
  },
  input: {
    backgroundColor: colors.ink,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    flex: 1,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minHeight: hit.minHeight,
    paddingHorizontal: space[2],
  },
  custom: {
    gap: space[2],
  },
  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
  },
  swatchBtn: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  swatchBtnOn: {
    borderColor: colors.brand,
  },
  swatchText: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
  },
  colourDot: {
    borderRadius: radius.pill,
    height: 28,
    width: 28,
  },
  colourDotOn: {
    borderColor: colors.brand,
    borderWidth: 2,
  },
});
