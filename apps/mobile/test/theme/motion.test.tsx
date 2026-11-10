import { beforeEach, expect, test } from "@jest/globals";
import { renderHook } from "@testing-library/react-native";

import { resetMotionTest, setReducedMotion } from "./mock-reanimated";
import { duration, useDuration } from "../../src/theme/motion";

beforeEach(() => {
  resetMotionTest();
});

test("durations stay as declared when reduced motion is off", async () => {
  const hook = await renderHook(() => useDuration());
  expect(hook.result.current).toEqual(duration);
  expect(Object.values(hook.result.current).every((value) => value > 0)).toBe(true);
});

test("useReducedMotion turns every duration to 0", async () => {
  setReducedMotion(true);
  const hook = await renderHook(() => useDuration());
  expect(Object.keys(hook.result.current).sort()).toEqual(Object.keys(duration).sort());
  expect(Object.values(hook.result.current)).toEqual(Object.keys(duration).map(() => 0));
});
