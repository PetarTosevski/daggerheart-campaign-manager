import { useMutation } from "convex/react";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { frameName } from "../../../../../src/lib/campaign-display";
import { headerLine, formatSessionDate, sessionTitle, statusLabel } from "../../../../../src/lib/domain/sessions";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import { api } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { WriteButton } from "../../shell/offline";
import { Loading } from "../../ui/loading";
import { sessionStyles as styles } from "./styles";
import { useSessionList } from "./use-list";

function StatusChip({ status }: { status: "planned" | "live" | "played" }) {
  const live = status === "live";
  const played = status === "played";
  return (
    <View style={[styles.chip, live ? styles.chipLive : played ? styles.chipPlayed : null]}>
      <Text style={[styles.chipText, live ? styles.chipTextLive : played ? styles.chipTextPlayed : null]}>{statusLabel(status)}</Text>
    </View>
  );
}

export function SessionsListScreen() {
  const campaign = useCampaign();
  const router = useRouter();
  const sessions = useSessionList(campaign._id);
  const create = useMutation(api.sessionRecords.create);
  const isGm = campaign.role === "gm";
  const [actionError, setActionError] = useState<string | null>(null);

  if (sessions === undefined) return <Loading label="Loading sessions" />;

  async function addSession() {
    setActionError(null);
    try {
      const result = await create({ campaignId: campaign._id, idempotencyKey: Crypto.randomUUID() });
      router.push(`/campaign/${campaign._id}/sessions/${result.sessionId}?stage=prep`);
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.stack}>
      <Text style={styles.eyebrow}>
        {campaign.name} · {frameName(campaign.frameId)}
      </Text>
      <Text accessibilityRole="header" style={styles.title}>
        Sessions
      </Text>
      <Text style={styles.subhead}>{headerLine(sessions)}</Text>
      {isGm ? (
        <WriteButton accessibilityLabel="New session" onPress={() => void addSession()} variant="primary">
          + New session
        </WriteButton>
      ) : null}
      {actionError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {actionError}
        </Text>
      ) : null}
      <Text style={styles.label}>All sessions</Text>
      {sessions.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.muted}>
            {isGm ? "No sessions yet. Create one to start prepping." : "No sessions played yet."}
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          {sessions.map((session) => (
            <Pressable
              key={session._id}
              accessibilityRole="button"
              accessibilityLabel={`Session ${session.n}, ${statusLabel(session.status)}, ${sessionTitle(session.title)}`}
              onPress={() => router.push(`/campaign/${campaign._id}/sessions/${session._id}`)}
              style={styles.listItem}
            >
              <View style={styles.row}>
                <Text style={styles.sessionN}>{`SESSION ${session.n}`}</Text>
                <StatusChip status={session.status} />
              </View>
              <Text style={styles.itemTitle}>{sessionTitle(session.title)}</Text>
              <Text style={styles.muted}>{formatSessionDate(session.date)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
