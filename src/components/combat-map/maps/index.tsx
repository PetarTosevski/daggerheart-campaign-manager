"use client";

import type {
  CombatMapSummary,
  CurrentMapArgs,
  MapBoardProps,
  MapHeaderLineProps,
  MapsPanelProps,
} from "../slots";

/**
 * Maps slot (C3 fills it): the campaign's maps, the map on screen and the map area. C0 ships these stubs so the
 * page has its layout before any map exists; C3 keeps the export names and props (src/components/combat-map/slots.ts)
 * and puts the pan/zoom view under `src/components/combat-map/map-view/**`.
 */

/**
 * The map on screen (`CombatPageState.map`): `undefined` while loading, null when there is none. GM: the picked
 * map, else the live one, else the newest. Player: the live map (C3's campaignQuery `live`, Q1).
 * Stub: no maps exist yet.
 */
export function useCurrentMap(args: CurrentMapArgs): CombatMapSummary | null | undefined {
  void args;
  return null;
}

/** GM, left column: the maps list (R2). Stub: the empty list. */
export function MapsPanel(props: MapsPanelProps) {
  void props;
  return (
    <section className="cm-card" aria-labelledby="cm-maps-h">
      <div className="cm-row cm-between">
        <h2 id="cm-maps-h" className="cm-h">
          Maps
        </h2>
      </div>
      <p className="cm-muted cm-m0">No maps yet. Describe a scene below to draw your first one.</p>
    </section>
  );
}

/** Header line under the title (board copy). GM: the map's name and size; players never see the size (Q1). */
export function MapHeaderLine({ role, map }: MapHeaderLineProps) {
  if (role === "player") return <>{map ? map.name : "The GM hasn’t put a map live yet."}</>;
  if (!map) return <>Describe a scene to draw a battle map, then place the party and the encounter.</>;
  return (
    <>
      {map.name} · {map.w} × {map.h} squares
    </>
  );
}

/** Main area: toolbar and viewport (C3). Stub: the board's empty state. */
export function MapBoard({ role, map }: MapBoardProps) {
  const player = role === "player";
  return (
    <section className="cm-board" aria-label="Battle map">
      <div className="cm-toolbar">
        <strong className="cm-map-title">{map ? map.name : "Battle map"}</strong>
        {map?.live && !player ? <span className="cm-live">LIVE</span> : null}
      </div>
      <div className="cm-vp" data-testid="combat-viewport">
        <div className="cm-empty">
          <div className="cm-empty-inner">
            <div className="cm-empty-title">{player ? "No battle yet" : "No battlefield yet"}</div>
            <div className="cm-muted">
              {player
                ? "Waiting for the GM to put a map live."
                : "Describe the scene and press Generate, or bring your own map image. Then add the party and the adversaries and drag them into position."}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
