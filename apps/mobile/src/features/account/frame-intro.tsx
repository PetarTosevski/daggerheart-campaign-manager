import { useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { getPublishedFrame, type PublishedFrameId } from "../../../../../src/lib/frames";
import { TOMES, type Tome, type TomeChapterId } from "../../../../../src/lib/frames/tomes";
import { firstParam } from "../../shell/campaign-provider";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Empty } from "../../ui/empty";
import { AccountHeader } from "./chrome";
import { NameCampaignSheet } from "./name-campaign";
import { accountStyles } from "./styles";

/** Frame intro from `src/app/(gm)/frames/[frameId]/frame-intro.tsx`. */
export function FrameIntroScreen() {
  const params = useLocalSearchParams<{ frameId: string | string[] }>();
  const frame = getPublishedFrame(firstParam(params.frameId));
  const [naming, setNaming] = useState(false);
  const [chapter, setChapter] = useState<TomeChapterId | null>(null);

  if (!frame) {
    return (
      <View style={accountStyles.screen}>
        <AccountHeader backHref="/new" backLabel="Back to campaign frames" title="Campaign Frame" />
        <Empty title="Frame not found" />
      </View>
    );
  }

  const publishedId = frame.id as PublishedFrameId;
  const tome = TOMES[publishedId];

  return (
    <>
      <ScrollView contentContainerStyle={accountStyles.content} style={accountStyles.screen}>
        <AccountHeader backHref={`/new?frame=${frame.id}`} backLabel="Back to campaign frames" title="Campaign Frame" />

        <View style={styles.hero}>
          <Text style={accountStyles.eyebrow}>
            {frame.source} · Complexity {frame.complexity}
          </Text>
          <Text accessibilityRole="header" style={styles.title}>
            {frame.name}
          </Text>
          <Text style={styles.tagline}>{frame.tagline}</Text>
          <Text style={accountStyles.label}>Designed by {frame.designers}</Text>
        </View>

        <Section title="The Pitch">
          {frame.pitch.map((paragraph) => (
            <Text key={paragraph.slice(0, 24)} style={accountStyles.body}>
              {paragraph}
            </Text>
          ))}
        </Section>

        <Section title="Tone & Feel">
          <View style={styles.chips}>
            {frame.tones.map((tone) => (
              <Text key={tone} style={styles.chip}>
                {tone}
              </Text>
            ))}
          </View>
        </Section>

        <Section title="Themes">
          <Text style={accountStyles.body}>{frame.themes}</Text>
        </Section>
        <Section title="Touchstones">
          <Text style={accountStyles.body}>{frame.touchstones}</Text>
        </Section>

        <View style={styles.tomeLinks}>
          <Button onPress={() => setChapter("mechanics")} variant="outline">
            {frame.mechanics}
          </Button>
          <Button onPress={() => setChapter("incident")} variant="outline">
            {frame.incident}
          </Button>
          <Button onPress={() => setChapter("overview")} variant="outline">
            Overview
          </Button>
        </View>

        <Button onPress={() => setNaming(true)} size="lg" variant="primary">
          Choose this Frame
        </Button>

        {chapter ? (
          <View style={accountStyles.card}>
            <Text accessibilityRole="header" style={styles.tomeTitle}>
              {chapter === "overview" ? "Overview" : chapter === "incident" ? "Inciting incident" : "Special mechanics"}
            </Text>
            <Text style={accountStyles.body}>{tomeChapterText(tome, chapter)}</Text>
            <Button onPress={() => setChapter(null)} variant="outline">
              Close
            </Button>
          </View>
        ) : null}
      </ScrollView>

      <NameCampaignSheet frameId={publishedId} frameLabel={frame.name} onClose={() => setNaming(false)} open={naming} />
    </>
  );
}

function tomeChapterText(tome: Tome, chapter: TomeChapterId): string {
  if (chapter === "overview") return tome.overview.paragraphs.join("\n\n");
  if (chapter === "incident") return tome.incident.paragraphs.join("\n\n");
  return tome.mechanics.rules.map((rule) => `${rule.head}. ${rule.text}`).join("\n\n");
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={accountStyles.eyebrow}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderColor: colors.line2,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.parchment,
    fontSize: 13,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  hero: {
    gap: space[2],
  },
  section: {
    gap: space[2],
  },
  tagline: {
    ...type.sans,
    color: colors.body,
    fontSize: 17,
    fontStyle: "italic",
  },
  title: {
    ...type.displayBold,
    color: colors.parchment,
    fontSize: 36,
  },
  tomeLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
  },
  tomeTitle: {
    ...type.displayBold,
    color: colors.parchment,
    fontSize: 22,
  },
});
