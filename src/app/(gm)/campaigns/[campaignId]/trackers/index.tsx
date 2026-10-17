"use client";

import type { ReactNode } from "react";

import type { CampaignSummary } from "../../../../../../convex/campaigns";
import { AgeOfUmbraTracker } from "./age-of-umbra";
import { AndaluriaTracker } from "./andaluria";
import { ColossusTracker } from "./colossus";
import { FiveBannersTracker } from "./five-banners";
import { HorizonTracker } from "./horizon";
import { WeredragonTracker } from "./weredragon";

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
