import { StyleSheet } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";

export const sessionStyles = StyleSheet.create({
  stack: {
    gap: space[4],
    paddingBottom: space[8],
  },
  eyebrow: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 32,
    fontWeight: type.displayBold.fontWeight,
  },
  subhead: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  cardSelected: {
    borderColor: colors.brand,
  },
  label: {
    color: colors.label,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  muted: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  body: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    lineHeight: 22,
  },
  heading: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 20,
    fontWeight: type.displayBold.fontWeight,
  },
  input: {
    backgroundColor: colors.ink2,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minHeight: hit.minHeight,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  inputTitle: {
    fontFamily: type.displayBold.fontFamily,
    fontSize: 20,
    fontWeight: type.displayBold.fontWeight,
  },
  textArea: {
    minHeight: 120,
    paddingTop: space[3],
    textAlignVertical: "top",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  chip: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space[2],
    paddingVertical: 2,
  },
  chipLive: {
    backgroundColor: "#20352b",
    borderColor: "#9fdcb6",
  },
  chipPlayed: {
    backgroundColor: "#2d2614",
    borderColor: colors.brand,
  },
  chipText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
    fontWeight: "600",
  },
  chipTextLive: {
    color: "#9fdcb6",
  },
  chipTextPlayed: {
    color: colors.brand,
  },
  listItem: {
    gap: space[1],
    minHeight: hit.minHeight,
    paddingVertical: space[2],
  },
  sessionN: {
    color: colors.label,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
    letterSpacing: 1.1,
  },
  itemTitle: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 17,
    fontWeight: type.displayBold.fontWeight,
  },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  tab: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: hit.minHeight,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  tabActive: {
    backgroundColor: colors.ink2,
    borderColor: colors.brand,
  },
  tabText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    fontWeight: "600",
  },
  tabTextActive: {
    color: colors.brand,
  },
  liveDot: {
    backgroundColor: "#4f9e72",
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  liveTitle: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 17,
    fontWeight: type.displayBold.fontWeight,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  spotButton: {
    alignItems: "center",
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: hit.minHeight,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  spotDue: {
    borderColor: colors.brand,
  },
  spotCount: {
    color: colors.brand,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
    fontWeight: type.displayBold.fontWeight,
  },
  logRow: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: space[1],
    paddingVertical: space[2],
  },
  logTime: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
  },
});
