import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import type { Id } from "../../../convex";
import { useCampaign } from "../../../shell/campaign-provider";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { PhotoImportButton } from "./photo-import";

/** Party roster footer: create-character link and GM photo import. */
export function CreateCharacterSlot({ campaignId }: { campaignId: string }) {
  const campaign = useCampaign();
  const router = useRouter();
  const id = campaignId as Id<"campaigns">;
  const isGm = campaign.role === "gm";
  const hopeAndFear = Boolean(campaign.options.hopeAndFear);
  const href = `/campaign/${campaignId}/party/new`;

  return (
    <View style={{ gap: space[3], marginTop: space[2] }}>
      <Text accessibilityRole="header" style={styles.title}>
        Create character
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <PhotoImportButton campaignId={id} hopeAndFear={hopeAndFear} isGm={isGm} />
        <Button onPress={() => router.push(href)} variant="primary">
          + Create character
        </Button>
      </View>
      <Text style={styles.hint}>Pick a class, ancestry, and community in the nine-step wizard.</Text>
    </View>
  );
}

const styles = {
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: type.displayBold.fontWeight,
  },
  hint: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
} as const;
