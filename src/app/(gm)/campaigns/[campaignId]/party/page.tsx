"use client";

import { useQuery } from "convex/react";
import Link from "next/link";

import { brandButton } from "@/components/brand/buttons";
import { ImportButton } from "@/components/party/import";
import { PartyLevelUpButton } from "@/components/party/level-up";
import type { CampaignSlotProps } from "@/components/party/slots";
import { frameName } from "@/lib/campaign-display";

import { api } from "../../../../../../convex/_generated/api";
import { useCampaign } from "../campaign-shell";

import { CreateCard, RosterCard } from "./roster";

/** Party board, roster view: every hero in the campaign. */
export default function PartyPage() {
  const campaign = useCampaign();
  const characters = useQuery(api.characters.listByCampaign, { campaignId: campaign._id });
  const table = useQuery(api.members.roster, { campaignId: campaign._id });
  const newHref = `/campaigns/${campaign._id}/party/new`;
  const isGm = campaign.role === "gm";
  const hopeAndFear = Boolean(campaign.options.hopeAndFear);
  const slot: CampaignSlotProps = { campaignId: campaign._id, isGm, hopeAndFear };

  return (
    <main className="mx-auto flex max-w-[1344px] flex-col gap-[18px] px-4 pt-7 pb-14 sm:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] tracking-[0.3em] text-[#c9d2cf] uppercase">{frameName(campaign.frameId)} · Party</span>
          <h1 className="m-0 font-display text-[40px] leading-tight font-bold text-parchment">The Party</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PartyLevelUpButton {...slot} />
          <ImportButton {...slot} />
          <Link href={newHref} className={brandButton({ variant: "primary", size: "xl" })}>
            + Create character
          </Link>
        </div>
      </div>
      {characters === undefined ? (
        <p className="m-0 text-[16px] text-[#9fb2b6]">Loading the party…</p>
      ) : (
        <>
          {characters.length === 0 ? <p className="m-0 text-[16px] text-[#9fb2b6]">No characters yet. Create the first hero of this party.</p> : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {characters.map((c) => (
              <RosterCard key={c._id} campaignId={campaign._id} character={c} table={table} isGm={isGm} hopeAndFear={hopeAndFear} />
            ))}
            <CreateCard href={newHref} />
          </div>
        </>
      )}
    </main>
  );
}
