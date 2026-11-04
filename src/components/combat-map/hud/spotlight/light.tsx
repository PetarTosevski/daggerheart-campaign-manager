"use client";

import "./light.css";

import { useQuery } from "convex/react";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { litOf, poolOf, type SpotlightLit } from "./model";

/**
 * The spotlight on the map (bead dcm-bxp.99.32.35, user 2026-11-02: "When the spotlight is on a token have that token
 * illuminated as if a spotlight was shining on it (both players & adversaries)"; H9.1, CmpTokens 'Spotlight' map light
 * and CmpTokensDesign motion). The token that holds the scene spotlight stands in a stage light:
 *
 * - `SpotlightPools`: a soft pool of light on the map under the token, brightest in the middle, and a faint beam from
 *   above: warm gold under a PC holder, lilac under an adversary the GM spotlighted. While the whole party holds it
 *   (nobody chosen) every PC gets a smaller, dimmer gold pool and no beam. Drawn in the token layer before the tokens,
 *   so every token, ring, arc and badge paints over it; never takes the pointer. The rest of the map is not dimmed.
 *   Every token the layer draws has a pool element; only the lit ones show (`data-on`), so the light fades out under
 *   the old holder and in under the new one (300 ms; none under prefers-reduced-motion). Only lit pools carry the
 *   `hud-spotlight-light` test id.
 * - `TokenFace lit`: a gentle glow on the holder's token itself (`.tk-lit`, hud/token/token.css).
 *
 * Read only inside the HUD (`on`): the same `combatSpotlight.state` subscription the spotlight parts share. A player's
 * layers only match tokens they already draw, so the light never reveals a fogged or hidden token.
 */

/** What the map lights now, or null (the GM generally, loading, or the HUD is off). */
export function useSpotlightLit(campaignId: Id<"campaigns">, on: boolean): SpotlightLit | null {
  const state = useQuery(api.combatSpotlight.state, on ? { campaignId } : "skip");
  return on ? litOf(state) : null;
}

type PoolToken = { _id: string; kind?: string; characterId?: string; x: number; y: number; size: number };

/** The light pools of one layer (stage pixels: `cell` per square, before the layer's zoom). */
export function SpotlightPools({ lit, tokens, cell }: { lit: SpotlightLit | null; tokens: readonly PoolToken[]; cell: number }) {
  if (lit === null) return null;
  return tokens.map((t) => {
    const kind = poolOf(lit, t);
    const style = {
      left: (t.x + t.size / 2) * cell,
      top: (t.y + t.size / 2) * cell,
      "--s": `${t.size * cell}px`,
    } as CSSProperties;
    return (
      <div
        key={`spot-${t._id}`}
        className={cn("hud-spot-light", kind === "gm" && "hud-spot-light-gm", kind === "party" && "hud-spot-light-party")}
        style={style}
        aria-hidden="true"
        data-on={kind === null ? "false" : "true"}
        data-pool={kind ?? undefined}
        data-testid={kind === null ? undefined : "hud-spotlight-light"}
        data-token={t._id}
      >
        <span className="hud-spot-beam" />
        <span className="hud-spot-pool" />
      </div>
    );
  });
}
