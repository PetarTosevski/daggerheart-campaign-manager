import { useMutation } from "convex/react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { getPublishedFrame } from "../../../../../src/lib/frames";
import { TOMES, TOME_CHAPTERS, type TomeChapterId } from "../../../../../src/lib/frames/tomes";
import { api } from "../../convex";
import type { LoadedCampaign } from "../../shell/campaign-provider";
import { sectionLabel } from "../../shell/sections";

import { CustomChapterBody } from "./custom-body";
import { PublishedChapterBody } from "./published-body";
import { tomeStyles as styles } from "./styles";

const EMPTY_TOME = { overview: "", incident: "", mechanics: "" };

function publishedChapterNote(frameId: keyof typeof TOMES, chapter: TomeChapterId): string | undefined {
  const tome = TOMES[frameId];
  if (chapter === "mechanics") return tome.mechanics.note;
  if (chapter === "incident") return tome.incident.note;
  return tome.overview.note;
}

export function TomeBook({ campaign }: { campaign: LoadedCampaign }) {
  const [chapter, setChapter] = useState<TomeChapterId>("overview");
  const updateTome = useMutation(api.campaigns.updateTome);
  const frame = campaign.frameId === "custom" ? null : getPublishedFrame(campaign.frameId)!;
  const kicker = frame
    ? `Campaign Frame · ${frame.expansion ? "Hope & Fear" : "Core Rulebook"}`
    : "Custom Campaign Frame";
  const title = frame ? frame.name : campaign.name;
  const note = frame ? publishedChapterNote(frame.id, chapter) : null;

  return (
    <View style={styles.stack}>
      <Text accessibilityRole="header" style={styles.title}>
        {sectionLabel("tome")}
      </Text>
      <View accessibilityLabel={`${title} tome`} style={styles.book}>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text accessibilityRole="header" style={styles.bookTitle}>
          {title}
        </Text>
        <View accessibilityLabel="Chapters" accessibilityRole="tablist" style={styles.chapterNav}>
          {TOME_CHAPTERS.map((row) => {
            const active = row.id === chapter;
            return (
              <Pressable
                accessibilityLabel={row.title}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                key={row.id}
                onPress={() => setChapter(row.id)}
                style={[styles.chapterButton, active ? styles.chapterActive : null]}
              >
                <Text style={styles.chapterLabel}>
                  <Text style={styles.chapterNumeral}>{row.numeral} </Text>
                  {row.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {note ? <Text style={styles.note}>{note}</Text> : null}
        {frame ? (
          <PublishedChapterBody chapter={chapter} tome={TOMES[frame.id]} />
        ) : (
          <CustomChapterBody
            chapter={chapter}
            onSave={
              campaign.role === "gm"
                ? (c, text) => updateTome({ campaignId: campaign._id, chapter: c, text })
                : undefined
            }
            setup={[
              { label: "Pitch", value: campaign.custom?.pitch ?? "" },
              { label: "Themes", value: campaign.custom?.themes ?? "" },
              { label: "Touchstones", value: campaign.custom?.touchstones ?? "" },
              { label: "Tone", value: (campaign.custom?.tones ?? []).join(", ") },
            ].filter((row) => row.value.trim())}
            text={campaign.tome ?? EMPTY_TOME}
          />
        )}
      </View>
    </View>
  );
}
