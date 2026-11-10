import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  METHOD_LABELS,
  PACE_LABELS,
  SPEED_TERRAINS,
  SPEED_TERRAIN_CODE,
  canCross,
  maxSwimKm,
  swimsWater,
  terrainSpeed,
  type TravelMethod,
  type TravelPace,
  type TravelRules,
} from "../../../../../src/lib/domain/travel";
import { TERRAIN_COLOURS, TERRAIN_NAMES } from "../../../../../src/lib/world/terrain";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";

/** Collapsible travel speeds table (PD1), matching the website legend. */
export function TravelLegend({
  rules,
  method,
  pace,
}: {
  rules: TravelRules;
  method: TravelMethod;
  pace: TravelPace;
}) {
  const [open, setOpen] = useState(true);
  const paceText = pace === "normal" ? PACE_LABELS.normal : `${PACE_LABELS[pace]} ×${pace === "slow" ? rules.slow : rules.fast}`;

  return (
    <View accessibilityLabel="Travel speeds" style={styles.wrap}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={styles.toggle}>
          <Text style={styles.caret}>{open ? "▾" : "▸"}</Text>
          <Text style={styles.toggleLabel}>Travel speeds</Text>
        </Pressable>
        <Text style={styles.meta}>
          {METHOD_LABELS[method]} · {paceText} · km/day
        </Text>
      </View>
      {open ? (
        <>
          {SPEED_TERRAINS.map((t) => {
            const code = SPEED_TERRAIN_CODE[t];
            return (
              <View key={t} style={styles.row}>
                <View accessibilityElementsHidden style={[styles.swatch, { backgroundColor: TERRAIN_COLOURS[code] }]} />
                <Text style={styles.name}>{TERRAIN_NAMES[code]}</Text>
                <Text style={styles.speed}>
                  {canCross(rules, method, code) ? `${Math.round(terrainSpeed(rules, method, pace, code))} km/day` : "cannot cross"}
                </Text>
                {code === "." && swimsWater(method) && canCross(rules, method, code) ? (
                  <Text style={styles.note}>Swims up to {Math.round(maxSwimKm(rules, method, pace))} km (one day)</Text>
                ) : null}
              </View>
            );
          })}
          <View style={styles.row}>
            <View accessibilityElementsHidden style={[styles.swatch, { backgroundColor: TERRAIN_COLOURS["#"] }]} />
            <Text style={styles.name}>{TERRAIN_NAMES["#"]}</Text>
            <Text style={styles.speed}>cannot cross</Text>
          </View>
          <Text style={styles.footer}>Unpainted ground counts as Wilds. On foot or mounted the party swims Water only where it can reach the far side in one day.</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  toggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[1],
    minHeight: 44,
  },
  caret: {
    color: colors.brand,
    fontSize: 14,
  },
  toggleLabel: {
    color: colors.body,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 15,
    fontWeight: type.sansSemibold.fontWeight,
  },
  meta: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    minHeight: 36,
  },
  swatch: {
    borderRadius: 4,
    height: 14,
    width: 14,
  },
  name: {
    color: colors.body,
    flex: 1,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  speed: {
    color: colors.body,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 13,
    fontWeight: type.sansSemibold.fontWeight,
  },
  note: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    width: "100%",
  },
  footer: {
    color: colors.faint,
    fontFamily: type.sans.fontFamily,
    fontSize: 11,
    marginTop: space[1],
  },
});
