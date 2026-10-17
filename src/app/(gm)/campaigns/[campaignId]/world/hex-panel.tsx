"use client";

import { useState } from "react";

import { TERRAIN_LABEL, type Terrain, type TravelMode } from "@/lib/domain/frames/horizon";
import { hexDistance, isAdjacent, type Hex, type HexGrid } from "@/lib/world/hex";
import { HORIZON_TRAVEL_MODES, type CrawlHex, type HexCrawl } from "@/lib/world/map-state";

import type { MapActions } from "./map-actions";

const MODE_LABEL: Record<TravelMode, string> = { land: "Over land", riverDown: "River, downstream", riverUp: "River, upstream", ocean: "Ocean (d4 weather)" };

function hexName(h: Hex) {
  return `Hex ${h.q}, ${h.r}`;
}

function describe(h: CrawlHex | undefined) {
  if (!h) return "Unexplored";
  return [h.terrain ? TERRAIN_LABEL[h.terrain as Terrain] : null, h.habitat, h.region].filter(Boolean).join(" · ") || (h.explored ? "Explored" : "Unexplored");
}

function NumberField({ label, value, onSave, step = 1, min, max }: { label: string; value: number; onSave: (v: number) => void; step?: number; min?: number; max?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v) && v !== value) onSave(v);
  };
  return (
    <label className="flex flex-col gap-1 text-[12px] text-[#9fb2b6]">
      {label}
      <input
        className="fld fsm"
        type="number"
        step={step}
        min={min}
        max={max}
        value={draft ?? String(Math.round(value * 10) / 10)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </label>
  );
}

function TextField({ label, value, onSave, maxLength }: { label: string; value: string; onSave: (v: string) => void; maxLength: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onSave(draft);
    setDraft(null);
  };
  return (
    <label className="flex flex-col gap-1 text-[12px] text-[#9fb2b6]">
      {label}
      <input className="fld fsm" type="text" maxLength={maxLength} value={draft ?? value} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </label>
  );
}

