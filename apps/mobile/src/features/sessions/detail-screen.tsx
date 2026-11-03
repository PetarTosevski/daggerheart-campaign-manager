import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { Id } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { Loading } from "../../ui/loading";
import { PlayerSessionView, SessionHeaderCard } from "./detail-header";
import { LiveCard } from "./live-card";
import { PlayStage } from "./play-stage";
import { PrepStage } from "./prep-stage";
import { SESSION_STAGES, parseStage, type SessionStage } from "./slots";
import { sessionStyles as styles } from "./styles";
import { useSessionList } from "./use-list";
import { WrapStage } from "./wrap-stage";

function StageTabs({ stage, onStage }: { stage: SessionStage; onStage: (stage: SessionStage) => void }) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel="Session stage" style={styles.tabs}>
      {SESSION_STAGES.map(({ id, label }) => (
        <Pressable
          key={id}
          accessibilityRole="tab"
          accessibilityState={{ selected: stage === id }}
          onPress={() => onStage(id)}
          style={[styles.tab, stage === id ? styles.tabActive : null]}
        >
          <Text style={[styles.tabText, stage === id ? styles.tabTextActive : null]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function SessionDetailScreen() {
  const campaign = useCampaign();
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId: string; stage?: string }>();
  const sessionId = params.sessionId as Id<"sessions">;
  const stage = parseStage(params.stage ?? null);
  const isGm = campaign.role === "gm";
  const sessions = useSessionList(campaign._id);

  function onStage(next: SessionStage) {
    router.setParams({ stage: next });
  }

  function onDeleted() {
    router.replace(`/campaign/${campaign._id}/sessions`);
  }

  if (sessions === undefined) return <Loading label="Loading sessions" />;

  return (
    <ScrollView contentContainerStyle={styles.stack}>
      {isGm ? (
        <>
          <SessionHeaderCard campaignId={campaign._id} onDeleted={onDeleted} sessionId={sessionId} sessions={sessions} />
          <LiveCard
            campaignId={campaign._id}
            isGm={isGm}
            onStage={onStage}
            sessionId={sessionId}
            sessions={sessions}
            stage={stage}
          />
          <StageTabs onStage={onStage} stage={stage} />
          {stage === "prep" ? <PrepStage campaignId={campaign._id} sessionId={sessionId} sessions={sessions} /> : null}
          {stage === "play" ? <PlayStage campaignId={campaign._id} sessionId={sessionId} /> : null}
          {stage === "wrap" ? <WrapStage campaignId={campaign._id} sessionId={sessionId} /> : null}
        </>
      ) : (
        <PlayerSessionView sessionId={sessionId} sessions={sessions} />
      )}
    </ScrollView>
  );
}
