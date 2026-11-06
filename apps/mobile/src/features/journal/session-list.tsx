import { useQuery } from "convex/react";
import { Pressable, Text, View } from "react-native";

import { sessionTitle } from "../../../../../src/lib/domain/sessions";
import { api, type Id } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { useIntent } from "../dashboard/intent";
import { useOpenThreads, useSessions } from "./data";
import { nextNumber, rowLabel, shortSessionDate } from "./model";
import { js } from "./styles";
import { ActButton, Card, ErrorLine, LoadingLine, StatusChip } from "./ui";

/**
 * The website's left column (src/components/journal/session-list) as the phone's first Sessions screen: 'All sessions'
 * newest first (players get live and played only; the server decides), the GM's '+ Plan session N', and 'Campaign so
 * far'. Tapping a session opens it as its own screen.
 */
export function SessionList({ selectedId, onSelect }: { selectedId: Id<"sessions"> | null; onSelect: (id: Id<"sessions">) => void }) {
  const isGm = useCampaign().role === "gm";
  const sessions = useSessions();
  if (sessions === undefined) return <LoadingLine>Loading sessions…</LoadingLine>;
  return (
    <View style={{ gap: 8 }}>
      <Text style={js.label}>All sessions</Text>
      {sessions.length === 0 ? (
        <Text style={js.muted}>{isGm ? "No sessions yet. Plan the first one below." : "No sessions yet. They show here once the GM starts one."}</Text>
      ) : (
        sessions.map((s) => {
          const title = sessionTitle(s.title);
          const on = s._id === selectedId;
          return (
            <Pressable
              key={s._id}
              accessibilityLabel={rowLabel(s, title)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => onSelect(s._id)}
              style={[js.item, on ? js.itemOn : null]}
            >
              <View style={js.badge}>
                <Text style={js.badgeText}>{s.n}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={js.itemTitle}>{title}</Text>
                <Text style={js.muted}>{shortSessionDate(s.date)}</Text>
              </View>
              <StatusChip status={s.status} />
            </Pressable>
          );
        })
      )}
    </View>
  );
}

/** '+ Plan session N' (GM): creates the next planned session; the screen opens it on Plan. */
export function PlanSessionButton({ onCreated }: { onCreated: (id: Id<"sessions">) => void }) {
  const campaign = useCampaign();
  const sessions = useSessions();
  const create = useIntent(api.sessionRecords.create);
  if (campaign.role !== "gm" || sessions === undefined) return null;
  const n = nextNumber(sessions);
  async function onPress() {
    const result = await create.fire({ campaignId: campaign._id });
    if (result) onCreated(result.sessionId);
  }
  return (
    <View style={{ gap: 4 }}>
      <ActButton accessibilityLabel={`Plan session ${n}`} onPress={() => void onPress()} variant="solid">
        {`+ Plan session ${n}`}
      </ActButton>
      <ErrorLine error={create.error} />
    </View>
  );
}

function SoFarRow({ label, value }: { label: string; value: number | undefined }) {
  return (
    <View accessibilityLabel={`${label}: ${value ?? "loading"}`} accessible style={js.between}>
      <Text style={js.body}>{label}</Text>
      <Text style={js.body}>{value ?? "…"}</Text>
    </View>
  );
}

/** 'Campaign so far': sessions played, hours at the table (whole hours), party level, the caller's open threads. */
export function CampaignSoFar() {
  const campaignId = useCampaign()._id;
  const summary = useQuery(api.sessionRecords.summary, { campaignId });
  const threads = useOpenThreads();
  return (
    <Card heading="Campaign so far">
      <SoFarRow label="Sessions played" value={summary?.sessionsPlayed} />
      <SoFarRow label="Hours at the table" value={summary === undefined ? undefined : Math.max(0, Math.round(summary.hoursAtTable))} />
      <SoFarRow label="Party level" value={summary?.partyLevel} />
      <SoFarRow label="Open threads" value={threads?.length} />
    </Card>
  );
}
