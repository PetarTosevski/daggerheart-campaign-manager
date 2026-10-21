"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

import { CountdownCard } from "./card";
import { NewCountdownDialog } from "./new-dialog";
import { BTN } from "./shared";

/** Countdowns section of the CampaignHub board. Countdowns are core: every frame has them. */
export function Countdowns({ campaignId, readOnly = false }: { campaignId: Id<"campaigns">; readOnly?: boolean }) {
  const countdowns = useQuery(api.countdowns.listByCampaign, { campaignId });
  const [creating, setCreating] = useState(false);

  return (
    <section aria-labelledby="cd-h" className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="cd-h" className="m-0 font-display text-[24px] font-bold text-parchment">
          Countdowns
        </h2>
        {readOnly ? null : (
          <button type="button" className={cn(BTN, "min-h-11 px-4")} onClick={() => setCreating(true)}>
            + New countdown
          </button>
        )}
      </div>
      {countdowns === undefined ? (
        <p className="text-[#9fb2b6]">Loading countdowns…</p>
      ) : countdowns.length === 0 && readOnly ? (
        <p className="m-0 rounded-[14px] border-2 border-dashed border-[#33444a] p-6 text-center text-[15px] text-[#9fb2b6]">
          No countdowns running.
        </p>
      ) : countdowns.length === 0 ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="cursor-pointer rounded-[14px] border-2 border-dashed border-[#33444a] bg-transparent p-6 text-[15px] text-[#9fb2b6]"
        >
          No countdowns running. Start one from 20 down to 1.
        </button>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
          {countdowns.map((c) => (
            <CountdownCard key={c._id} countdown={c} campaignId={campaignId} readOnly={readOnly} />
          ))}
        </div>
      )}
      {readOnly ? null : <NewCountdownDialog campaignId={campaignId} open={creating} onClose={() => setCreating(false)} />}
    </section>
  );
}
