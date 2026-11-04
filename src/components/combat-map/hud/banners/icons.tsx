import type { ReactNode } from "react";

import { CONDITION_GLYPHS } from "../token/condition-icons";

/**
 * The banner's small glyphs, copied from CmpTokens 'Icons' (16 × 16, currentColor). Decorative: the banner's
 * description and the pip rows' labels say what they mean.
 */

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="hbn-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      {children}
    </svg>
  );
}

export function HeartIcon() {
  return (
    <Icon>
      <path d="M8 14s-5.5-3.4-5.5-7.2A3 3 0 0 1 8 4.9a3 3 0 0 1 5.5 1.9C13.5 10.6 8 14 8 14z" />
    </Icon>
  );
}

export function StressIcon() {
  return (
    <Icon>
      <path d="M8 1.5l1.6 3.2 3.5-1-1 3.5 3.2 1.6-3.2 1.6 1 3.5-3.5-1L8 14.5l-1.6-3.2-3.5 1 1-3.5L.7 8l3.2-1.6-1-3.5 3.5 1z" />
    </Icon>
  );
}

export function ArmorIcon() {
  return (
    <Icon>
      <path d="M8 1.5l5.5 2v4.3c0 3.2-2.4 5.5-5.5 6.7C4.9 13.3 2.5 11 2.5 7.8V3.5z" />
    </Icon>
  );
}

/** A condition's badge glyph: the token badge's (hud/token/condition-icons), a dot for any other condition. */
export function ConditionIcon({ id }: { id: string }) {
  return <Icon>{CONDITION_GLYPHS[id] ?? <circle cx="8" cy="8" r="3" />}</Icon>;
}
