"use client";

import "./token.css";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { HudTokenFace, TokenArcs, TokenCondition } from "./model";

/** Most condition badges drawn side by side; the rest show as "+n" (the label names them all). */
const MAX_BADGES = 3;

/** The board's arc halves (viewBox -50..50): from the bottom up the left side (HP) and the right side (Stress). */
const LEFT_HALF = "M0 46A46 46 0 0 1 0 -46";
const RIGHT_HALF = "M0 46A46 46 0 0 0 0 -46";

const HOPE_ICON = "M8 1l1.8 4.6L14.5 6l-3.6 3 1.1 4.7L8 11.3 4 13.7l1.1-4.7L1.5 6l4.7-.4z";

/** The board's condition icons (CmpTokens "Icons"); a condition without one shows its initial. */
const CONDITION_ICONS: Record<string, ReactNode> = {
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
};

function Arcs({ arcs }: { arcs: TokenArcs }) {
  return (
    <svg className="tk-arc" viewBox="-50 -50 100 100" aria-hidden="true" data-testid="hud-token-arc">
      <path className="a-bg" d={LEFT_HALF} pathLength={100} />
      <path className="a-bg" d={RIGHT_HALF} pathLength={100} />
      <path className="a-hp" d={LEFT_HALF} pathLength={100} strokeDasharray={`${arcs.hpLeft} 100`} />
      <path className="a-st" d={RIGHT_HALF} pathLength={100} strokeDasharray={`${arcs.stressMarked} 100`} />
    </svg>
  );
}

function Badges({ conditions }: { conditions: readonly TokenCondition[] }) {
  if (conditions.length === 0) return null;
  const shown = conditions.slice(0, MAX_BADGES);
  const more = conditions.length - shown.length;
  return (
    <span className="tk-cds">
      {shown.map((c) => {
        const icon = CONDITION_ICONS[c.id];
        return (
          <span key={c.id} className={cn("tk-cd", `tk-cd-${c.id}`)} title={c.label} data-condition={c.id}>
            {icon ? (
              <svg className="ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
                {icon}
              </svg>
            ) : (
              c.label.charAt(0)
            )}
          </span>
        );
      })}
      {more > 0 ? <span className="tk-cd tk-cd-more">+{more}</span> : null}
    </span>
  );
}

export type TokenFaceProps = {
  face: Omit<HudTokenFace, "label" | "sheet">;
  name: string;
  /** Initials for a face without art. */
  initials: string;
  /** The token's footprint in stage pixels (the board's `--s`: one square, or more for a large token). */
  size: number;
};

/**
 * One HUD token's look (plan combat-hud H1.3; HANDOFF "Tokens"; CmpTokens "Token anatomy" / "Token kinds"), centred on
 * the token button it sits in: the side-coloured face (portrait or initials), `svg.tk-arc` with HP left on the left
 * half and Stress marked on the right (pathLength 100, stroke-dasharray), the gold Hope chip top right, the condition
 * badges bottom right and the name tag below. Purely visual (aria-hidden): the button's accessible name says it all.
 * Arcs and Hope come in only when the viewer may see them (`model.ts` `showsNumbers`).
 */
export function TokenFace({ face, name, initials, size }: TokenFaceProps) {
  return (
    <span
      className={cn("hud-tk-c", `tk-${face.tone}`, face.down && "tk-down")}
      style={{ "--s": `${size}px` } as CSSProperties}
      aria-hidden="true"
      data-testid="hud-token-face"
      data-tone={face.tone}
    >
      {face.arcs ? <Arcs arcs={face.arcs} /> : null}
      <span className="tk-face">
        {face.art ? (
          <Image
            src={face.art.src}
            alt=""
            fill
            sizes={`${Math.max(32, Math.round(size))}px`}
            unoptimized={face.art.remote}
            className="tk-img"
            style={{ objectPosition: face.art.position }}
          />
        ) : (
          <span className="tk-ini">{initials}</span>
        )}
      </span>
      <span className="tk-name">{name}</span>
      {face.hope !== null ? (
        <span className="tk-hope" title="Hope" data-testid="hud-token-hope">
          <svg className="ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <path d={HOPE_ICON} />
          </svg>
          {face.hope}
        </span>
      ) : null}
      <Badges conditions={face.conditions} />
    </span>
  );
}
