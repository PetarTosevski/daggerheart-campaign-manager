import { StyleSheet } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";

export const accountStyles = StyleSheet.create({
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
  menuItem: {
    borderColor: "transparent",
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    minHeight: hit.minHeight + space[6],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  menuLabel: {
    ...type.displayBold,
    color: colors.parchment,
    fontSize: 22,
    letterSpacing: 1.6,
    textAlign: "center",
  },
  menuSub: {
    ...type.sans,
    color: colors.mutedText,
    fontSize: 13,
    textAlign: "center",
  },
  body: {
    ...type.sans,
    color: colors.body,
    fontSize: 15,
    lineHeight: 22,
  },
  label: {
    ...type.sans,
    color: colors.label,
    fontSize: 14,
    marginBottom: space[2],
  },
  input: {
    ...type.sans,
    backgroundColor: colors.ink2,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontSize: 16,
    minHeight: hit.minHeight + 6,
    paddingHorizontal: space[3],
  },
  codeInput: {
    ...type.displayBold,
    fontSize: 20,
    letterSpacing: 4,
    textTransform: "uppercase",
  },
  error: {
    ...type.sans,
    color: colors.danger,
    fontSize: 14,
  },
  eyebrow: {
    ...type.sansSemibold,
    color: colors.mutedText,
    fontSize: 13,
    letterSpacing: 2.2,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  cardOpen: {
    borderColor: colors.brand,
  },
});
