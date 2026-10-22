"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { ActionsLayerProps } from "../../slots";
import { MINI_FEED_ROWS } from "../dice";
import { RESOLUTION_SCAN } from "../gm";
import { newActionFlashes } from "./model";

/**
 * Map layer (Play, both roles; plan combat-actions AA5): a flash on each PC token an adversary action names, the moment
 * its public row reaches the feed ("Bandit hit Mira", "Bandit missed Tabby"; Q14: players learn only hit or miss).
 * The Encounter tab and the map write the same row, so actions from either page flash here. Rows already in the feed
 * when the map opened don't replay. A layer of its own above the fog, never catching the pointer; each flash plays
 * once (CSS) and is dropped when its animation ends.
 */
export function HitFlashLayer(props: ActionsLayerProps) {
  const { campaignId, map, viewport, role } = props;
  // The same page as the GM's Resolutions or the player's mini feed, so no extra subscription.
  const page = useQuery(api.feed.list, { campaignId, paginationOpts: { numItems: role === "gm" ? RESOLUTION_SCAN : MINI_FEED_ROWS, cursor: null } });
  const tokens = useQuery(api.combatTokens.party, { campaignId, mapId: map._id });
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());

  if (page === undefined || tokens === undefined) return null;
  // The rows on screen when the map opened are history (adjusted during render, no effect: CL7).
  if (seen === null) {
    setSeen(new Set(page.page.map((r) => r._id)));
    return null;
  }
  const flashes = newActionFlashes(page.page, seen, tokens).filter((f) => !done.has(f.key));
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
