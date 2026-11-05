import { StyleSheet } from "react-native";

import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { hit, radius, space } from "../../../theme/spacing";

export const wizardStyles = StyleSheet.create({
  screen: {
    backgroundColor: colors.ink,
    flex: 1,
  },
  content: {
    gap: space[4],
    paddingBottom: space[10],
    paddingHorizontal: space[4],
    paddingTop: space[2],
  },
  paper: {
    backgroundColor: colors.parchment,
    borderRadius: radius.lg,
    gap: space[4],
    padding: space[4],
  },
  kicker: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    color: colors.brandInk,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 26,
    fontWeight: type.displayBold.fontWeight,
  },
  lead: {
    color: colors.brandInk,
    fontFamily: type.serif.fontFamily,
    fontSize: 17,
    lineHeight: 24,
  },
  label: {
    color: colors.brandInk,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 14,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  hint: {
    color: "#6a5236",
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  req: {
    color: "#6a5236",
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    textAlign: "right",
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    textAlign: "right",
  },
  blocked: {
    backgroundColor: "#f3e6c8",
    borderColor: "#cdb88f",
    borderRadius: radius.md,
    borderWidth: 1,
    color: "#3a2a14",
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    padding: space[3],
  },
  stepRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  stepDot: {
    alignItems: "center",
    borderColor: "#cdb88f",
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: hit.minHeight,
    minWidth: 44,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  stepDotCurrent: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  stepDotDone: {
    backgroundColor: "#e8dcc0",
  },
  stepDotText: {
    color: colors.brandInk,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
  },
  choice: {
    borderColor: "#cdb88f",
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[1],
    minHeight: hit.minHeight,
    padding: space[3],
  },
  choiceOn: {
    backgroundColor: "#f3e6c8",
    borderColor: colors.brand,
  },
  choiceTitle: {
    color: colors.brandInk,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  input: {
    backgroundColor: "#fffef8",
    borderColor: "#cdb88f",
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.brandInk,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minHeight: hit.minHeight,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  footer: {
    borderTopColor: "#cdb88f",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
    justifyContent: "space-between",
    paddingTop: space[4],
  },
  count: {
    color: "#3d5e2e",
    fontFamily: type.displayBold.fontFamily,
    fontSize: 16,
  },
});
