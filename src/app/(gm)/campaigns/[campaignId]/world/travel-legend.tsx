"use client";

import { useId, useState } from "react";

import { METHOD_LABELS, PACE_LABELS, SPEED_TERRAINS, SPEED_TERRAIN_CODE, canCross, maxSwimKm, swimsWater, terrainSpeed, type TravelMethod, type TravelPace, type TravelRules } from "@/lib/domain/travel";
import { TERRAIN_COLOURS, TERRAIN_NAMES } from "@/lib/world/terrain";

/**
 * "Travel speeds": km per day on every terrain type for the travel method in
 * use and the pace, from the campaign's Travel rules (PD1). Shown to the GM
 * and players; collapsible. `onEdit` (GM only) opens the Travel rules.
 */
export function TravelLegend({ rules, method, pace, onEdit }: { rules: TravelRules; method: TravelMethod; pace: TravelPace; onEdit?: () => void }) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  const paceText = pace === "normal" ? PACE_LABELS.normal : `${PACE_LABELS[pace]} ×${pace === "slow" ? rules.slow : rules.fast}`;
  return (
    <section aria-label="Travel speeds" className="w-legend">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <button type="button" className="w-legend-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
          <span aria-hidden="true" className="w-legend-caret">
            {open ? "▾" : "▸"}
          </span>
          Travel speeds
        </button>
        <span data-testid="legend-method" className="text-[12px] text-[#9fb2b6]">
          {METHOD_LABELS[method]} · {paceText} · km/day
        </span>
        {onEdit ? (
          <button type="button" className="mseg ml-auto" aria-haspopup="dialog" onClick={onEdit}>
            Edit speeds…
          </button>
        ) : null}
      </div>
      {open ? (
        <ul id={listId} className="w-legend-list">
          {SPEED_TERRAINS.map((t) => {
            const code = SPEED_TERRAIN_CODE[t];
            return (
              <li key={t}>
                <span className="w-legend-swatch" style={{ background: TERRAIN_COLOURS[code] }} aria-hidden="true" />
                <span>{TERRAIN_NAMES[code]}</span>
                <b>{canCross(rules, method, code) ? `${Math.round(terrainSpeed(rules, method, pace, code))} km/day` : "can’t cross"}</b>
                {code === "." && swimsWater(method) && canCross(rules, method, code) ? (
                  <small className="w-legend-note">Swims up to {Math.round(maxSwimKm(rules, method, pace))} km (one day)</small>
                ) : null}
              </li>
            );
          })}
          <li>
            <span className="w-legend-swatch" style={{ background: TERRAIN_COLOURS["#"] }} aria-hidden="true" />
            <span>{TERRAIN_NAMES["#"]}</span>
            <b>can&rsquo;t cross</b>
          </li>
        </ul>
      ) : null}
      {open ? (
        <p className="m-0 text-[11px] text-[#7f9297]">
          Unpainted ground counts as Wilds. On foot or mounted the party swims Water only where it can reach the far side in one day.
        </p>
      ) : null}
    </section>
  );
}
