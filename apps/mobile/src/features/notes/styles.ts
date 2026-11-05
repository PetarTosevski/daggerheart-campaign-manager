import { StyleSheet } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";

export const notesStyles = StyleSheet.create({
  screen: {
    gap: space[4],
    paddingBottom: space[8],
  },
  hero: {
    gap: space[2],
  },
  campaign: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
  sub: {
    color: colors.body,
    fontFamily: type.serif.fontFamily,
    fontSize: 16,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  indexBlock: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[3],
    padding: space[3],
  },
  label: {
    color: colors.subtle,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  muted: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  empty: {
    color: colors.body,
    fontFamily: type.serif.fontFamily,
    fontSize: 15,
    fontStyle: "italic",
  },
  paper: {
    backgroundColor: colors.parchment,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  tape: {
    alignSelf: "flex-start",
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    color: colors.brandInk,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 14,
    overflow: "hidden",
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  line: {
    color: colors.brandInk,
    fontFamily: type.serif.fontFamily,
    fontSize: 17,
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  pageTitle: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.brandInk,
    flexGrow: 1,
    fontFamily: type.serif.fontFamily,
    fontSize: 20,
    minWidth: 160,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  meta: {
    color: colors.brandInk,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    opacity: 0.75,
  },
  chip: {
    backgroundColor: colors.ink,
    borderColor: colors.line2,
    borderRadius: radius.pill,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space[2],
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  card: {
    backgroundColor: colors.ink,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  cardText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
});
