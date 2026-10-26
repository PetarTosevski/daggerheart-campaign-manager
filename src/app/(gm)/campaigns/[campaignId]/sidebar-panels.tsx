"use client";

import { useQuery } from "convex/react";
import Link from "next/link";

import { KEY_FIGURES, TOME_CHAPTERS } from "@/lib/frames/tomes";

import { api } from "../../../../../convex/_generated/api";

import { useCampaign, useOpenTome } from "./campaign-shell";

/** "Campaign Tome" panel: one button per chapter (Hub* boards). */
export function TomePanel() {
  const openTome = useOpenTome();
  return (
    <section aria-labelledby="tome-h" className="flex flex-col gap-2.5 rounded-[14px] bg-[#efe3c8] p-5 text-[#2a1f14]">
      <h2 id="tome-h" className="m-0 font-display text-[22px] font-bold">
        Campaign Tome
      </h2>
      {TOME_CHAPTERS.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => openTome(c.id)}
          className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-[#cdb88f] bg-[#e3d2ad] px-3 text-left font-serif text-[19px] hover:brightness-105"
        >
          <span className="w-7 font-display text-[#8e2b2b]">{c.numeral}</span>
          {c.title}
        </button>
      ))}
    </section>
  );
}

/** "Key Figures" panel: the frame's main NPCs. A custom campaign keeps them in its tome. */
export function KeyFiguresPanel() {
  const campaign = useCampaign();
  const openTome = useOpenTome();
  const figures = campaign.frameId === "custom" ? [] : KEY_FIGURES[campaign.frameId];
  return (
    <section aria-labelledby="npc-h" className="flex flex-col gap-2.5 rounded-[14px] border border-[#253338] bg-[#141e22] p-5">
      <h2 id="npc-h" className="m-0 font-display text-[22px] font-bold text-parchment">
        Key Figures
      </h2>
      {figures.length ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {figures.map((f, i) => (
            <li
              key={f.name}
              className={`flex flex-col gap-0.5 py-2.5 ${i < figures.length - 1 ? "border-b border-[#22303a]" : ""}`}
            >
              <span className="font-semibold text-[#e6ecea]">{f.name}</span>
              <span className="text-[13px] text-[#9fb2b6]">{f.role}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[14px] text-[#9fb2b6]">
          Your campaign’s key figures live in your{" "}
          <button type="button" className="cursor-pointer text-brand underline underline-offset-4" onClick={() => openTome("incident")}>
            Inciting Incident
          </button>
          .
        </p>
      )}
    </section>
  );
}

/** "Locations" panel: World map markers ticked "Location" (players never receive hidden ones). */
export function LocationsPanel() {
  const campaign = useCampaign();
  const locations = useQuery(api.maps.locations, { campaignId: campaign._id });
  const world = `/campaigns/${campaign._id}/world`;
  return (
    <section aria-labelledby="loc-h" className="flex flex-col gap-2.5 rounded-[14px] border border-[#253338] bg-[#141e22] p-5">
      <h2 id="loc-h" className="m-0 font-display text-[22px] font-bold text-parchment">
        Locations
      </h2>
      {locations && locations.length === 0 ? (
        <Link href={world} className="block rounded-[10px] border border-dashed border-[#33444a] p-3 text-[13px] leading-[1.45] text-[#9fb2b6] no-underline">
          No locations yet. On the World map, select a marker and tick “Location” to pin it here.
        </Link>
      ) : null}
      <div className="flex flex-col gap-1.5">
        {(locations ?? []).map((l) => (
          <Link
            key={l.id}
            href={`${world}?focus=${l.id}`}
            title="Open on the map"
            className="flex min-h-11 items-center gap-2.5 rounded-[10px] border px-2.5 py-1.5 text-[14px] text-[#eef3ea] no-underline"
            style={{ borderColor: l.partyHere ? "#e3b45a" : "#33444a", background: l.partyHere ? "#2a2416" : "#141e22" }}
          >
            <span
              className="flex size-[26px] flex-none items-center justify-center rounded-full border-2 border-[rgba(255,243,214,0.8)]"
              style={{ background: l.colour }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={l.path} />
              </svg>
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{l.name}</span>
              <span className="text-[11px] text-[#9fb2b6]">
                {l.typeLabel}
                {l.partyHere ? " · party is here" : ""}
                {l.hidden ? " · hidden from players" : ""}
              </span>
            </span>
            <span aria-hidden="true" className="text-brand">
              ›
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
