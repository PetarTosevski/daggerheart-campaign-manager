"use client";

import { useState } from "react";

import { Modal } from "@/components/brand/modal";
import { DEFAULT_TRAVEL_RULES, METHOD_LABELS, SPEED_TERRAINS, TRAVEL_METHODS, type SpeedTerrain, type TravelRules } from "@/lib/domain/travel";

import type { MapActions } from "./map-actions";

const TERRAIN_LABEL: Record<SpeedTerrain, string> = { road: "Road", wilds: "Wilds", deep: "Deep wilds", marsh: "Marsh", mountains: "Mountains", water: "Water" };

type Row = { key: string; label: string; get: (r: TravelRules) => Record<SpeedTerrain, number>; set: (r: TravelRules, t: Record<SpeedTerrain, number>) => TravelRules };

const ROWS: Row[] = [
  ...TRAVEL_METHODS.map((m) => ({
    key: m,
    label: `Measure · ${METHOD_LABELS[m]}`,
    get: (r: TravelRules) => r.speeds[m],
    set: (r: TravelRules, t: Record<SpeedTerrain, number>) => ({ ...r, speeds: { ...r.speeds, [m]: t } }),
  })),
  ...(["foot", "mount"] as const).map((m) => ({
    key: `trail-${m}`,
    label: `Trail · ${m === "foot" ? "On foot" : "Mounted"}`,
    get: (r: TravelRules) => r.trail[m],
    set: (r: TravelRules, t: Record<SpeedTerrain, number>) => ({ ...r, trail: { ...r.trail, [m]: t } }),
  })),
];

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
      <p className="m-0 text-[14px] text-[#c9d2cf]">Kilometres per day by terrain. Measure uses the travel method; the party trail and token distances use the header pace.</p>
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
                      min={1}
                      max={1000}
                      required
                      aria-label={`${row.label}, ${TERRAIN_LABEL[t]}, km per day`}
                      value={row.get(draft)[t]}
                      onChange={(e) => setDraft(row.set(draft, { ...row.get(draft), [t]: num(e.target.value) }))}
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
