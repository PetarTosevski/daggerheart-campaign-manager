import { jest } from "@jest/globals";

jest.mock("react-native-gesture-handler", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  const chain = () => ({
    onBegin: () => chain(),
    onUpdate: () => chain(),
    onEnd: () => chain(),
    runOnJS: () => chain(),
  });
  return {
    Gesture: {
      Pan: chain,
      Pinch: chain,
      Simultaneous: () => chain(),
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
  };
});

jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  return {
    Canvas: ({ children }: { children: React.ReactNode }) => React.createElement(View, { testID: "skia-canvas" }, children),
    Path: () => React.createElement(View, { testID: "skia-path" }),
    Group: ({ children }: { children: React.ReactNode }) => children,
    Skia: {
      Path: {
        MakeFromSVGString: () => ({}),
        Make: () => ({}),
      },
    },
  };
});

jest.mock("expo-image", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  return { Image: () => React.createElement(View, { testID: "map-image" }) };
});

jest.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));
