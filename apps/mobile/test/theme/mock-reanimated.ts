import { jest } from "@jest/globals";

type TimingCall = { duration?: number };

type MotionGlobal = typeof globalThis & {
  __phoneReducedMotion?: boolean;
  __phoneTiming?: TimingCall[];
};

function motionGlobal(): MotionGlobal {
  return globalThis as MotionGlobal;
}

export function setReducedMotion(on: boolean): void {
  motionGlobal().__phoneReducedMotion = on;
}

export function timingCalls(): TimingCall[] {
  return motionGlobal().__phoneTiming ?? [];
}

export function resetMotionTest(): void {
  setReducedMotion(false);
  motionGlobal().__phoneTiming = [];
}

jest.mock("react-native-reanimated", () => {
  // jest.mock is hoisted above imports, so the factory cannot reference them.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text, View } = require("react-native") as typeof import("react-native");
  const state = globalThis as MotionGlobal;
  const createAnimatedComponent = <T,>(Component: T) => Component;
  return {
    __esModule: true,
    default: { View, Text, createAnimatedComponent },
    createAnimatedComponent,
    useSharedValue: <T,>(initial: T) => {
      const [box] = React.useState(() => ({ value: initial }));
      return box;
    },
    useAnimatedStyle: (updater: () => Record<string, unknown>) => updater(),
    useReducedMotion: () => state.__phoneReducedMotion === true,
    withTiming: (to: unknown, config?: TimingCall, callback?: (finished?: boolean) => void) => {
      (state.__phoneTiming ??= []).push(config ?? {});
      callback?.(true);
      return to;
    },
  };
});
