import { View } from "react-native";

import { AgeOfUmbraTracker } from "./age-of-umbra";
import { AndaluriaTracker } from "./andaluria";
import type { TrackerCampaign } from "./campaign";
import { ColossusTracker } from "./colossus";
import { FiveBannersTracker } from "./five-banners";
import { HorizonTracker } from "./horizon";
import { WeredragonTracker } from "./weredragon";
import { WitherPanel } from "./wither-panel";

export type { TrackerCampaign } from "./campaign";
export { WitherPanel } from "./wither-panel";

/**
 * The frame's own trackers, same switch as the website dashboard's `FrameTrackers`.
 * Witherwild has no row here; its panel is `WitherPanel`.
 */
export function FrameTrackers({ campaign }: { campaign: TrackerCampaign }) {
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

/** Dashboard frame trackers plus the Witherwild panel, in the website's order. */
export function CampaignFramePanels({ campaign }: { campaign: TrackerCampaign }) {
  return (
    <View style={{ gap: 16 }}>
      <FrameTrackers campaign={campaign} />
      <WitherPanel campaign={campaign} />
    </View>
  );
}
