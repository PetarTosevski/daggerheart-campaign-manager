import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { PUBLISHED_FRAMES, type PublishedFrame } from "../../../../../src/lib/frames";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { AccountHeader } from "./chrome";
import { NameCampaignSheet } from "./name-campaign";
import { accountStyles } from "./styles";

/** Frame picker from `src/app/(gm)/new/frame-select.tsx` (published frames only on this screen). */
export function NewCampaignScreen() {
  const params = useLocalSearchParams<{ frame?: string; kind?: string }>();
  const router = useRouter();
  const initialIndex = PUBLISHED_FRAMES.findIndex((f) => f.id === params.frame);
  const [selectedId, setSelectedId] = useState(PUBLISHED_FRAMES[Math.max(0, initialIndex)].id);
  const [search, setSearch] = useState("");
  const [naming, setNaming] = useState(false);

  const frames = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return PUBLISHED_FRAMES;
    return PUBLISHED_FRAMES.filter((f) =>
      [f.name, f.tagline, f.themes, f.touchstones, ...f.tones].some((text) => text.toLowerCase().includes(q)),
    );
  }, [search]);

  const selected = PUBLISHED_FRAMES.find((f) => f.id === selectedId) ?? PUBLISHED_FRAMES[0];

  return (
    <>
      <ScrollView contentContainerStyle={accountStyles.content} style={accountStyles.screen}>
        <AccountHeader backHref="/home" backLabel="Back to main menu" title="Create New Campaign" />
        <Text accessibilityRole="header" style={styles.heading}>
          Existing Campaign Frame & Custom
        </Text>
        <Text style={accountStyles.body}>Begin from a published frame, or forge your own world from nothing.</Text>

        <View style={styles.kindRow}>
          <KindCard checked onPress={() => undefined} title="Published frame" text="Start from a published campaign frame." />
          <KindCard
            checked={false}
            onPress={() => router.push("/new/custom")}
            title="Custom frame"
            text="Write your own pitch, tones, and touchstones."
          />
        </View>

        <Text style={accountStyles.label}>Search frames</Text>
        <TextInput
          accessibilityLabel="Search frames"
          onChangeText={setSearch}
          placeholder="Search by name, tone, or theme"
          placeholderTextColor={colors.faint}
          style={accountStyles.input}
          value={search}
        />

        <View style={styles.list}>
          {frames.map((frame) => (
            <FrameRow frame={frame} key={frame.id} onPick={() => setSelectedId(frame.id)} selected={frame.id === selectedId} />
          ))}
        </View>

        <View style={accountStyles.card}>
          <Text style={styles.frameName}>{selected.name}</Text>
          <Text style={accountStyles.body}>{selected.tagline}</Text>
          <Text style={accountStyles.label}>{selected.themes}</Text>
          <View style={styles.detailActions}>
            <Button onPress={() => router.push(`/frames/${selected.id}`)} size="lg" variant="outline">
              Preview full frame
            </Button>
            <Button onPress={() => setNaming(true)} size="lg" variant="primary">
              Start in this frame
            </Button>
          </View>
        </View>
      </ScrollView>

      <NameCampaignSheet frameId={selected.id} frameLabel={selected.name} onClose={() => setNaming(false)} open={naming} />
    </>
  );
}

function KindCard({
  checked,
  onPress,
  title,
  text,
}: {
  checked: boolean;
  onPress: () => void;
  title: string;
  text: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[styles.kindCard, checked && styles.kindCardOn]}
    >
      <Text style={styles.kindTitle}>{title}</Text>
      <Text style={accountStyles.menuSub}>{text}</Text>
    </Pressable>
  );
}

function FrameRow({ frame, selected, onPick }: { frame: PublishedFrame; selected: boolean; onPick: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPick} style={[styles.frameRow, selected && styles.frameRowOn]}>
      <View style={styles.frameText}>
        <Text style={styles.frameName}>{frame.name}</Text>
        <Text style={accountStyles.label}>{frame.source}</Text>
      </View>
      <Text style={accountStyles.label}>Tier {frame.complexity}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  detailActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
  },
  frameName: {
    ...type.displayBold,
    color: colors.parchment,
    fontSize: 24,
  },
  frameRow: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: space[3],
    justifyContent: "space-between",
    minHeight: 72,
    padding: space[4],
  },
  frameRowOn: {
    borderColor: colors.brand,
    backgroundColor: colors.raised,
  },
  frameText: {
    flex: 1,
    gap: space[1],
  },
  heading: {
    ...type.displayBold,
    color: colors.parchment,
    fontSize: 28,
  },
  kindCard: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 2,
    flex: 1,
    gap: space[2],
    minHeight: 120,
    padding: space[4],
  },
  kindCardOn: {
    borderColor: colors.brand,
    backgroundColor: colors.raised,
  },
  kindRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
  },
  kindTitle: {
    ...type.displayBold,
    color: colors.parchment,
    fontSize: 22,
  },
  list: {
    gap: space[3],
  },
});
