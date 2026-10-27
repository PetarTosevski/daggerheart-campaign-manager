"use client";

import { useState } from "react";

import { Modal } from "@/components/brand/modal";
import { DEFAULT_TRAVEL_RULES, METHOD_LABELS, SPEED_TERRAINS, SPEED_TERRAIN_CODE, TRAVEL_METHODS, tableSpeed, type SpeedTable, type SpeedTerrain, type TravelMethod, type TravelRules } from "@/lib/domain/travel";
import { TERRAIN_NAMES } from "@/lib/world/terrain";

import type { MapActions } from "./map-actions";

/** The painted terrain's names, as on the brushes and the Travel speeds legend. */
const TERRAIN_LABEL = Object.fromEntries(SPEED_TERRAINS.map((t) => [t, TERRAIN_NAMES[SPEED_TERRAIN_CODE[t]]])) as Record<SpeedTerrain, string>;

type Row = { key: string; method: TravelMethod; label: string; get: (r: TravelRules) => SpeedTable; set: (r: TravelRules, t: SpeedTable) => TravelRules };

const ROWS: Row[] = TRAVEL_METHODS.map((m) => ({
  key: m,
  method: m,
  label: METHOD_LABELS[m],
  get: (r: TravelRules) => r.speeds[m],
  set: (r: TravelRules, t: SpeedTable) => ({ ...r, speeds: { ...r.speeds, [m]: t } }),
}));

/** The campaign's travel speeds (house rule), km per day, editable by the GM. */
export function TravelRulesDialog({ open, onClose, rules, actions }: { open: boolean; onClose: () => void; rules: TravelRules; actions: MapActions }) {
  return (
    <Modal open={open} onClose={onClose} title="Travel speeds" className="max-w-[860px]">
      {open ? <RulesForm rules={rules} actions={actions} onClose={onClose} /> : null}
    </Modal>
  );
}

function RulesForm({ rules, actions, onClose }: { rules: TravelRules; actions: MapActions; onClose: () => void }) {
  const [draft, setDraft] = useState<TravelRules>(rules);
  const num = (v: string) => Number(v);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await actions.setTravelRules(draft);
        if (ok !== undefined) onClose();
      }}
    >
      <p className="m-0 text-[14px] text-[#c9d2cf]">
        Kilometres per day by travel method and terrain. This one table drives Measure, the party trail and token distances; unpainted ground counts as Wilds, and
        Impassable can&rsquo;t be crossed. A speed of 0 means that method can&rsquo;t cross the terrain: by default open Water is
        crossed only by boat or flying.
</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="p-1 text-left font-normal text-[#9fb2b6]">Speeds</th>
              {SPEED_TERRAINS.map((t) => (
                <th key={t} className="p-1 text-left font-normal text-[#9fb2b6]">
                  {TERRAIN_LABEL[t]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="p-1 text-left font-normal whitespace-nowrap">
                  {row.label}
                </th>
                {SPEED_TERRAINS.map((t) => (
                  <td key={t} className="p-1">
                    <input
                      className="fld fsm w-[72px]"
                      type="number"
                      min={0}
                      max={1000}
                      required
                      aria-label={`${row.label}, ${TERRAIN_LABEL[t]}, km per day`}
                      value={tableSpeed(row.get(draft), t, row.method)}
                      onChange={(e) => setDraft(row.set(draft, { ...row.get(draft), hills: tableSpeed(row.get(draft), "hills", row.method), plains: tableSpeed(row.get(draft), "plains", row.method), [t]: num(e.target.value) }))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-[13px]">
          Cautious pace ×
          <input className="fld fsm w-20" type="number" step={0.01} min={0.1} max={5} required value={draft.slow} onChange={(e) => setDraft({ ...draft, slow: num(e.target.value) })} />
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          Forced march ×
          <input className="fld fsm w-20" type="number" step={0.01} min={0.1} max={5} required value={draft.fast} onChange={(e) => setDraft({ ...draft, fast: num(e.target.value) })} />
        </label>
      </div>
      {actions.error ? (
        <p role="alert" className="m-0 text-[13px] text-[#ff9a92]">
          {actions.error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="mseg" onClick={() => setDraft(DEFAULT_TRAVEL_RULES)}>
          Restore the board&rsquo;s speeds
        </button>
        <button type="submit" className="zbtn zw zgold">
          Save speeds
        </button>
      </div>
    </form>
  );
}
