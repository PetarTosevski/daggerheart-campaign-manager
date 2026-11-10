import { StyleSheet } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";

export const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.ink },
  stack: { padding: space[4], gap: space[4], paddingBottom: space[8] },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
  section: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space[4],
    gap: space[3],
  },
  sectionTitle: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    fontWeight: type.sansSemibold.fontWeight,
  },
  muted: { color: colors.mutedText, fontFamily: type.sans.fontFamily, fontSize: 14, lineHeight: 20 },
  label: { color: colors.mutedText, fontFamily: type.sans.fontFamily, fontSize: 13, fontWeight: type.sansSemibold.fontWeight },
  input: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    minHeight: hit.minHeight,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2], alignItems: "center" },
  between: { justifyContent: "space-between" },
  err: { color: colors.danger, fontFamily: type.sans.fontFamily, fontSize: 14 },
  spriteList: { gap: space[3] },
  spriteCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space[3],
    gap: space[2],
  },
  thumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.ink2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
});
