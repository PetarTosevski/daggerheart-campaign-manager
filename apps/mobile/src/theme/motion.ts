import { useReducedMotion } from "react-native-reanimated";

/**
 * Every animation duration in the phone app, in milliseconds.
 *
 * `useReducedMotion` (react-native-reanimated) reports whether reduced motion
 * was on when the app started. It does not rerender when the setting changes.
 * While it is true, every duration here is 0. Animations still run through
 * `withTiming`, so a 0 duration settles on the first frame.
 */
export const duration = {
  press: 80,
  fade: 160,
  sheet: 240,
  roll: 360,
} as const;

export type DurationName = keyof typeof duration;

const zeroDuration = Object.fromEntries(
  (Object.keys(duration) as DurationName[]).map((name) => [name, 0]),
) as { [K in DurationName]: number };

export function useDuration(): { [K in DurationName]: number } {
  return useReducedMotion() ? zeroDuration : duration;
}
