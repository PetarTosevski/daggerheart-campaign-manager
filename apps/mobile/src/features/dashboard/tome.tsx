import { useQuery } from "convex/react";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { KEY_FIGURES, TOMES, TOME_CHAPTERS, type TomeChapterId } from "../../../../../src/lib/frames/tomes";
import { api } from "../../convex";
import type { LoadedCampaign } from "../../shell/campaign-provider";
import { colors } from "../../theme/colors";
import { type as textType } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { PanelBoundary, QueryLoading } from "./chrome";

export function TomeAndFigures({ campaign }: { campaign: LoadedCampaign }) {
  return (
    <View style={styles.block}>
      <Tome campaign={campaign} />
      <KeyFigures campaign={campaign} />
      <PanelBoundary title="Locations">
        <Locations campaign={campaign} />
      </PanelBoundary>
    </View>
  );
}

function chapterBody(campaign: LoadedCampaign, id: TomeChapterId): string {
  if (campaign.frameId === "custom") {
    const text = campaign.tome?.[id]?.trim();
    return text && text.length > 0 ? text : "This chapter is empty.";
  }
  const chapter = TOMES[campaign.frameId][id];
  if ("paragraphs" in chapter) return chapter.paragraphs.join("\n\n");
  const intro = chapter.intro?.join("\n\n") ?? "";
  const rules = chapter.rules.map((rule) => `${rule.head}\n${rule.text}`).join("\n\n");
  return [intro, rules].filter((part) => part.length > 0).join("\n\n");
}

function Tome({ campaign }: { campaign: LoadedCampaign }) {
  const [open, setOpen] = useState<TomeChapterId | null>(null);
  return (
    <View style={styles.tome}>
      <Text accessibilityRole="header" style={styles.tomeTitle}>
        Campaign Tome
      </Text>
      {TOME_CHAPTERS.map((chapter) => (
        <Button
          accessibilityLabel={chapter.title}
          key={chapter.id}
          onPress={() => setOpen(open === chapter.id ? null : chapter.id)}
          variant="outline"
        >
          {`${chapter.numeral} ${chapter.title}`}
        </Button>
      ))}
      {open ? <Text style={styles.tomeBody}>{chapterBody(campaign, open)}</Text> : null}
    </View>
  );
}

function KeyFigures({ campaign }: { campaign: LoadedCampaign }) {
  const figures = campaign.frameId === "custom" ? [] : KEY_FIGURES[campaign.frameId];
  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={styles.title}>
        Key Figures
      </Text>
      {figures.length === 0 ? (
        <Text style={styles.body}>Your campaign’s key figures live in your Inciting Incident.</Text>
      ) : (
        figures.map((figure) => (
          <View key={figure.name} style={styles.figure}>
            <Text style={styles.name}>{figure.name}</Text>
            <Text style={styles.meta}>{figure.role}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function Locations({ campaign }: { campaign: LoadedCampaign }) {
  const locations = useQuery(api.maps.locations, { campaignId: campaign._id });
  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={styles.title}>
        Locations
      </Text>
      <QueryLoading label="Loading locations" value={locations} />
      {locations === undefined ? null : locations.length === 0 ? (
        <Text style={styles.body}>No locations yet. On the World map, select a marker and tick “Location” to pin it here.</Text>
      ) : (
        locations.map((location) => (
          <Text key={location.id} style={styles.body}>
            {`${location.name} · ${location.typeLabel}${location.partyHere ? " · party is here" : ""}${location.hidden ? " · hidden from players" : ""}`}
          </Text>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space[2],
  },
  title: {
    color: colors.parchment,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: textType.displayBold.fontWeight,
  },
  tome: {
    backgroundColor: "#efe3c8",
    borderRadius: radius.lg,
    gap: space[2],
    padding: space[4],
  },
  tomeTitle: {
    color: "#2a1f14",
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: textType.displayBold.fontWeight,
  },
  tomeBody: {
    color: "#2a1f14",
    fontFamily: textType.serif.fontFamily,
    fontSize: 16,
    fontStyle: textType.serif.fontStyle,
    fontWeight: textType.serif.fontWeight,
  },
  body: {
    color: colors.body,
    fontFamily: textType.sans.fontFamily,
    fontSize: 15,
    fontWeight: textType.sans.fontWeight,
  },
  figure: {
    gap: space[1],
    paddingVertical: space[2],
  },
  name: {
    color: colors.parchment,
    fontFamily: textType.sansSemibold.fontFamily,
    fontSize: 16,
    fontWeight: textType.sansSemibold.fontWeight,
  },
  meta: {
    color: colors.subtle,
    fontFamily: textType.sans.fontFamily,
    fontSize: 13,
    fontWeight: textType.sans.fontWeight,
  },
});
