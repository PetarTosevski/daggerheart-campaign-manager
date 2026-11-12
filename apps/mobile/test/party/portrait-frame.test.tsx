import { expect, jest, test } from "@jest/globals";
import { StyleSheet } from "react-native";

// First: it mocks Reanimated before any screen module loads it.
import "../theme/mock-reanimated";

import type { Id } from "../../src/convex";
import { PortraitControl, portraitImageFrame } from "../../src/features/party/portrait";
import { renderAsPlayer } from "../harness";

// The picture as a plain View that keeps expo-image's props, so the test reads the framing it was given.
jest.mock("expo-image", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  return {
    Image: (props: Record<string, unknown>) => React.createElement(View, props),
  };
});

const characterId = "characters_1" as Id<"characters">;

function show(portraitFrame?: { zoom: number; x: number; y: number }) {
  return renderAsPlayer(
    <PortraitControl
      canEdit={false}
      characterId={characterId}
      hasPortrait
      name="Mira"
      portraitFrame={portraitFrame}
      portraitUrl="https://example.test/mira.png"
    />,
  );
}

test("without a frame the portrait draws as before: cover, centred, unscaled, rounded", async () => {
  const screen = await show();
  const image = screen.getByTestId("portrait-image");
  expect(image.props.contentFit).toBe("cover");
  expect(image.props.contentPosition).toBeUndefined();
  const style = StyleSheet.flatten(image.props.style);
  expect(style).toEqual({ borderRadius: 28, height: 56, width: 56 });
  expect(portraitImageFrame(undefined)).toBeNull();
  expect(portraitImageFrame(null)).toBeNull();
});

test("a saved frame aligns the picture at its focal point and scales it about that point inside the clipped mark", async () => {
  const screen = await show({ zoom: 2, x: 40, y: 20 });
  const image = screen.getByTestId("portrait-image");
  expect(image.props.contentFit).toBe("cover");
  expect(image.props.contentPosition).toEqual({ left: "40%", top: "20%" });
  const style = StyleSheet.flatten(image.props.style);
  expect(style.transform).toEqual([{ scale: 2 }]);
  expect(style.transformOrigin).toBe("40% 20%");
  expect(style.borderRadius).toBeUndefined();
  expect(screen.getByLabelText("Portrait of Mira")).toBeTruthy();
});

test("the numbers come from the shared helper's clamp: out-of-range values draw at the limits", () => {
  expect(portraitImageFrame({ zoom: 9, x: -5, y: 140 })).toEqual({
    contentPosition: { left: "0%", top: "100%" },
    style: { transform: [{ scale: 3 }], transformOrigin: "0% 100%" },
  });
});
