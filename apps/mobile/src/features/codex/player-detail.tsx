import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { ALLEGIANCE_UNKNOWN, regionsFor } from "../../../../../src/lib/codex/schema";
import type { PlayerEntry } from "../../../../../src/lib/codex/view";
import { api } from "../../convex";
import type { Id } from "../../convex";
import { colors } from "../../theme/colors";
import { Button } from "../../ui/button";

import { Cover } from "./cover";
import { Gallery, Lightbox, type LightboxState } from "./gallery";
import { codexStyles } from "./styles";

export function PlayerDetail({
  campaignId,
  frameId,
  entry,
}: {
  campaignId: string;
  frameId: string;
  entry: PlayerEntry;
}) {
  const router = useRouter();
  const text = useQuery(api.codex.entryText, { entryId: entry._id as Id<"codexEntries"> });
  const coverUrl = entry.images.find((image) => image.key === entry.cover)?.url ?? null;
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const pdesc = text?.pdesc ?? "";

  return (
    <View style={codexStyles.stack}>
      <View style={codexStyles.card}>
        <Cover
          gm={false}
          name={entry.name}
          onOpen={() => {
            if (entry.cover) setLightbox({ entryId: entry._id, key: entry.cover });
          }}
          url={coverUrl}
        />
        <Text accessibilityRole="header" style={codexStyles.title}>
          {entry.name}
        </Text>
        <Text style={codexStyles.subhead}>{entry.role || (entry.kind === "location" ? "Location" : "Character")}</Text>
        {entry.kind === "character" ? (
          <View style={[codexStyles.badge, { backgroundColor: colors.panel2 }]}>
            <Text style={codexStyles.badgeText}>
              {entry.allegianceShown !== ALLEGIANCE_UNKNOWN ? entry.allegianceShown : "Allegiance unknown"}
            </Text>
          </View>
        ) : regionsFor(frameId).length ? (
          <View style={[codexStyles.badge, { backgroundColor: colors.panel2 }]}>
            <Text style={codexStyles.badgeText}>{entry.region || "Unsorted"}</Text>
          </View>
        ) : null}
        {text === undefined ? (
          <Text accessibilityRole="progressbar" style={codexStyles.muted}>
            Loading notes…
          </Text>
        ) : pdesc.trim() ? (
          <Text style={codexStyles.bodySerif}>{pdesc}</Text>
        ) : null}
        {entry.tokenId !== null ? (
          <Button
            accessibilityLabel="Show on map"
            onPress={() => {
              router.push(`/campaign/${campaignId}/world?token=${entry.tokenId}`);
            }}
            variant="outline"
          >
            Show on map
          </Button>
        ) : null}
      </View>
      <Gallery
        entry={entry}
        gm={false}
        onOpen={(key) => {
          setLightbox({ entryId: entry._id, key });
        }}
      />
      {lightbox ? (
        <Lightbox
          images={entry.images}
          onChange={setLightbox}
          onClose={() => setLightbox(null)}
          state={lightbox}
          title={entry.name}
        />
      ) : null}
    </View>
  );
}
