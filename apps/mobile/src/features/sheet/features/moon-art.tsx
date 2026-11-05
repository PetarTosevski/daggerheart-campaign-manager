import Svg, { Circle, ClipPath, Defs, G, Path, RadialGradient, Stop } from "react-native-svg";

import type { MoonPhaseKey } from "../../../../../../src/lib/domain/session-features";

const C = 32;
const R = 24;
const T = 8;

const LIT: Record<MoonPhaseKey, string | null> = {
  new: null,
  waxing: `M${C} ${C - R} A${R} ${R} 0 0 1 ${C} ${C + R} A${T} ${R} 0 0 0 ${C} ${C - R} Z`,
  full: `M${C} ${C - R} A${R} ${R} 0 1 1 ${C} ${C + R} A${R} ${R} 0 1 1 ${C} ${C - R} Z`,
  waning: `M${C} ${C - R} A${R} ${R} 0 0 0 ${C} ${C + R} A${T} ${R} 0 0 1 ${C} ${C - R} Z`,
};

const CRATERS: [number, number, number][] = [
  [24, 23, 4.2],
  [39, 19, 2.6],
  [42, 36, 5],
  [27, 41, 3.1],
  [34, 30, 1.8],
  [47, 27, 2],
  [19, 33, 2.4],
];

export const MOON_NAMES: Record<MoonPhaseKey, string> = {
  new: "New moon",
  waxing: "Waxing moon",
  full: "Full moon",
  waning: "Waning moon",
};

export function MoonArt({ phase, glow = false, size = 64 }: { phase: MoonPhaseKey; glow?: boolean; size?: number }) {
  const lit = LIT[phase];
  const uid = phase;
  const ids = { night: `ln-n-${uid}`, light: `ln-l-${uid}`, halo: `ln-h-${uid}`, clip: `ln-c-${uid}` };
  return (
    <Svg accessibilityLabel={MOON_NAMES[phase]} accessibilityRole="image" height={size} viewBox="0 0 64 64" width={size}>
      <Defs>
        <RadialGradient cx="38%" cy="34%" id={ids.night} r="75%">
          <Stop offset="0%" stopColor="#3a4a55" />
          <Stop offset="70%" stopColor="#1f2a31" />
          <Stop offset="100%" stopColor="#141c21" />
        </RadialGradient>
        <RadialGradient cx="42%" cy="36%" id={ids.light} r="72%">
          <Stop offset="0%" stopColor="#fffaea" />
          <Stop offset="55%" stopColor="#f4e6bf" />
          <Stop offset="100%" stopColor="#d9bf82" />
        </RadialGradient>
        <RadialGradient cx="50%" cy="50%" id={ids.halo} r="50%">
          <Stop offset="62%" stopColor="#f3d68c" stopOpacity="0.55" />
          <Stop offset="100%" stopColor="#f3d68c" stopOpacity="0" />
        </RadialGradient>
        {lit ? (
          <ClipPath id={ids.clip}>
            <Path d={lit} />
          </ClipPath>
        ) : null}
      </Defs>
      {glow ? <Circle cx={C} cy={C} fill={`url(#${ids.halo})`} r={31} /> : null}
      <Circle cx={C} cy={C} fill={`url(#${ids.night})`} r={R} />
      <G fill="#0f161a" opacity={0.45}>
        {CRATERS.map(([x, y, r]) => (
          <Circle key={`d${x}-${y}`} cx={x} cy={y} r={r} />
        ))}
      </G>
      {lit ? (
        <>
          <Path d={lit} fill={`url(#${ids.light})`} />
          <G clipPath={`url(#${ids.clip})`} fill="#c9a866" opacity={0.38}>
            {CRATERS.map(([x, y, r]) => (
              <Circle key={`l${x}-${y}`} cx={x} cy={y} r={r} />
            ))}
          </G>
        </>
      ) : (
        <Circle cx={C} cy={C} fill="none" r={R - 0.8} stroke="#e9dcb8" strokeOpacity={0.32} strokeWidth={1.2} />
      )}
      <Circle cx={C} cy={C} fill="none" opacity={glow ? 1 : 0.75} r={R + 1.2} stroke="#b08a3e" strokeWidth={1.4} />
    </Svg>
  );
}
