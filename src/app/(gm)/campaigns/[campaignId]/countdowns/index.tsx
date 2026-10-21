"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CountdownView } from "../../../../../../convex/countdowns";

import { CountdownCard } from "./card";
import { ChaseCard, NewChaseDialog } from "./chase";
import { NewCountdownDialog } from "./new-dialog";
import { BTN } from "./shared";

type Item = { kind: "single"; countdown: CountdownView } | { kind: "chase"; party?: CountdownView; rivals?: CountdownView };

/**
 * The list's cards in order: a chase pair (countdowns-advanced D9) becomes ONE item where its first row stands; a row
 * whose partner isn't in the list (a player can't see it) still shows as a chase on its own.
 */
export function listItems(countdowns: readonly CountdownView[]): Item[] {
  const byId = new Map(countdowns.map((c) => [c._id, c]));
  const placed = new Set<Id<"countdowns">>();
  const items: Item[] = [];
  for (const c of countdowns) {
    if (placed.has(c._id)) continue;
    if (c.chase === null) {
      items.push({ kind: "single", countdown: c });
      continue;
    }
    const partner = byId.get(c.chase.partnerId);
    placed.add(c._id);
    if (partner !== undefined) placed.add(partner._id);
    items.push(c.chase.side === "party" ? { kind: "chase", party: c, rivals: partner } : { kind: "chase", party: partner, rivals: c });
  }
  return items;
}

/** Countdowns section of the CampaignHub board. Countdowns are core: every frame has them. */
export function Countdowns({ campaignId, readOnly = false }: { campaignId: Id<"campaigns">; readOnly?: boolean }) {
  const countdowns = useQuery(api.countdowns.listByCampaign, { campaignId });
  const [creating, setCreating] = useState(false);
  const [chasing, setChasing] = useState(false);

  return (
    <section aria-labelledby="cd-h" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cd-h" className="m-0 font-display text-[24px] font-bold text-parchment">
          Countdowns
        </h2>
        {readOnly ? null : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={cn(BTN, "min-h-11 px-4")} onClick={() => setChasing(true)}>
              + New chase
            </button>
            <button type="button" className={cn(BTN, "min-h-11 px-4")} onClick={() => setCreating(true)}>
              + New countdown
            </button>
          </div>
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
          {listItems(countdowns).map((item) =>
            item.kind === "single" ? (
              <CountdownCard key={item.countdown._id} countdown={item.countdown} campaignId={campaignId} readOnly={readOnly} />
            ) : (
              <ChaseCard key={(item.party ?? item.rivals)!._id} party={item.party} rivals={item.rivals} campaignId={campaignId} readOnly={readOnly} />
            ),
          )}
        </div>
      )}
      {readOnly ? null : (
        <>
          <NewCountdownDialog campaignId={campaignId} open={creating} onClose={() => setCreating(false)} />
          <NewChaseDialog campaignId={campaignId} open={chasing} onClose={() => setChasing(false)} />
        </>
      )}
    </section>
  );
}
