"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { LIGHT_LEVELS, LIGHT_LEVEL_LABEL, type LightLevel } from "@/lib/domain/combat-map/light";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * `campaigns.setTimeOfDay` as an intent (the one field) with an optimistic update of both reads that show the light on
 * this page: `combatHud.scene` (the disc and its pop-over) and `campaigns.timeOfDay` (the map's vision, the drawer's
 * classic pill). Only offered where the server allows it (`scene.canSetLight`: edit access, no campaign time).
 */
export function useSetLight(campaignId: Id<"campaigns">) {
  const mutate = useMutation(api.campaigns.setTimeOfDay).withOptimisticUpdate((store, { campaignId: id, timeOfDay }) => {
    const scene = store.getQuery(api.combatHud.scene, { campaignId: id });
    if (scene !== undefined && scene.canSetLight) store.setQuery(api.combatHud.scene, { campaignId: id }, { ...scene, light: timeOfDay });
    const light = store.getQuery(api.campaigns.timeOfDay, { campaignId: id });
    if (light !== undefined && light.canSet) store.setQuery(api.campaigns.timeOfDay, { campaignId: id }, { ...light, light: timeOfDay });
  });
  const [error, setError] = useState<string | null>(null);
  async function set(timeOfDay: LightLevel): Promise<void> {
    setError(null);
    try {
      await mutate({ campaignId, timeOfDay });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return { set, error };
}

/** Day / Dim / Night in the GM's day-disc pop-over (user answer Q6a; was the GM toolbar's `.gtools .seg`). */
export function LightSeg({ campaignId, light }: { campaignId: Id<"campaigns">; light: LightLevel }) {
  const setter = useSetLight(campaignId);
  return (
    <>
      <span className="hud-seg" role="group" aria-label="Time of day">
        {LIGHT_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={level === light}
            onClick={() => {
              if (level !== light) void setter.set(level);
            }}
          >
            {LIGHT_LEVEL_LABEL[level]}
          </button>
        ))}
      </span>
      {setter.error ? (
        <span role="alert" className="hud-scene-err">
          {setter.error}
        </span>
      ) : null}
    </>
  );
}
