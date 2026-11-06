"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { GOOD_FORTUNE_ENTRY, SETBACK_ENTRY, TERRAIN_LABEL, encounterBonus, type Terrain } from "@/lib/domain/frames/horizon";
import { hexKey, type Hex } from "@/lib/world/hex";
import { BEARING_LABEL, ENCOUNTERS, HABITATS, RUMOR_TEXT_MAX, REGION_NAME_MAX, habitatLabel, type Region } from "@/lib/world/hex-crawl";
import { SANCTUARY_TYPE, type HexCrawl, type MapToken } from "@/lib/world/map-state";
import { useIntent } from "@/lib/use-intent";

import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CrawlView } from "../../../../../../convex/trackers/horizon";
import { api } from "../../../../../../convex/_generated/api";
import type { MapActions } from "./map-actions";

type GmView = Extract<CrawlView, { role: "gm" }>;
type PlayerView = Extract<CrawlView, { role: "player" }>;

const SECTION = "flex flex-col gap-2 border-t border-[#253338] pt-2.5";
const H3 = "m-0 font-display text-[14px] font-bold text-[#f3cf86]";

/**
 * GM: Soul Echo sanctuaries, Locate Soul Echoes and wilderness regions
 * (Journey to Horizon, HF pp.169–176; dcm-bxp.17).
 */
export function CrawlRegionsPanel({
  campaignId,
  crawl,
  view,
  tokens,
  selected,
  actions,
}: {
  campaignId: Id<"campaigns">;
  crawl: HexCrawl;
  view: GmView;
  tokens: MapToken[];
  selected: Hex | null;
  actions: MapActions;
}) {
  return (
    <section aria-labelledby="crawl-regions-h" className="flex flex-col gap-2.5 rounded-[14px] border border-[#3a3020] bg-[#141e22] p-4">
      <h2 id="crawl-regions-h" className="m-0 font-display text-[18px] font-bold">
        Regions &amp; Soul Echoes
      </h2>
      <EchoesSection campaignId={campaignId} view={view} tokens={tokens} hasParty={crawl.party !== null} />
      <RegionsSection campaignId={campaignId} crawl={crawl} view={view} selected={selected} actions={actions} />
    </section>
  );
}

