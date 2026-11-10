import type { ReactElement } from "react";

import type { LoadedCampaign } from "../../../src/shell/campaign-provider";
import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { campaignSummary } from "../../harness/records";

export const campaignId = "campaign-1";

export function publishedCampaign(role: "gm" | "player"): LoadedCampaign {
  return campaignSummary({
    _id: campaignId,
    name: "The Table",
    frameId: "witherwild",
    role,
    tier: 1,
    level: 1,
    custom: null,
    tome: null,
    options: { hopeAndFear: true },
  }) as unknown as LoadedCampaign;
}

export function customCampaign(role: "gm" | "player"): LoadedCampaign {
  return campaignSummary({
    _id: campaignId,
    name: "My Custom Tale",
    frameId: "custom",
    role,
    tier: 1,
    level: 1,
    custom: {
      pitch: "A haunted city",
      themes: "Loss and renewal",
      touchstones: "Dark City",
      tones: ["Gothic", "Hopeful"],
      background: "city",
      partySize: 4,
      startingTier: 1,
    },
    tome: {
      overview: "The city remembers.",
      incident: "",
      mechanics: "",
    },
    options: { hopeAndFear: true },
  }) as unknown as LoadedCampaign;
}

export function inCampaign(campaign: LoadedCampaign, ui: ReactElement, offline = false) {
  return (
    <CampaignProvider campaignId={campaignId}>
      <CampaignScreen>
        <OfflineFrame offline={offline}>{ui}</OfflineFrame>
      </CampaignScreen>
    </CampaignProvider>
  );
}
