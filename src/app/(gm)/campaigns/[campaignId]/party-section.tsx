"use client";

import { useQuery } from "convex/react";
import Link from "next/link";

import { PartyCard } from "@/components/party/party-card";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

import { useCampaign } from "./campaign-shell";

/** The dashboard's party: a card per character with live HP/Stress/Hope tiles. */
export function PartySection({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const characters = useQuery(api.characters.listByCampaign, { campaignId });
  const campaign = useCampaign();
  const base = `/campaigns/${campaignId}/party`;

  return (
    <section aria-labelledby="party-h" className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="party-h" className="m-0 font-display text-[24px] font-bold text-parchment">
          The Party
        </h2>
        <Link
          href={`${base}/new`}
          className="inline-flex min-h-11 items-center rounded-[10px] border border-[#33444a] px-4 text-[14px] text-[#e6ecea] hover:bg-white/5"
        >
          + Create character
        </Link>
      </div>
      {characters === undefined ? (
        <p className="m-0 text-[15px] text-[#9fb2b6]">Loading the party…</p>
      ) : characters.length === 0 ? (
        <div className="rounded-[14px] border-2 border-dashed border-[#33444a] px-6 py-6 text-center text-[15px] text-[#c9d2cf]">
          No characters yet.{" "}
          <Link href={base} className="text-brand underline underline-offset-4">
            Open the Party tab
          </Link>{" "}
          to create the first hero.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
          {characters.map((c) => (
            <PartyCard key={c._id} campaignId={campaignId} character={c} isGm={campaign.role === "gm"} hopeAndFear={Boolean(campaign.options?.hopeAndFear)} />
          ))}
        </div>
      )}
    </section>
  );
}
