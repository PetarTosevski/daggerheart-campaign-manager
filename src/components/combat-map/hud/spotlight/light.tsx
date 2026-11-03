"use client";

import "./light.css";

import { useQuery } from "convex/react";
import type { CSSProperties } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { isLit, litOf, type SpotlightLit } from "./model";

/**
 * The spotlight on the map (bead dcm-bxp.99.32.35, user 2026-11-02: "When the spotlight is on a token have that token
 * illuminated as if a spotlight was shining on it (both players & adversaries)"). The token that holds the scene
 * spotlight (the PC holder's, or the adversary the GM spotlighted) stands in a stage light:
 *
 * - `SpotlightPool`: a soft warm pool of light on the map under the token, brightest in the middle, and a faint beam
 *   from above. Drawn in the token layer before the tokens, so every token, ring, arc and badge paints over it; never
 *   takes the pointer. The rest of the map is not dimmed.
 * - `TokenFace lit`: a gentle glow on the token itself (`.tk-lit`, hud/token/token.css).
 *
 * Read only inside the HUD (`on`): the same `combatSpotlight.state` subscription the spotlight parts share. A player's
 * layers only match tokens they already draw, so the light never reveals a fogged or hidden token.
 */

/** What the map lights now, or null (nobody in particular, the GM generally, loading, or the HUD is off). */
export function useSpotlightLit(campaignId: Id<"campaigns">, on: boolean): SpotlightLit | null {
  const state = useQuery(api.combatSpotlight.state, on ? { campaignId } : "skip");
  return on ? litOf(state) : null;
}

type PoolToken = { _id: string; kind?: string; characterId?: string; x: number; y: number; size: number };

/** The light pools under the lit tokens of one layer (stage pixels: `cell` per square, before the layer's zoom). */
export function SpotlightPools({ lit, tokens, cell }: { lit: SpotlightLit | null; tokens: readonly PoolToken[]; cell: number }) {
  if (lit === null) return null;
  return tokens.filter((t) => isLit(lit, t)).map((t) => <SpotlightPool key={`spot-${t._id}`} token={t} cell={cell} />);
}

function SpotlightPool({ token, cell }: { token: PoolToken; cell: number }) {
  const style = {
    left: (token.x + token.size / 2) * cell,
    top: (token.y + token.size / 2) * cell,
    "--s": `${token.size * cell}px`,
  } as CSSProperties;
  return (
    <div className="hud-spot-light" style={style} aria-hidden="true" data-testid="hud-spotlight-light" data-token={token._id}>
      <span className="hud-spot-beam" />
      <span className="hud-spot-pool" />
    </div>
  );
}
