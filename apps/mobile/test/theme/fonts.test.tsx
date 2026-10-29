import fs from "node:fs";
import path from "node:path";
import { beforeEach, expect, jest, test } from "@jest/globals";
import { render } from "@testing-library/react-native";

import { brandFonts, fontFamily, useBrandFonts } from "../../src/theme/fonts";

const mockUseFonts = jest.fn((_map: unknown) => [true, null] as [boolean, Error | null]);

jest.mock("expo-font", () => ({
  useFonts: (map: unknown) => mockUseFonts(map),
}));

const fontsPath = path.resolve(__dirname, "../../src/theme/fonts.ts");

beforeEach(() => {
  mockUseFonts.mockClear();
});

test("loads the website faces through expo-font", () => {
  const source = fs.readFileSync(fontsPath, "utf8");
  expect(source).toContain('from "expo-font"');
  for (const symbol of [
    "Cinzel_500Medium",
    "Cinzel_700Bold",
    "Cinzel_900Black",
    "IBMPlexSans_400Regular",
    "IBMPlexSans_500Medium",
    "IBMPlexSans_600SemiBold",
    "EBGaramond_400Regular",
    "EBGaramond_400Regular_Italic",
    "EBGaramond_500Medium",
    "EBGaramond_500Medium_Italic",
  ]) {
    expect(source).toContain(symbol);
  }
  for (const extra of [
    "Cinzel_400Regular",
    "Cinzel_600SemiBold",
    "IBMPlexSans_700Bold",
    "EBGaramond_600SemiBold",
    "EBGaramond_700Bold",
  ]) {
    expect(source).not.toContain(extra);
  }

  expect(brandFonts).toEqual([
    {
      fontFamily: fontFamily.display,
      fontDefinitions: [
        { path: expect.anything(), weight: 500, style: "normal" },
        { path: expect.anything(), weight: 700, style: "normal" },
        { path: expect.anything(), weight: 900, style: "normal" },
      ],
    },
    {
      fontFamily: fontFamily.sans,
      fontDefinitions: [
        { path: expect.anything(), weight: 400, style: "normal" },
        { path: expect.anything(), weight: 500, style: "normal" },
        { path: expect.anything(), weight: 600, style: "normal" },
      ],
    },
    {
      fontFamily: fontFamily.serif,
      fontDefinitions: [
        { path: expect.anything(), weight: 400, style: "normal" },
        { path: expect.anything(), weight: 400, style: "italic" },
        { path: expect.anything(), weight: 500, style: "normal" },
        { path: expect.anything(), weight: 500, style: "italic" },
      ],
    },
  ]);
  expect(fontFamily).toEqual({
    display: "Cinzel",
    sans: "IBM Plex Sans",
    serif: "EB Garamond",
  });
});

test("useBrandFonts passes every face in one useFonts call", async () => {
  function Probe() {
    useBrandFonts();
    return null;
  }
  await render(<Probe />);
  expect(mockUseFonts).toHaveBeenCalledTimes(1);
  expect(mockUseFonts).toHaveBeenCalledWith(brandFonts);
});
