import type { ReactNode } from "react";

/**
 * The condition glyphs (16 × 16, currentColor) drawn inside a token's round badge (`.tk-cd`) and a banner's condition
 * row. Hidden, Vulnerable and Restrained are the CmpTokens "Icons" board's; the board drew none for the other three,
 * so they follow the user's picks (bead dcm-bxp.99.32.39, 2026-11-02): Cloaked a hood, Unconscious a closed eye,
 * Distracted a swirl. Decorative: the badge's title and the token's accessible name say the condition.
 */
export const CONDITION_GLYPHS: Readonly<Record<string, ReactNode>> = {
  hidden: (
    <>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2" />
      <path d="M2.5 13.5l11-11" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  vulnerable: (
    <>
      <path d="M8 1.5l5.5 2v4.3c0 3.2-2.4 5.5-5.5 6.7C4.9 13.3 2.5 11 2.5 7.8V3.5z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.8 3.2L6.6 7.4l2.6.5-1.8 4.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </>
  ),
  restrained: (
    <>
      <rect x="1.5" y="5" width="7" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7.5" y="5" width="7" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  /** A hood seen from the front: the peaked cowl with the face in shadow. */
  cloaked: (
    <path
      fillRule="evenodd"
      d="M8 .6C5 1.6 3.4 4.3 3.4 7.3c0 2-.6 3.4-1.6 4.6-.7.9-1.2 1.9-1.3 3.1h15c-.1-1.2-.6-2.2-1.3-3.1-1-1.2-1.6-2.6-1.6-4.6C12.6 4.3 11 1.6 8 .6zM8 4.6c-1.8 0-3 1.7-3 3.9 0 1.9 1.1 3.5 3 4.8 1.9-1.3 3-2.9 3-4.8 0-2.2-1.2-3.9-3-3.9z"
    />
  ),
  /** A closed eye: the lid's curve and three lashes. */
  unconscious: (
    <>
      <path d="M1.8 6.2c1.6 2.7 3.7 4 6.2 4s4.6-1.3 6.2-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.3 9.2l-1.1 1.9M8 10.3v2.3M11.7 9.2l1.1 1.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  /** A swirl: four growing half-turns. */
  distracted: (
    <path d="M8 7.3a1.35 1.35 0 0 1 2.7 0a2.7 2.7 0 0 1-5.4 0a4.05 4.05 0 0 1 8.1 0a5.4 5.4 0 0 1-10.8 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  ),
};
