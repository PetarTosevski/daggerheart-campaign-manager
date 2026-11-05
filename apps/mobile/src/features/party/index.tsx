import { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

import { useQuery } from "convex/react";

import { frameName } from "../../../../../src/lib/campaign-display";
import { api } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Empty } from "../../ui/empty";
import { Loading } from "../../ui/loading";
import { CharacterSheet } from "../sheet";
import { QueryBoundary } from "../sheet/query-boundary";
import { readParty, readTable } from "../sheet/types";
import { RosterCard } from "./card";
import { CreateCharacterSlot } from "./create";
import { PartyLevelUp } from "./level-up";

export function PartyScreen() {
  return (
    <QueryBoundary>
      <PartyBody />
    </QueryBoundary>
  );
}

function PartyBody() {
  const campaign = useCampaign();
  const listed = useQuery(api.charactersReads.listByCampaign, { campaignId: campaign._id });
  const roster = useQuery(api.members.roster, { campaignId: campaign._id });
  const [openId, setOpenId] = useState<string | null>(null);
  if (openId) {
    return <CharacterSheet characterId={openId} onClose={() => setOpenId(null)} />;
  }
  if (listed === undefined || roster === undefined) return <Loading label="Loading the party" />;
  const characters = readParty(listed);
  const table = readTable(roster);
  if (characters == null || table == null) {
    return <Empty message="The party could not be read." title="The Party" />;
  }
  const isGm = campaign.role === "gm";
  return (
    <ScrollView contentContainerStyle={styles.stack}>
      <Text style={styles.eyebrow}>
        {frameName(campaign.frameId)} · Party
      </Text>
      <Text accessibilityRole="header" style={styles.title}>
        The Party
      </Text>
      <PartyLevelUp campaignId={campaign._id} isGm={isGm} />
      {characters.length === 0 ? (
        <Text style={styles.empty}>No characters yet. Create the first hero of this party.</Text>
      ) : null}
      {characters.map((character) => {
        const activeOfOwner =
          character.status === "active"
            ? characters.filter((other) => other.ownerId === character.ownerId && other.status === "active").length
            : 0;
        return (
          <RosterCard
            activeOfOwner={activeOfOwner}
            character={character}
            isGm={isGm}
            key={character._id}
            onOpen={() => setOpenId(character._id)}
            table={table}
          />
        );
      })}
      <CreateCharacterSlot campaignId={campaign._id} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[4],
    paddingBottom: space[8],
  },
  eyebrow: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 32,
    fontWeight: type.displayBold.fontWeight,
  },
  empty: {
    color: colors.body,
    fontFamily: type.serif.fontFamily,
    fontSize: 18,
    fontStyle: type.serif.fontStyle,
  },
});
