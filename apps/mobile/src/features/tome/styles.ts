import { StyleSheet } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";

export const INK = "#2a1f14";
export const RUBRIC = "#8e2b2b";
export const PARCHMENT = "#efe3c8";
export const PANEL = "#e3d2ad";

export const tomeStyles = StyleSheet.create({
  stack: {
    gap: space[4],
    paddingBottom: space[8],
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 32,
    fontWeight: type.displayBold.fontWeight,
  },
  book: {
    backgroundColor: PARCHMENT,
    borderRadius: radius.lg,
    gap: space[3],
    padding: space[4],
  },
  kicker: {
    color: "#7a5b2e",
    fontFamily: type.displayBold.fontFamily,
    fontSize: 13,
    fontWeight: type.displayBold.fontWeight,
    letterSpacing: 2.8,
    textTransform: "uppercase",
  },
  bookTitle: {
    color: INK,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
  chapterNav: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  chapterActive: {
    backgroundColor: PANEL,
    borderColor: RUBRIC,
    borderLeftWidth: 3,
  },
  chapterButton: {
    borderColor: "transparent",
    borderLeftWidth: 3,
    borderRadius: radius.md,
    minHeight: 44,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  chapterLabel: {
    color: INK,
    fontFamily: type.serif.fontFamily,
    fontSize: 16,
    fontStyle: type.serif.fontStyle,
    fontWeight: type.serif.fontWeight,
  },
  chapterNumeral: {
    color: RUBRIC,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 16,
    fontWeight: type.displayBold.fontWeight,
    width: 36,
  },
  note: {
    color: "#6a5236",
    fontFamily: type.serif.fontFamily,
    fontSize: 15,
    fontStyle: "italic",
    fontWeight: type.serif.fontWeight,
  },
  body: {
    color: INK,
    fontFamily: type.serif.fontFamily,
    fontSize: 17,
    fontStyle: type.serif.fontStyle,
    fontWeight: type.serif.fontWeight,
    lineHeight: 26,
  },
  ruleCard: {
    backgroundColor: PANEL,
    borderColor: "#cdb88f",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: space[3],
    padding: space[3],
  },
  ruleNumber: {
    alignItems: "center",
    borderColor: RUBRIC,
    borderRadius: 999,
    borderWidth: 2,
    color: RUBRIC,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 15,
    fontWeight: type.displayBold.fontWeight,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  ruleHead: {
    color: INK,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 16,
    fontWeight: type.displayBold.fontWeight,
  },
  figureCard: {
    backgroundColor: PANEL,
    borderColor: "#cdb88f",
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[1],
    padding: space[3],
  },
  figureName: {
    color: INK,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 16,
    fontWeight: type.displayBold.fontWeight,
  },
  figureRole: {
    color: "#6a5236",
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    fontWeight: type.sans.fontWeight,
  },
  gmNote: {
    backgroundColor: "#2f4a3a",
    borderRadius: radius.md,
    color: "#eef3ea",
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    padding: space[3],
  },
  setupBlock: {
    backgroundColor: "#e8d9b8",
    borderColor: "#cdb88f",
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[1],
    padding: space[3],
  },
  setupHeading: {
    color: "#6f5530",
    fontFamily: type.displayBold.fontFamily,
    fontSize: 12,
    fontWeight: type.displayBold.fontWeight,
    letterSpacing: 1.8,
  },
  setupRow: {
    color: INK,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    fontWeight: type.sans.fontWeight,
  },
  editor: {
    backgroundColor: "#f5ecd8",
    borderColor: "#cdb88f",
    borderRadius: radius.md,
    borderWidth: 1,
    color: INK,
    fontFamily: type.serif.fontFamily,
    fontSize: 17,
    minHeight: 220,
    padding: space[3],
    textAlignVertical: "top",
  },
  saveStatus: {
    color: "#6a5236",
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    fontWeight: type.sans.fontWeight,
  },
});
