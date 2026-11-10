import { StyleSheet } from "react-native";

import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";

export const editStyles = StyleSheet.create({
  slot: {
    gap: space[2],
    marginTop: space[2],
  },
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
  label: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  hint: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
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
  mapShell: {
    backgroundColor: colors.ink2,
    borderRadius: radius.md,
    minHeight: 220,
    overflow: "hidden",
  },
  prompt: {
    backgroundColor: colors.ink2,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    minHeight: 88,
    padding: space[3],
    textAlignVertical: "top",
  },
});