/** GM's Hex Crawl panel (Journey to Horizon): calibration, the selected hex, travel and the day counter. */
export function HexCrawlPanel({
  crawl,
  selected,
  actions,
  showGrid,
  onShowGrid,
  settingOrigin,
  onSettingOrigin,
}: {
  crawl: HexCrawl;
  selected: Hex | null;
  actions: MapActions;
  showGrid: boolean;
  onShowGrid: (on: boolean) => void;
  settingOrigin: boolean;
  onSettingOrigin: (on: boolean) => void;
}) {
  const [mode, setMode] = useState<TravelMode>(crawl.travelMode);
  const [die, setDie] = useState<4 | 6 | 8>(6);
  const [terrainPick, setTerrainPick] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const grid = crawl.grid;
  const setGrid = (patch: Partial<HexGrid>) => actions.setHexGrid({ ...grid, ...patch });
  const hex = selected ? crawl.hexes.find((h) => h.q === selected.q && h.r === selected.r) : undefined;
  const adjacent = !!(selected && crawl.party && isAdjacent(crawl.party, selected));
  const terrain = terrainPick ?? hex?.terrain ?? null;
  const last = crawl.lastMove;

  async function travel() {
    if (!selected || !terrain) return;
    const r = await actions.moveToHex({ q: selected.q, r: selected.r, terrain, travelMode: mode, encounterDie: die });
    if (!r) return;
    setTerrainPick(null);
    setResult(
      `${r.days} ${r.days === 1 ? "day" : "days"}${r.weatherRoll ? ` (weather ${r.weatherRoll})` : ""} · now Day ${r.day}. Encounter dice ${r.dice.join(", ")}: ${
        r.encounter ? "an encounter!" : "no encounter (you may spend a Fear to activate one)."
      }`,
    );
  }

  return (
    <section aria-labelledby="crawl-h" className="flex flex-col gap-2.5 rounded-[14px] border border-[#3a3020] bg-[#141e22] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="crawl-h" className="m-0 font-display text-[18px] font-bold">
          Hex Crawl
        </h2>
        <span className="text-[12px] text-[#9fb2b6]">1 hex ≈ 24 miles</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Day" value={crawl.day} min={1} onSave={(d) => actions.setCrawlDay(Math.max(1, Math.round(d)))} />
        <div className="flex flex-col gap-1 text-[12px] text-[#9fb2b6]">
          Party hex
          <span className="flex min-h-[34px] items-center text-[13px] text-[#e6ecea]">{crawl.party ? `${crawl.party.q}, ${crawl.party.r}` : "Not placed"}</span>
        </div>
      </div>
      {last ? (
        <p className="m-0 rounded-lg bg-[#0d1417] px-2.5 py-2 text-[12px] text-[#c8d3d0]">
          Last move: {last.days} {last.days === 1 ? "day" : "days"}, dice {last.dice.join(", ")} · {last.encounter ? "encounter" : "no encounter"} <span className="text-[#7f9297]">(GM only)</span>
        </p>
      ) : null}
      <details className="rounded-[10px] border border-dashed border-[#33444a] p-2.5" onToggle={(e) => {
          if (e.currentTarget.open) onShowGrid(true);
        }}>
        <summary className="cursor-pointer text-[13px] text-[#f3cf86]">Calibrate the grid</summary>
        <div className="mt-2 flex flex-col gap-2">
          <label className="chk">
            <input type="checkbox" checked={showGrid} onChange={(e) => onShowGrid(e.target.checked)} /> Show the whole grid
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Origin x (px)" value={grid.originX} onSave={(originX) => setGrid({ originX })} />
            <NumberField label="Origin y (px)" value={grid.originY} onSave={(originY) => setGrid({ originY })} />
            <NumberField label="Hex size (px)" value={grid.size} step={0.5} min={10} max={400} onSave={(size) => setGrid({ size: Math.max(10, Math.min(400, size)) })} />
            <label className="flex flex-col gap-1 text-[12px] text-[#9fb2b6]">
              Orientation
              <select className="fld fsm" value={grid.orientation} onChange={(e) => setGrid({ orientation: e.target.value as HexGrid["orientation"] })}>
                <option value="flat">Flat top</option>
                <option value="pointy">Pointy top</option>
              </select>
            </label>
          </div>
          <button type="button" className="mseg" aria-pressed={settingOrigin} onClick={() => onSettingOrigin(!settingOrigin)}>
            {settingOrigin ? "Click a hex centre on the map…" : "Set origin by clicking the map"}
          </button>
        </div>
      </details>
      {selected ? (
        <div className="flex flex-col gap-2 border-t border-[#253338] pt-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-[14px] font-bold text-[#f3cf86]">{hexName(selected)}</span>
            <span className="text-[12px] text-[#9fb2b6]">{crawl.party ? `${hexDistance(crawl.party, selected)} from the party` : describe(hex)}</span>
          </div>
          <label className="flex flex-col gap-1 text-[12px] text-[#9fb2b6]">
            Terrain
            <select
              className="fld fsm"
              value={hex?.terrain ?? ""}
              onChange={(e) => actions.updateHex(selected.q, selected.r, { terrain: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Not set</option>
              {([1, 2, 3, 4] as Terrain[]).map((t) => (
                <option key={t} value={t}>
                  {t} · {TERRAIN_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <TextField key={`h${selected.q},${selected.r}`} label="Habitat" maxLength={60} value={hex?.habitat ?? ""} onSave={(habitat) => actions.updateHex(selected.q, selected.r, { habitat })} />
          <TextField key={`g${selected.q},${selected.r}`} label="Region" maxLength={60} value={hex?.region ?? ""} onSave={(region) => actions.updateHex(selected.q, selected.r, { region })} />
          <TextField
            key={`p${selected.q},${selected.r}`}
            label="Point of interest"
            maxLength={200}
            value={hex?.poi?.text ?? ""}
            onSave={(text) => actions.updateHex(selected.q, selected.r, { poi: { text, hidden: hex?.poi?.hidden ?? true } })}
          />
          {hex?.poi ? (
            <label className="chk">
              <input type="checkbox" checked={hex.poi.hidden} onChange={() => actions.updateHex(selected.q, selected.r, { poi: { text: hex.poi!.text, hidden: !hex.poi!.hidden } })} /> Point of
              interest hidden from players
            </label>
          ) : null}
          <label className="chk">
            <input type="checkbox" checked={hex?.explored ?? false} onChange={() => actions.updateHex(selected.q, selected.r, { explored: !(hex?.explored ?? false) })} /> Explored
          </label>
          {adjacent ? (
            <div className="flex flex-col gap-2 rounded-[10px] border border-[#5a4a2a] bg-[#2a2416] p-2.5">
              <span className="font-display text-[13px] font-bold text-[#f3dfb0]">Travel here</span>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[12px] text-[#c8b48a]">
                  Terrain rating
                  <select className="fld fsm" value={terrain ?? ""} onChange={(e) => setTerrainPick(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Choose…</option>
                    {([1, 2, 3, 4] as Terrain[]).map((t) => (
                      <option key={t} value={t}>
                        {t} · {TERRAIN_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-[#c8b48a]">
                  Encounter dice
                  <select className="fld fsm" value={die} onChange={(e) => setDie(Number(e.target.value) as 4 | 6 | 8)}>
                    <option value={4}>d4 (dangerous)</option>
                    <option value={6}>d6</option>
                    <option value={8}>d8 (safer)</option>
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-1 text-[12px] text-[#c8b48a]">
                Travel
                <select className="fld fsm" value={mode} onChange={(e) => setMode(e.target.value as TravelMode)}>
                  {HORIZON_TRAVEL_MODES.map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="zbtn zw zgold" disabled={!terrain} onClick={travel}>
                Move the party here
              </button>
            </div>
          ) : null}
          <button type="button" className="mseg" onClick={() => actions.placePartyHex(selected.q, selected.r)}>
            Place the party here (no travel)
          </button>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-[#9fb2b6]">Click a hex on the map to edit it or move the party there.</p>
      )}
      <p role="status" className="m-0 text-[13px] text-[#f3dfb0]">
        {result}
      </p>
    </section>
  );
}

/** Players' view of the crawl: the day and what they know of the hexes around them. */
export function CrawlInfo({ crawl }: { crawl: HexCrawl }) {
  const here = crawl.party ? crawl.hexes.find((h) => h.q === crawl.party!.q && h.r === crawl.party!.r) : undefined;
  const pois = crawl.hexes.filter((h) => h.poi);
  return (
    <section aria-labelledby="crawl-info-h" className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-[12px] border border-[#253338] bg-[#141e22] px-4 py-3 text-[13px] text-[#c8d3d0]">
      <h2 id="crawl-info-h" className="m-0 font-display text-[16px] font-bold text-[#f4efe6]">
        Hex Crawl · Day {crawl.day}
      </h2>
      <span>{crawl.party ? `The party's hex: ${describe(here)}` : "The party hasn't set out yet."}</span>
      {pois.map((h) => (
        <span key={`${h.q},${h.r}`} className="mchip">
          <i style={{ background: "#f3cf86" }} />
          {h.poi!.text}
        </span>
      ))}
    </section>
  );
}
