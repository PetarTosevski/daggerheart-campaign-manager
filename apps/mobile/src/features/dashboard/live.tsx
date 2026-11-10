import { ScrollView, StyleSheet } from "react-native";

import type { LoadedCampaign } from "../../shell/campaign-provider";
import { space } from "../../theme/spacing";
import { Countdowns } from "./countdowns";
import { EndScene, FrameRules } from "./gm-panels";
import { FearPanel } from "./fear";
import { SessionBlock } from "./header";
import { PartyBlock } from "./party";
import { RollFeed } from "./roll-feed";
import { TomeAndFigures } from "./tome";
import { CampaignFramePanels } from "../trackers";

export function LiveDashboard({ campaign }: { campaign: LoadedCampaign }) {
  const isGm = campaign.role === "gm";
  const trackerCampaign = {
    _id: campaign._id,
    frameId: campaign.frameId,
    role: campaign.role,
    options: campaign.options,
  };
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SessionBlock campaign={campaign} />
      <FearPanel campaignId={campaign._id} isGm={isGm} />
      <PartyBlock campaignId={campaign._id} isGm={isGm} />
      <RollFeed campaignId={campaign._id} isGm={isGm} />
      <Countdowns campaignId={campaign._id} isGm={isGm} />
      <CampaignFramePanels campaign={trackerCampaign} />
      <EndScene campaignId={campaign._id} isGm={isGm} />
      <TomeAndFigures campaign={campaign} />
      <FrameRules campaign={campaign} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space[6],
    paddingBottom: space[8],
  },
});
