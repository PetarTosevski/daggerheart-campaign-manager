"use client";

import { RollFeed } from "@/components/party/dice";
import { RestLauncher } from "@/components/party/rest";
import { SessionButtons } from "@/components/party/session";
import type { CampaignSlotProps } from "@/components/party/slots";

import { useCampaign } from "./campaign-shell";
import { Countdowns } from "./countdowns";
import "./dashboard.css";
import { EndScene } from "./end-scene";
import { FearPanel } from "./fear-panel";
import { FrameRulesPanel } from "./frame-rules-panel";
import { PartySection } from "./party-section";
import { KeyFiguresPanel, LocationsPanel, TomePanel } from "./sidebar-panels";
import { FrameTrackers } from "./trackers";

/** CampaignHub board: the party (D4), countdowns, last session (D10) and GM Fear. */
export default function DashboardPage() {
  const campaign = useCampaign();
  const slot: CampaignSlotProps = { campaignId: campaign._id, isGm: campaign.role === "gm", hopeAndFear: Boolean(campaign.options.hopeAndFear) };

  return (
    <main className="mx-auto grid max-w-[1344px] grid-cols-1 gap-6 px-4 py-7 sm:px-12 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-8">
        <PartySection campaignId={campaign._id} />
        <RollFeed {...slot} />
        <Countdowns campaignId={campaign._id} readOnly={campaign.role !== "gm"} />
        <FrameTrackers campaign={campaign} />
        <section aria-labelledby="last-h" className="flex flex-col gap-3 rounded-2xl border border-[#2a3a40] bg-[#141e22] p-6">
          <h2 id="last-h" className="m-0 font-display text-[24px] font-bold text-parchment">
            Last Session
          </h2>
          <p className="m-0 font-serif text-[18px] leading-relaxed text-[#c9d2cf]">
            No sessions played yet. Write a recap in a session’s Wrap-up stage and it will appear here.
          </p>
        </section>
      </div>
      <aside className="flex flex-col gap-6 self-start">
        <FearPanel campaignId={campaign._id} fear={campaign.fear} readOnly={campaign.role !== "gm"} />
        <SessionButtons {...slot} />
        <EndScene campaignId={campaign._id} isGm={slot.isGm} />
        <RestLauncher {...slot} />
        <TomePanel />
        <KeyFiguresPanel />
        <LocationsPanel />
        <FrameRulesPanel campaign={campaign} />
      </aside>
    </main>
  );
}
