"use client";

import "./style-switch.css";

import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { pickSetting } from "@/lib/sprite-packs/pick-setting";

import { api } from "../../../../convex/_generated/api";
import type { StyleSwitchProps } from "../slots";

type MapStyle = "classic" | "sprites";

/**
 * The optimistic copy of `combatMapStyle.setStyle` (sprite packs P6): the map's style in every cached layout, list
 * row and sprite-sources read, so the canvas and the thumbnail change at once. A first switch to Sprites also gets
 * the keyword-picked setting the server stores (D7: the same `pickSetting(prompt, name)`).
 */
function patchStyle(store: OptimisticLocalStore, mapId: string, style: MapStyle) {
  let setting: { builtin: string } | undefined;
  for (const { args, value } of store.getAllQueries(api.combatMaps.get)) {
    if (!value || value._id !== mapId) continue;
    setting = value.setting && "builtin" in value.setting ? value.setting : setting;
    const keyword = style === "sprites" && value.setting === undefined ? { setting: { builtin: pickSetting(value.prompt ?? "", value.name) }, settingPicked: false } : {};
    if (keyword.setting) setting = keyword.setting;
    store.setQuery(api.combatMaps.get, args, { ...value, style, ...keyword });
  }
  for (const { args, value } of store.getAllQueries(api.combatMaps.list)) {
    if (!value || !value.some((m) => m._id === mapId)) continue;
    store.setQuery(
      api.combatMaps.list,
      args,
      value.map((m) => (m._id === mapId ? { ...m, style, ...(m.setting === undefined && setting ? { setting } : {}) } : m)),
    );
  }
  for (const { args, value } of store.getAllQueries(api.combatMapStyle.spriteSources)) {
    if (value && value.mapId === mapId) store.setQuery(api.combatMapStyle.spriteSources, args, { ...value, style });
  }
}

/**
 * Combat Map header, GM only: the map on screen drawn Classic or with Sprites (P3: "switching is one click and
 * Classic stays fully working"). One intent per click (map id + style, D1), shown at once by the optimistic update;
 * players get no switch and see the live map in its style. Uploaded image maps have no style, so no switch.
 */
export function StyleSwitch({ campaignId, map }: StyleSwitchProps) {
  const layout = useQuery(api.combatMaps.get, { campaignId, mapId: map._id });
  const setStyle = useMutation(api.combatMapStyle.setStyle).withOptimisticUpdate((store, args) => patchStyle(store, args.mapId, args.style));
  const [error, setError] = useState<string | null>(null);

  if (map.source === "image" || layout === null) return null;
  if (layout === undefined) {
    return (
      <p role="status" className="cm-muted cm-style-loading">
        Loading …
      </p>
    );
  }
  const style: MapStyle = layout.style ?? "classic";

  function choose(next: MapStyle) {
    if (next === style) return;
    setError(null);
    setStyle({ campaignId, mapId: map._id, style: next }).catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <div className="cm-style">
      <div className="cm-seg cm-style-seg" role="group" aria-label="Map style">
        <button type="button" aria-pressed={style === "classic"} onClick={() => choose("classic")} title="Draw this map with the painted Classic look">
          Classic
        </button>
        <button type="button" aria-pressed={style === "sprites"} onClick={() => choose("sprites")} title="Draw this map with sprite packs">
          Sprites
        </button>
      </div>
      {error ? (
        <p role="alert" className="cm-alert cm-m0 cm-style-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
