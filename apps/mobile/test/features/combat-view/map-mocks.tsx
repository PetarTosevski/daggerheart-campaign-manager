// Native modules the combat map uses, for screen tests. Import this before the screen under test.
// Gesture handlers are recorded so a test can drive pan and pinch frames by hand (`mapGestures()`).
import { jest } from "@jest/globals";

export type Handler = (event: Record<string, number>) => void;
export type GestureHandlers = Record<string, Handler>;
type Registry = { pan: GestureHandlers; pinch: GestureHandlers };

type GestureGlobal = typeof globalThis & { __combatMapGestures?: Registry };

/** The handlers of the last pan and pinch gestures built. */
export function mapGestures(): Registry {
  const registry = (globalThis as GestureGlobal).__combatMapGestures;
  if (!registry) throw new Error("No combat map gesture was built");
  return registry;
}

jest.mock("react-native-gesture-handler", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  const g = globalThis as GestureGlobal;
  const chain = (kind: "pan" | "pinch") => {
    const handlers: GestureHandlers = {};
    g.__combatMapGestures = { ...(g.__combatMapGestures ?? { pan: {}, pinch: {} }), [kind]: handlers };
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_target, name: string) => (arg: unknown) => {
          if (typeof arg === "function") handlers[name] = arg as Handler;
          return builder;
        },
      },
    );
    return builder;
  };
  return {
    Gesture: {
      Pan: () => chain("pan"),
      Pinch: () => chain("pinch"),
      Simultaneous: (...gestures: unknown[]) => ({ gestures }),
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
  };
});

jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  const node = (testID: string) =>
    function SkiaNode({ children }: { children?: React.ReactNode }) {
      return React.createElement(View, { testID }, children);
    };
  return {
    Canvas: node("skia-canvas"),
    Group: node("skia-group"),
    Rect: node("skia-rect"),
    Image: node("skia-image"),
    // An uploaded image map "loads" as a 1000 x 800 picture.
    useImage: (url: string | null) => (url ? { width: () => 1000, height: () => 800 } : null),
  };
});
