"use client";

import { useId } from "react";

import type { MoonPhaseKey } from "@/lib/domain/session-features";

// The four Lunar Phases moons (HF p.17), drawn inline: a night disc, the lit part in warm ivory with a few
// craters clipped to it, and a thin gold rim in the sheet's gold-line colour. No external images (U6).
//   new     the dark disc only, its rim catching a little light
//   waxing  a crescent lit on the right (the moon grows from the right, as seen from the north)
//   full    the whole disc lit
//   waning  a crescent lit on the left

const C = 32;
const R = 24;
/** Half-width of the terminator ellipse that cuts a crescent. */
const T = 8;

const LIT: Record<MoonPhaseKey, string | null> = {
  new: null,
  // Outer limb down the right side, terminator back up bulging right: a right-hand crescent.
  waxing: `M${C} ${C - R} A${R} ${R} 0 0 1 ${C} ${C + R} A${T} ${R} 0 0 0 ${C} ${C - R} Z`,
  full: `M${C} ${C - R} A${R} ${R} 0 1 1 ${C} ${C + R} A${R} ${R} 0 1 1 ${C} ${C - R} Z`,
  waning: `M${C} ${C - R} A${R} ${R} 0 0 0 ${C} ${C + R} A${T} ${R} 0 0 1 ${C} ${C - R} Z`,
};

/** Craters: [cx, cy, r]; drawn on the dark side faintly and on the lit side in a soft ochre. */
const CRATERS: [number, number, number][] = [
  [24, 23, 4.2],
  [39, 19, 2.6],
  [42, 36, 5],
  [27, 41, 3.1],
  [34, 30, 1.8],
  [47, 27, 2],
  [19, 33, 2.4],
];

export const MOON_NAMES: Record<MoonPhaseKey, string> = { new: "New moon", waxing: "Waxing moon", full: "Full moon", waning: "Waning moon" };

/** One moon as an `img` with its accessible name ("Waxing moon"). `glow` adds a soft gold halo (the current phase). */
export function MoonArt({ phase, glow = false, size = 64 }: { phase: MoonPhaseKey; glow?: boolean; size?: number }) {
  const uid = useId().replace(/:/g, "");
  const lit = LIT[phase];
  const ids = { night: `ln-n-${uid}`, light: `ln-l-${uid}`, halo: `ln-h-${uid}`, clip: `ln-c-${uid}` };
  return (
    <svg className="ln-moon" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={MOON_NAMES[phase]} data-phase={phase}>
      <defs>
        <radialGradient id={ids.night} cx="38%" cy="34%" r="75%">
          <stop offset="0%" stopColor="#3a4a55" />
          <stop offset="70%" stopColor="#1f2a31" />
          <stop offset="100%" stopColor="#141c21" />
        </radialGradient>
        <radialGradient id={ids.light} cx="42%" cy="36%" r="72%">
          <stop offset="0%" stopColor="#fffaea" />
          <stop offset="55%" stopColor="#f4e6bf" />
          <stop offset="100%" stopColor="#d9bf82" />
        </radialGradient>
        <radialGradient id={ids.halo} cx="50%" cy="50%" r="50%">
          <stop offset="62%" stopColor="#f3d68c" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f3d68c" stopOpacity="0" />
        </radialGradient>
        {lit ? (
          <clipPath id={ids.clip}>
            <path d={lit} />
          </clipPath>
        ) : null}
      </defs>
      {glow ? <circle cx={C} cy={C} r={31} fill={`url(#${ids.halo})`} /> : null}
      <circle cx={C} cy={C} r={R} fill={`url(#${ids.night})`} />
      <g fill="#0f161a" opacity="0.45">
        {CRATERS.map(([x, y, r]) => (
          <circle key={`d${x}-${y}`} cx={x} cy={y} r={r} />
        ))}
      </g>
      {lit ? (
        <>
          <path d={lit} fill={`url(#${ids.light})`} />
          <g clipPath={`url(#${ids.clip})`} fill="#c9a866" opacity="0.38">
            {CRATERS.map(([x, y, r]) => (
              <circle key={`l${x}-${y}`} cx={x} cy={y} r={r} />
            ))}
          </g>
        </>
      ) : (
        // New moon: earthshine on the limb so the disc still reads as a moon.
        <circle cx={C} cy={C} r={R - 0.8} fill="none" stroke="#e9dcb8" strokeOpacity="0.32" strokeWidth="1.2" />
      )}
      <circle cx={C} cy={C} r={R + 1.2} fill="none" stroke="#b08a3e" strokeWidth="1.4" opacity={glow ? 1 : 0.75} />
    </svg>
  );
}
