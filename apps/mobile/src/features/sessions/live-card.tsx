import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as Crypto from "expo-crypto";
import { useState } from "react";
import { Switch, Text, View } from "react-native";

import { frameHasMechanic } from "../../../../../src/lib/frames";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import { api } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { WriteButton } from "../../shell/offline";
import { CheckRow } from "../trackers/card";
import { endReportLines, witherEndDialogText } from "../trackers/end-report";
import { useIntent } from "../dashboard/intent";
import type { SessionSlotProps } from "./slots";
import { sessionStyles as styles } from "./styles";
import type { SessionListItem } from "../../../../../convex/sessionRecords";

type StartResult = FunctionReturnType<typeof api.sessions.start>;

function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function startReportLines(result: StartResult): string[] {
  const previous = result.ended?.n !== undefined ? `Session ${result.ended.n} ended first.` : "The running session ended first.";
  const ended = result.ended
    ? endReportLines(result.ended).map((line, i) => (i === 0 ? line.replace("Session ended.", previous) : line))
    : [];
  const notes = result.notes ?? [];
  return [
    ...ended,
    notes.length > 0 ? `Session started. ${notes.join("; ")}.` : "Session started.",
    ...(result.features ?? []).map((line) => `${line}.`),
    ...(result.reminders ?? []),
  ];
}

export function LiveCard({
  campaignId,
  sessionId,
  sessions,
  onStage,
}: SessionSlotProps & { sessions: SessionListItem[] | undefined }) {
  const campaign = useCampaign();
  const current = useQuery(api.sessions.current, { campaignId });
  const start = useIntent(api.sessions.start);
  const end = useIntent(api.sessions.end);
  const allowExtras = useMutation(api.sessions.allowExtraCharacters);
  const [extrasError, setExtrasError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"start" | "end" | null>(null);
  const [report, setReport] = useState<string[] | null>(null);
  const [convertWither, setConvertWither] = useState<boolean | null>(null);
  const witherApplies = frameHasMechanic(campaign.frameId, "witherTokens");
  const convert = convertWither ?? !(campaign.options.witherPersists ?? false);

  if (sessions === undefined || current === undefined) {
    return (
      <View accessibilityLabel="Live session" style={styles.card}>
        <Text accessibilityRole="status" style={styles.muted}>
          Loading the live session…
        </Text>
      </View>
    );
  }
  const session = sessions.find((s) => s._id === sessionId);
  if (session === undefined) return null;

  const live = session.status === "live";
  const other = sessions.find((s) => s.status === "live" && s._id !== sessionId);
  const otherRunning = !live && (other !== undefined || current.startedAt !== null);
  const otherText = other ? `Session ${other.n} is still running. Starting this one ends it.` : "A session is still running. Starting this one ends it.";
  const since = session.startedAt ?? current.startedAt;
  const text = live
    ? `${since !== null ? `Live since ${hhmm(since)}` : "Live"}. Party sheets know the session is running.`
    : session.status === "played"
      ? "This session has been played. Starting it again re-rolls Prayer Dice and refreshes Rally."
      : "Start the session when you sit down at the table. Seraphs roll their Prayer Dice, the Bard Rally refreshes, Luckbringer gives everyone a Hope and Moon Witches roll their moon die.";

  async function runStart() {
    setConfirm(null);
    setReport(null);
    const result = await start.fire({ campaignId, sessionId });
    if (!result) return;
    setReport(result.alreadyStarted ? ["The session is already running."] : startReportLines(result));
    onStage("play");
  }

  async function runEnd() {
    setConfirm(null);
    setReport(null);
    const result = await end.fire({
      campaignId,
      ...(witherApplies ? { convertWither: convert } : {}),
    });
    if (!result) return;
    setReport(endReportLines(result));
    onStage("wrap");
  }

  function toggleExtras(allow: boolean) {
    setExtrasError(null);
    void allowExtras({ campaignId, allow, idempotencyKey: Crypto.randomUUID() }).catch((e: unknown) =>
      setExtrasError(errorMessage(e)),
    );
  }

  const dialogError = start.error ?? end.error ?? extrasError;

  return (
    <View accessibilityLabel="Live session" style={styles.card}>
      <View style={styles.row}>
        {live ? <View style={styles.liveDot} /> : null}
        <Text style={styles.liveTitle}>{live ? "Session in progress" : "Not running"}</Text>
      </View>
      <Text style={styles.muted}>{text}</Text>
      {otherRunning ? <Text style={styles.muted}>{otherText}</Text> : null}
      {live ? (
        <WriteButton
          accessibilityLabel="End session"
          onPress={() => {
            setConvertWither(null);
            setConfirm("end");
          }}
          variant="primary"
        >
          End session
        </WriteButton>
      ) : (
        <WriteButton accessibilityLabel="Start session" onPress={() => setConfirm("start")} variant="primary">
          Start session
        </WriteButton>
      )}
      {live ? (
        <View style={styles.row}>
          <Switch
            accessibilityLabel="Allow extra characters this session"
            accessibilityRole="switch"
            onValueChange={toggleExtras}
            value={current.extraCharacters}
          />
          <Text style={styles.body}>Allow extra characters this session</Text>
        </View>
      ) : null}
      {dialogError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {dialogError}
        </Text>
      ) : null}
      {report?.map((line, index) => (
        <Text key={index} style={styles.body}>
          {line}
        </Text>
      ))}
      {confirm === "start" ? (
        <View style={styles.card}>
          <Text style={styles.body}>Start-of-session features are given out: Prayer Dice, Luckbringer Hope and the moon die.</Text>
          {session.status === "played" ? (
            <Text style={styles.muted}>This session has been played. Starting it again re-rolls Prayer Dice and refreshes Rally.</Text>
          ) : null}
          {otherRunning ? <Text style={styles.muted}>{otherText}</Text> : null}
          <View style={styles.row}>
            <WriteButton accessibilityLabel="Cancel start session" onPress={() => setConfirm(null)} variant="outline">
              Cancel
            </WriteButton>
            <WriteButton accessibilityLabel="Confirm start session" onPress={() => void runStart()} variant="primary">
              Start session
            </WriteButton>
          </View>
        </View>
      ) : null}
      {confirm === "end" ? (
        <View style={styles.card}>
          <Text style={styles.body}>
            {witherApplies ? witherEndDialogText(convert) : witherEndDialogText(true)}
            {current.extraCharacters ? " Extra characters are no longer allowed; the ones in play stay active." : ""}
          </Text>
          {witherApplies ? (
            <CheckRow checked={convert} label="Turn Wither tokens into Fear (CB p.261). Untick to keep them on the sheets." onPress={() => setConvertWither((v) => !(v ?? convert))} />
          ) : null}
          <View style={styles.row}>
            <WriteButton accessibilityLabel="Cancel end session" onPress={() => setConfirm(null)} variant="outline">
              Cancel
            </WriteButton>
            <WriteButton accessibilityLabel="Confirm end session" onPress={() => void runEnd()} variant="primary">
              End session
            </WriteButton>
          </View>
        </View>
      ) : null}
    </View>
  );
}
