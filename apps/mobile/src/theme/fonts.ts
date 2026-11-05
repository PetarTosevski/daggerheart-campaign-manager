import {
  Cinzel_500Medium,
  Cinzel_700Bold,
  Cinzel_900Black,
} from "@expo-google-fonts/cinzel";
import {
  EBGaramond_400Regular,
  EBGaramond_400Regular_Italic,
  EBGaramond_500Medium,
  EBGaramond_500Medium_Italic,
} from "@expo-google-fonts/eb-garamond";
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
} from "@expo-google-fonts/ibm-plex-sans";
import { useFonts, type FontFamilyDefinition } from "expo-font";

/**
 * The families `src/app/layout.tsx` loads: Cinzel 500/700/900, IBM Plex Sans
 * 400/500/600, EB Garamond 400/500 upright and italic.
 *
 * One `useFonts` call lists every face of a family. expo-font loads a family
 * once; a later call does not add faces the first call left out.
 */
export const fontFamily = {
  display: "Cinzel",
  sans: "IBM Plex Sans",
  serif: "EB Garamond",
} as const;

export const brandFonts: FontFamilyDefinition[] = [
  {
    fontFamily: fontFamily.display,
    fontDefinitions: [
      { path: Cinzel_500Medium, weight: 500, style: "normal" },
      { path: Cinzel_700Bold, weight: 700, style: "normal" },
      { path: Cinzel_900Black, weight: 900, style: "normal" },
    ],
  },
  {
    fontFamily: fontFamily.sans,
    fontDefinitions: [
      { path: IBMPlexSans_400Regular, weight: 400, style: "normal" },
      { path: IBMPlexSans_500Medium, weight: 500, style: "normal" },
      { path: IBMPlexSans_600SemiBold, weight: 600, style: "normal" },
    ],
  },
  {
    fontFamily: fontFamily.serif,
    fontDefinitions: [
      { path: EBGaramond_400Regular, weight: 400, style: "normal" },
      { path: EBGaramond_400Regular_Italic, weight: 400, style: "italic" },
      { path: EBGaramond_500Medium, weight: 500, style: "normal" },
      { path: EBGaramond_500Medium_Italic, weight: 500, style: "italic" },
    ],
  },
];

export const type = {
  displayBlack: { fontFamily: fontFamily.display, fontWeight: "900" as const },
  displayBold: { fontFamily: fontFamily.display, fontWeight: "700" as const },
  displayMedium: { fontFamily: fontFamily.display, fontWeight: "500" as const },
  sans: { fontFamily: fontFamily.sans, fontWeight: "400" as const },
  sansMedium: { fontFamily: fontFamily.sans, fontWeight: "500" as const },
  sansSemibold: { fontFamily: fontFamily.sans, fontWeight: "600" as const },
  serif: {
    fontFamily: fontFamily.serif,
    fontWeight: "400" as const,
    fontStyle: "normal" as const,
  },
  serifItalic: {
    fontFamily: fontFamily.serif,
    fontWeight: "400" as const,
    fontStyle: "italic" as const,
  },
  serifMedium: {
    fontFamily: fontFamily.serif,
    fontWeight: "500" as const,
    fontStyle: "normal" as const,
  },
  serifMediumItalic: {
    fontFamily: fontFamily.serif,
    fontWeight: "500" as const,
    fontStyle: "italic" as const,
  },
} as const;

/** Loads every brand face. Call this once, before branded text paints. */
export function useBrandFonts(): [boolean, Error | null] {
  return useFonts(brandFonts);
}
