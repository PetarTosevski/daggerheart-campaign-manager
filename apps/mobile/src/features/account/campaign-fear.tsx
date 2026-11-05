import { useQuery } from "convex/react";
import { Text, View } from "react-native";

import { api } from "../../convex";

/**
 * Fear for the first campaign this account belongs to.
 * The number comes from `campaigns.fear`, so a Fear change re-renders this screen.
 */
export function CampaignFear() {
  const campaigns = useQuery(api.campaigns.list);
  const campaign = campaigns?.[0];
  const fear = useQuery(api.campaigns.fear, campaign ? { campaignId: campaign._id } : "skip");

  if (campaigns === undefined || (campaign && fear === undefined)) {
    return (
      <View>
        <Text>Loading Fear</Text>
      </View>
    );
  }
  if (!campaign || fear === undefined) {
    return (
      <View>
        <Text>No campaign</Text>
      </View>
    );
  }
  return (
    <View>
      <Text accessibilityRole="header">{campaign.name}</Text>
      <Text accessibilityLabel="Fear" accessibilityLiveRegion="polite">
        {String(fear)}
      </Text>
    </View>
  );
}
