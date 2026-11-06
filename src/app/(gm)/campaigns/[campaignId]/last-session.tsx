"use client";

import { useQuery } from "convex/react";
import Link from "next/link";

import { brandButton } from "@/components/brand/buttons";
import { SlotBoundary } from "@/components/party/session/boundary";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * The dashboard's Last Session card (D10 S7, B9; board CampaignHub.dc.html l.236-243): the last played session's recap,
 * else the board's two fallbacks (from `sessionWrap.dashboard`), and 'Open the Journal' (JX1). Every member.
 */
function Card({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const summary = useQuery(api.sessionWrap.dashboard, { campaignId });
  return summary === undefined ? (
    <p role="status" className="m-0 text-[15px] text-[#9fb2b6]">
      Loading the last session…
    </p>
  ) : (
    <p className="m-0 font-serif text-[19px] leading-relaxed whitespace-pre-line text-[#d3dcd9]" data-testid="last-session-text">
      {summary.lastSessionText}
    </p>
  );
}

export function LastSession({ campaignId }: { campaignId: Id<"campaigns"> }) {
  return (
    <section aria-labelledby="last-h" className="flex flex-col gap-2.5 rounded-[14px] border border-[#253338] bg-[#141e22] px-[22px] py-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="last-h" className="m-0 font-display text-[22px] font-bold text-parchment">
          Last Session
        </h2>
        <Link href={`/campaigns/${campaignId}/journal`} className={brandButton({ variant: "neutral", className: "no-underline" })}>
          Open the Journal
        </Link>
      </div>
      <SlotBoundary fallback={<p className="m-0 text-[15px] text-[#c9d2cf]">The last session is unavailable. Reload the page.</p>}>
        <Card campaignId={campaignId} />
      </SlotBoundary>
    </section>
  );
}
