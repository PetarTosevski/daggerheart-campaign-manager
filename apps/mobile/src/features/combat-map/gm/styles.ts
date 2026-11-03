import { StyleSheet } from "react-native";

import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";

export const gmStyles = StyleSheet.create({
  stack: {
    gap: space[3],
  },
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 20,
    fontWeight: type.displayBold.fontWeight,
  },
  muted: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    alignItems: "center",
  },
  chip: {
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  chipOn: {
    backgroundColor: colors.ink2,
    borderColor: colors.brand,
  },
  chipText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  chipTextOn: {
    color: colors.brand,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  mapRow: {
    gap: space[2],
    paddingVertical: space[2],
  },
  live: {
    color: colors.brand,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
