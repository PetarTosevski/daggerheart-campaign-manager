"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { ActionsLayerProps } from "../../slots";
import { MINI_FEED_ROWS } from "../dice";
import { RESOLUTION_SCAN } from "../gm";
import { newActionFlashes } from "./model";

/**
 * Map layer (Play, both roles; plan combat-actions AA5): a flash on each token an adversary action names, the moment
 * its public row reaches the feed ("Bandit hit Mira", "Bandit missed Tabby"; Q14: players learn only hit or miss). The
 * row's `targets` name the tokens by id (followups-7 H3); adversary tokens a feature touched flash for the GM only.
 * The Encounter tab and the map write the same row, so actions from either page flash here. Rows already in the feed
 * when the map opened don't replay. A layer of its own above the fog, never catching the pointer; each flash plays
 * once (CSS) and is dropped when its animation ends.
 */
export function HitFlashLayer(props: ActionsLayerProps) {
  const { campaignId, map, viewport, role } = props;
  // The same page as the GM's Resolutions or the player's mini feed, so no extra subscription.
  const page = useQuery(api.feed.list, { campaignId, paginationOpts: { numItems: role === "gm" ? RESOLUTION_SCAN : MINI_FEED_ROWS, cursor: null } });
  // The GM reads every token (adversary tokens flash for the GM only, H3); a player only the PC tokens.
  const gm = role === "gm";
  const allTokens = useQuery(api.combatTokens.list, gm ? { campaignId, mapId: map._id } : "skip");
  const partyTokens = useQuery(api.combatTokens.party, gm ? "skip" : { campaignId, mapId: map._id });
  const tokens = gm ? allTokens : partyTokens;
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());

  if (page === undefined || tokens === undefined) return null;
  // The rows on screen when the map opened are history (adjusted during render, no effect: CL7).
  if (seen === null) {
    setSeen(new Set(page.page.map((r) => r._id)));
    return null;
  }
  const flashes = newActionFlashes(page.page, seen, tokens, gm).filter((f) => !done.has(f.key));
  if (flashes.length === 0) return null;
  const step = viewport.cell * viewport.zoom;
  return (
    <div className="cmx-flashes" aria-hidden="true" data-testid="combat-hit-flashes">
      {flashes.map((f) => {
        const size = f.size * step;
        return (
          <div
            key={f.key}
            className="cmx-flash"
            data-tone={f.tone}
            data-testid="combat-hit-flash"
            style={{ left: (f.x + viewport.pad) * step, top: (f.y + viewport.pad) * step, width: size, height: size }}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) setDone((d) => new Set(d).add(f.key));
            }}
          >
            <span className="cmx-flash-lbl">{f.label}</span>
          </div>
        );
      })}
    </div>
  );
}
