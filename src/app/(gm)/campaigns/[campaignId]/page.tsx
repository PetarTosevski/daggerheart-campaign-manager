"use client";

import { RollFeed } from "@/components/party/dice";
import { RestLauncher } from "@/components/party/rest";
import type { CampaignSlotProps } from "@/components/party/slots";

import { useCampaign } from "./campaign-shell";
import { Countdowns } from "./countdowns";
import "./dashboard.css";
import { EndScene } from "./end-scene";
import { FearPanel } from "./fear-panel";
import { FrameRulesPanel } from "./frame-rules-panel";
import { LastSession } from "./last-session";
import { PartySection } from "./party-section";
import { KeyFiguresPanel, LocationsPanel, TomePanel } from "./sidebar-panels";
import { FrameTrackers } from "./trackers";
import { WitherPanel } from "./wither-panel";

/** CampaignHub board: the party (D4), countdowns, last session and the Wither panel (D10) and GM Fear. Start and End live on the Sessions tab (D10 S3). */
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
        <LastSession campaignId={campaign._id} />
      </div>
      <aside className="flex flex-col gap-6 self-start">
        <FearPanel campaignId={campaign._id} readOnly={campaign.role !== "gm"} />
        <WitherPanel campaign={campaign} />
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
