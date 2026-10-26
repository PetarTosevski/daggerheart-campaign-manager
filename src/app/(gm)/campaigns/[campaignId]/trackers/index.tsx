"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import type { CampaignSummary } from "../../../../../../convex/campaigns";

/** Shown while a tracker's chunk loads: an empty tracker card (TrackerCard's panel style). */
function TrackerLoading() {
  return (
    <section className="flex flex-col gap-3.5 rounded-[14px] border border-[#253338] bg-[#141e22] p-5">
      <p role="status" className="m-0 font-display text-[20px] font-bold text-parchment">
        Loading the frame tracker…
      </p>
    </section>
  );
}

// CL8: only one frame applies per campaign, so each tracker is its own chunk.
const FiveBannersTracker = dynamic(() => import("./five-banners").then((m) => m.FiveBannersTracker), { loading: TrackerLoading });
const ColossusTracker = dynamic(() => import("./colossus").then((m) => m.ColossusTracker), { loading: TrackerLoading });
const AgeOfUmbraTracker = dynamic(() => import("./age-of-umbra").then((m) => m.AgeOfUmbraTracker), { loading: TrackerLoading });
const WeredragonTracker = dynamic(() => import("./weredragon").then((m) => m.WeredragonTracker), { loading: TrackerLoading });
const AndaluriaTracker = dynamic(() => import("./andaluria").then((m) => m.AndaluriaTracker), { loading: TrackerLoading });
const HorizonTracker = dynamic(() => import("./horizon").then((m) => m.HorizonTracker), { loading: TrackerLoading });

/** The frame's own trackers (from its book chapter), shown on the dashboard. */
export function FrameTrackers({ campaign }: { campaign: CampaignSummary }): ReactNode {
  switch (campaign.frameId) {
    case "five-banners-burning":
      return <FiveBannersTracker campaign={campaign} />;
    case "colossus-of-the-drylands":
      return <ColossusTracker campaign={campaign} />;
    case "age-of-umbra":
      return <AgeOfUmbraTracker campaign={campaign} />;
    case "reign-of-the-weredragon":
      return <WeredragonTracker campaign={campaign} />;
    case "dark-heart-of-andaluria":
      return <AndaluriaTracker campaign={campaign} />;
    case "journey-to-horizon":
      return <HorizonTracker campaign={campaign} />;
    default:
      return null;
  }
}
