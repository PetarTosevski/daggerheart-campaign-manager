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

// The website's terrain painters draw every cell of a map in the JS Skia shim; on a 30 x 20 map that takes seconds per
// paint in jest. Screen tests count paints (`paintStats`) and read layout, never pixels, so the painters are no-ops
// here. Pixel tests (`canvas.test.ts`, `paint-frame`) do not import this file and keep the real painters. On a device
// the real painters run (docs/phone-client.md has the large-map speed check).
jest.mock("../../../../../src/lib/combat-map/painter", () => ({
  ...jest.requireActual<Record<string, unknown>>("../../../../../src/lib/combat-map/painter"),
  paintMap: () => undefined,
}));
jest.mock("../../../../../src/lib/combat-map/sprites/painter", () => ({
  ...jest.requireActual<Record<string, unknown>>("../../../../../src/lib/combat-map/sprites/painter"),
  paintMap: () => undefined,
}));

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