function EchoesSection({ campaignId, view, tokens, hasParty }: { campaignId: Id<"campaigns">; view: GmView; tokens: MapToken[]; hasParty: boolean }) {
  const setEcho = useIntent(api.trackers.horizon.setEcho);
  const collect = useIntent(api.trackers.horizon.collectEcho);
  const locate = useIntent(api.trackers.horizon.locateEchoes);
  const seekers = useIntent(api.trackers.horizon.setSeekersAlerted);
  const [alert, setAlert] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sanctuaries = tokens.filter((t) => t.type === SANCTUARY_TYPE);
  const echoOf = (id: number) => view.echoes.find((e) => e.tokenId === id);
  const nameOf = (id: number) => tokens.find((t) => t.id === id)?.name || `Marker ${id}`;
  const error = setEcho.error ?? collect.error ?? locate.error ?? seekers.error;

  return (
    <div className={SECTION}>
      <h3 className={H3}>Soul Echoes</h3>
      <p className="m-0 text-[12px] text-[#9fb2b6]">Choose nine sanctuaries that hold a Soul Echo (HF 169). GM only.</p>
      {sanctuaries.length ? (
        <ul aria-label="Sanctuaries" className="m-0 flex list-none flex-col gap-1 p-0">
          {sanctuaries.map((t) => {
            const echo = echoOf(t.id);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                <label className="chk flex-1">
                  <input
                    type="checkbox"
                    checked={echo !== undefined}
                    disabled={setEcho.pending || echo?.collected === true}
                    onChange={(e) => void setEcho.fire({ campaignId, tokenId: t.id, hasEcho: e.target.checked })}
                  />
                  {t.name || "Sanctuary"}: Soul Echo
                </label>
                {echo?.collected ? <span className="text-[12px] text-[#9fb2b6]">Collected</span> : null}
                {echo && !echo.collected ? (
                  <BrandButton
                    variant="confirm"
                    size="sm"
                    disabled={collect.pending}
                    onClick={async () => {
                      const r = await collect.fire({ campaignId, tokenId: t.id });
                      if (r) setNotice(`Soul Echo ${r.newValue} of 10 collected: the party levels up.${r.horizonUnlocked ? " Horizon is unlocked." : ""}`);
                    }}
                  >
                    Collect the Echo
                  </BrandButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-[#9fb2b6]">Place sanctuary markers on the map first.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <BrandButton
          variant="neutral"
          size="sm"
          disabled={!hasParty || locate.pending || !view.echoes.some((e) => !e.collected)}
          onClick={async () => {
            const r = await locate.fire({ campaignId, seekersAlerted: alert });
            if (r) setNotice(`Locate Soul Echoes: ${BEARING_LABEL[r.bearing]}.`);
          }}
        >
          Locate Soul Echoes
        </BrandButton>
        <label className="chk">
          <input type="checkbox" checked={alert} onChange={(e) => setAlert(e.target.checked)} /> Alerts the Seekers-in-Shadow
        </label>
      </div>
      {view.located ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[#0d1417] px-2.5 py-2 text-[12px] text-[#c8d3d0]" data-testid="echo-bearing">
          <span>
            Day {view.located.day}: {BEARING_LABEL[view.located.bearing]} (toward {nameOf(view.located.tokenId)})
          </span>
          <label className="chk">
            <input
              type="checkbox"
              checked={view.located.seekersAlerted}
              disabled={seekers.pending}
              onChange={(e) => void seekers.fire({ campaignId, alerted: e.target.checked })}
            />{" "}
            Seekers alerted
          </label>
        </div>
      ) : null}
      <p role="status" className="m-0 text-[13px] text-[#f3dfb0] empty:hidden">
        {notice}
      </p>
      <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {error}
      </p>
    </div>
  );
}

function RegionsSection({
  campaignId,
  crawl,
  view,
  selected,
  actions,
}: {
  campaignId: Id<"campaigns">;
  crawl: HexCrawl;
  view: GmView;
  selected: Hex | null;
  actions: MapActions;
}) {
  const generate = useIntent(api.trackers.horizon.generateRegion);
  // Horizon encounter bonuses (optional rule, HF p.171; rule-switches OH): off until the GM turns it on in House rules.
  const bonuses = useQuery(api.ruleSettings.get, { campaignId })?.modes.horizonEncounterBonuses === true;
  const [name, setName] = useState("");
  return (
    <div className={SECTION}>
      <h3 className={H3}>Wilderness regions</h3>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await generate.fire({ campaignId, ...(name.trim() ? { name } : {}) })) setName("");
        }}
      >
        <input aria-label="New region name" placeholder="Name (optional)" maxLength={REGION_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} className="fld fsm min-w-0 flex-1" />
        <BrandButton type="submit" variant="confirm" size="sm" disabled={generate.pending}>
          Generate region
        </BrandButton>
      </form>
      <p className="m-0 text-[12px] text-[#9fb2b6]">Rolls d20 habitat, d12 size, d8+d6 encounter, d4 terrain and d100 rumor (HF 170). Then paint its hexes: select a hex and press Paint.</p>
      <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {generate.error}
      </p>
      {view.regions.length ? (
        <ul aria-label="Regions" className="m-0 flex list-none flex-col gap-1.5 p-0">
          {[...view.regions].reverse().map((r) => (
            <RegionRow key={r.id} campaignId={campaignId} region={r as Region} bonuses={bonuses} painted={crawl.hexes.filter((h) => h.region === r.name).length} selected={selected} actions={actions} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RegionRow({
  campaignId,
  region,
  bonuses,
  painted,
  selected,
  actions,
}: {
  campaignId: Id<"campaigns">;
  region: Region;
  /** The Horizon encounter bonuses switch is on. */
  bonuses: boolean;
  painted: number;
  selected: Hex | null;
  actions: MapActions;
}) {
  const roll = useIntent(api.trackers.horizon.rollRegionEncounter);
  const used = useIntent(api.trackers.horizon.setRegionEncounterUsed);
  const rumor = useIntent(api.trackers.horizon.setRegionRumor);
  const remove = useIntent(api.trackers.horizon.removeRegion);
  const activate = useIntent(api.horizonEncounters.activate);
  const [draft, setDraft] = useState<string | null>(null);
  const habitat = habitatLabel(region);
  const error = roll.error ?? used.error ?? activate.error ?? rumor.error ?? remove.error;

  return (
    <li className="rounded-[10px] border border-[#253338] bg-[#0d1417] px-2.5 py-2 text-[13px] text-[#c8d3d0]">
      <details>
        <summary className="cursor-pointer">
          <span className="font-bold text-[#e6ecea]">{region.name}</span> · {habitat} · {TERRAIN_LABEL[region.terrain as Terrain]} ({region.terrain}) · {painted} of {region.size} hexes
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <span className="text-[12px] text-[#9fb2b6]">
            Habitat d20: {region.habitatRolls.join(", ")} · {region.impassable ? "Overtaken: nigh impossible to traverse." : HABITATS[region.habitat].examples}
          </span>
          <BrandButton
            variant="neutral"
            size="sm"
            disabled={!selected}
            onClick={() => selected && void actions.updateHex(selected.q, selected.r, { region: region.name, habitat, terrain: region.terrain })}
          >
            {selected ? `Paint hex ${selected.q}, ${selected.r} with this region` : "Select a hex to paint it"}
          </BrandButton>
          <span className="font-bold text-[#e6ecea]">Encounters (GM only)</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {region.encounters.map((e, i) => {
              // With the switch on, running entry 4 or 12 applies its optional bonus (HF p.171) in the same click.
              const bonus = encounterBonus(e.total, 0, bonuses);
              const run = (checked: boolean) =>
                bonus && checked ? activate.fire({ campaignId, regionId: region.id, index: i }) : used.fire({ campaignId, regionId: region.id, index: i, used: checked });
              return (
                <li key={`${region.id}-${i}`}>
                  <label className="chk">
                    <input type="checkbox" checked={e.used} disabled={used.pending || activate.pending} onChange={(ev) => void run(ev.target.checked)} />
                    {e.total} ({e.dice.join("+")}): {ENCOUNTERS[e.total]}
                  </label>
                  {bonus && !e.used ? (
                    <span className="block pl-6 text-[12px] text-[#f3cf86]" data-testid={`encounter-bonus-${region.id}-${i}`}>
                      {e.total === SETBACK_ENTRY ? "Running it: GM +1 Fear per PC (house rule on)" : e.total === GOOD_FORTUNE_ENTRY ? "Running it: each PC +1 Hope (house rule on)" : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <BrandButton variant="neutral" size="sm" disabled={roll.pending} onClick={() => void roll.fire({ campaignId, regionId: region.id })}>
            Roll another encounter
          </BrandButton>
          <span className="font-bold text-[#e6ecea]">Rumor: d100 {region.rumor.roll === 100 ? "00" : String(region.rumor.roll).padStart(2, "0")} (HF 172–173)</span>
          <textarea
            aria-label={`Rumor for ${region.name}`}
            className="fld fsm"
            rows={2}
            maxLength={RUMOR_TEXT_MAX}
            value={draft ?? region.rumor.text}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={async () => {
              if (draft !== null && draft !== region.rumor.text && (await rumor.fire({ campaignId, regionId: region.id, text: draft })) !== undefined) setDraft(null);
            }}
          />
          <label className="chk">
            <input type="checkbox" checked={region.rumor.known} disabled={rumor.pending} onChange={(e) => void rumor.fire({ campaignId, regionId: region.id, known: e.target.checked })} />
            The party knows this rumor (players see it)
          </label>
          <BrandButton variant="danger" size="sm" disabled={remove.pending} onClick={() => void remove.fire({ campaignId, regionId: region.id })}>
            Remove region
          </BrandButton>
          <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
            {error}
          </p>
        </div>
      </details>
    </li>
  );
}

/** The unused encounters of the region the hex belongs to, for the travel result (GM). */
export function unusedEncounters(view: GmView | undefined, crawl: HexCrawl, h: Hex): string | null {
  const regionName = crawl.hexes.find((x) => hexKey(x) === hexKey(h))?.region;
  const region = view?.regions.find((r) => r.name === regionName);
  if (!region) return null;
  const open = region.encounters.filter((e) => !e.used).map((e) => `${e.total}: ${ENCOUNTERS[e.total]}`);
  return open.length ? `${region.name}'s unused encounters: ${open.join("; ")}.` : `${region.name} has no unused encounter: roll a new one or shift one from another region.`;
}

/** Players: the last Locate Soul Echoes bearing and the rumors the party knows. */
export function CrawlKnown({ view }: { view: PlayerView }) {
  if (!view.located && view.rumors.length === 0) return null;
  return (
    <section aria-label="What the party knows" className="flex flex-col gap-1 rounded-[12px] border border-[#253338] bg-[#141e22] px-4 py-3 text-[13px] text-[#c8d3d0]">
      {view.located ? (
        <p className="m-0" data-testid="echo-bearing">
          {view.located.bearing === "here"
            ? `The nearest Soul Echo is here, in the party's hex (day ${view.located.day}).`
            : `The Soul Echoes call from the ${BEARING_LABEL[view.located.bearing].toLowerCase()} (day ${view.located.day}).`}
        </p>
      ) : null}
      {view.rumors.map((r) => (
        <p key={r.regionId} className="m-0">
          <span className="font-bold text-[#f4efe6]">{r.name}:</span> {r.text}
        </p>
      ))}
    </section>
  );
}
