import { Text, View } from "react-native";

import { LOREKEEPER_NAME, LOREKEEPER_SUBTITLE } from "../../../../../src/lib/lorekeeper/copy";
import { useCampaign } from "../../shell/campaign-provider";
import { LorekeeperChat } from "./chat";
import { ConversationsMenu } from "./conversations-menu";
import { IndexPill } from "./library";
import { LorekeeperSlotBoundary } from "./query-boundary";
import { LorekeeperSide } from "./side";
import { lkStyles } from "./styles";

export function LorekeeperScreen() {
  return (
    <LorekeeperSlotBoundary label="Lorekeeper">
      <LorekeeperBody />
    </LorekeeperSlotBoundary>
  );
}

function LorekeeperBody() {
  const campaign = useCampaign();
  const access = { isGm: campaign.role === "gm" };
  const chat = { campaignId: campaign._id, access, variant: "page" as const };
  const side = { campaignId: campaign._id, access };

  return (
    <View style={lkStyles.fill}>
      <View style={lkStyles.header}>
        <View style={lkStyles.headerRow}>
          <View style={lkStyles.headerText}>
            <Text accessibilityRole="header" style={lkStyles.title}>
              {LOREKEEPER_NAME}
            </Text>
            <Text style={lkStyles.subtitle}>{LOREKEEPER_SUBTITLE}</Text>
          </View>
          <View style={lkStyles.headerActions}>
            <IndexPill {...side} />
            <ConversationsMenu {...chat} />
          </View>
        </View>
      </View>
      <LorekeeperSide {...side} />
      <LorekeeperChat {...chat} />
    </View>
  );
}
