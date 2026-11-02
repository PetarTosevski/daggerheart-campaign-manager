import { useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView } from "react-native";

import { api } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { Loading } from "../../ui/loading";
import { Button } from "../../ui/button";
import { Empty } from "../../ui/empty";

import { GmDetail } from "./gm-detail";
import { findEntry, visibleEntries } from "./list-model";
import type { PlayerEntry } from "../../../../../src/lib/codex/view";
import { PlayerDetail } from "./player-detail";
import { codexStyles } from "./styles";
import { isGmEntry, isGmList } from "./types";

export function CodexEntryScreen() {
  const campaign = useCampaign();
  const router = useRouter();
  const params = useLocalSearchParams<{ entryId: string | string[]; preview?: string | string[] }>();
  const entryId = Array.isArray(params.entryId) ? (params.entryId[0] ?? "") : (params.entryId ?? "");
  const previewParam = Array.isArray(params.preview) ? params.preview[0] : params.preview;
  const preview = previewParam === "1";
  const data = useQuery(api.codex.list, { campaignId: campaign._id });

  if (data === undefined) return <Loading label="Loading entry" />;

  const frameId = campaign.frameId;
  const isGmUser = campaign.role === "gm";
  const { entries, pins } = visibleEntries(data, frameId, preview && isGmUser);
  const entry = findEntry(entries, entryId);

  if (!entry) {
    return (
      <Empty
        message={isGmUser ? "Pick an entry from the list or create a new one." : "When the GM reveals characters and locations, they appear here."}
        title="Not found"
      />
    );
  }

  const showGmEditor = isGmUser && !preview && isGmEntry(entry, true) && isGmList(data);

  return (
    <ScrollView contentContainerStyle={codexStyles.stack}>
      <Button
        accessibilityLabel="Back to list"
        onPress={() => {
          router.back();
        }}
        variant="outline"
      >
        Back to list
      </Button>
      {showGmEditor ? (
        <GmDetail
          campaignId={campaign._id}
          entries={data.entries}
          entry={entry}
          frameId={frameId}
          onDeleted={() => {
            router.replace(`/campaign/${campaign._id}/codex`);
          }}
          pins={pins}
        />
      ) : (
        <PlayerDetail campaignId={campaign._id} entry={entry as PlayerEntry} frameId={frameId} />
      )}
    </ScrollView>
  );
}
