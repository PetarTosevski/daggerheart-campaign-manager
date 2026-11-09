import { useQuery } from "convex/react";
import { randomUUID } from "expo-crypto";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import { frameName } from "../../../../../src/lib/campaign-display";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import { frameHasMechanic } from "../../../../../src/lib/frames";
import { endDialogText, endReportLines, startNumber, startReportLines, startTarget } from "../../../../../src/lib/journal/sessions";
import { api, type Id } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { CheckRow } from "../trackers/card";
import { useIntent } from "../dashboard/intent";
import { useOpenThreads, useSessions } from "./data";
import { patchExtras, useOptimistic } from "./optimistic";
import { journalColors, js } from "./styles";
import type { SessionView } from "./tabs";
import { ActButton, ErrorLine, LoadingLine, Slot } from "./ui";

type Report = { lines: string[]; doomTier?: number };

/**
 * The Journal header (website: the page's header and `JournalHeaderActions`, src/components/journal/header): the
 * campaign line, 'Journal', the sub line; the live chip 'Session N · live' with the GM's End session and 'Allow extra
 * characters this session'; nothing live, the GM's 'Start session N' (the selected planned session, else the newest
 * planned; without one the server creates the next). After a Start the GM goes where the campaign's 'A new session
 * opens on' setting says (the Combat Map, else that session's Log & recap). 'Open threads N' (everyone) opens Notes on
 * its threads view; the Tome button opens the Campaign Tome. Players get the chip read only.
 */
export function JournalHeader({
  selectedId,
  onOpenSession,
  onThreads,
}: {
  selectedId: Id<"sessions"> | null;
  onOpenSession: (sessionId: Id<"sessions">, view?: SessionView) => void;
  onThreads: () => void;
}) {
  const campaign = useCampaign();
  const router = useRouter();
  const threads = useOpenThreads();
  const [report, setReport] = useState<Report | null>(null);
  const campaignLine = campaign.frameId === "custom" ? campaign.name : frameName(campaign.frameId);
  const count = threads?.length;

  return (
    <View style={{ gap: 8 }}>
      <Text style={js.eyebrow}>{campaignLine}</Text>
      <Text accessibilityRole="header" style={js.title}>
        Journal
      </Text>
      <Text style={js.sub}>Every session and every note, in one place.</Text>
      <Slot label="The live session">
        <SessionControl onOpenSession={onOpenSession} onReport={setReport} selectedId={selectedId} />
      </Slot>
      <View style={js.row}>
        <Pressable
          accessibilityLabel={count === undefined ? "Open threads (loading)" : `Open threads: ${count}`}
          accessibilityRole="button"
          onPress={onThreads}
          style={[js.option, js.row]}
        >
          <Text style={js.optionText}>{`Open threads  ${count ?? "…"}`}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Open the Campaign Tome"
          accessibilityRole="button"
          onPress={() => router.push(`/campaign/${campaign._id}/tome`)}
          style={js.option}
        >
          <Text style={js.optionText}>Tome</Text>
        </Pressable>
      </View>
      {report ? (
        <View accessibilityLiveRegion="polite" style={[js.card, { gap: 4 }]}>
          {report.lines.map((line, i) => (
            // The report's lines have no ids; it is rebuilt whole on every Start or End and holds no state.
            <Text key={i} style={js.body}>
              {line}
            </Text>
          ))}
          {report.doomTier !== undefined ? (
            <Pressable accessibilityRole="link" onPress={() => router.push(`/campaign/${campaign._id}`)} style={js.link}>
              <Text style={js.linkText}>{`Mark a Doom Track box (Tier ≤ ${report.doomTier}). Open the Doom Track`}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityLabel="Dismiss the session report" accessibilityRole="button" onPress={() => setReport(null)} style={js.link}>
            <Text style={js.linkText}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SessionControl({
  selectedId,
  onOpenSession,
  onReport,
}: {
  selectedId: Id<"sessions"> | null;
  onOpenSession: (sessionId: Id<"sessions">, view?: SessionView) => void;
  onReport: (report: Report | null) => void;
}) {
  const campaign = useCampaign();
  const campaignId = campaign._id;
  const isGm = campaign.role === "gm";
  const router = useRouter();
  const sessions = useSessions();
  const current = useQuery(api.sessions.current, { campaignId });
  const start = useIntent(api.sessions.start);
  const end = useIntent(api.sessions.end);
  const allowExtras = useOptimistic(api.sessions.allowExtraCharacters, patchExtras);
  const [confirm, setConfirm] = useState<"start" | "end" | null>(null);
  const [convertChoice, setConvertChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [extrasError, setExtrasError] = useState<string | null>(null);

  if (sessions === undefined || current === undefined) return <LoadingLine>Loading the session…</LoadingLine>;

  const liveRow = sessions.find((s) => s.status === "live");
  // A session running from before the Sessions board has no live row; it still ends with End.
  const live = liveRow !== undefined || current.startedAt !== null;
  const liveN = liveRow?.n ?? current.n;
  const target = startTarget(sessions, selectedId);
  const n = startNumber(sessions, target);
  const witherApplies = frameHasMechanic(campaign.frameId, "witherTokens");
  const convert = convertChoice ?? !(campaign.options.witherPersists ?? false);

  if (!live && !isGm) return null;

  async function run() {
    const which = confirm;
    setConfirm(null);
    onReport(null);
    setBusy(true);
    try {
      if (which === "start") {
        const result = await start.fire(target ? { campaignId, sessionId: target._id } : { campaignId });
        if (!result) return;
        onReport({ lines: result.alreadyStarted ? ["The session is already running."] : startReportLines(result) });
        if (!result.sessionId) return;
        // After the mutation resolved (rule 13: never from an effect).
        if (campaign.settings.sessionOpensOn === "combatMap") router.push(`/campaign/${campaignId}/combat-map`);
        else onOpenSession(result.sessionId, "log");
      } else if (which === "end") {
        const result = await end.fire({ campaignId, ...(witherApplies ? { convertWither: convert } : {}) });
        if (!result) return;
        onReport({ lines: endReportLines(result), doomTier: result.doomTier });
      }
    } finally {
      setBusy(false);
    }
  }

  function toggleExtras(allow: boolean) {
    setExtrasError(null);
    allowExtras({ campaignId, allow, idempotencyKey: randomUUID() }).catch((e: unknown) => setExtrasError(errorMessage(e)));
  }

  return (
    <View style={{ gap: 8 }}>
      {live ? (
        <View accessibilityLabel={liveN === undefined ? "Session live" : `Session ${liveN} live`} style={[js.card, { gap: 8 }]} testID="journal-live-chip">
          <View style={js.row}>
            <View style={[js.dot, { backgroundColor: journalColors.live }]} />
            <Text style={js.body}>{liveN === undefined ? "Session · live" : `Session ${liveN} · live`}</Text>
          </View>
          {isGm ? (
            <>
              <ActButton
                accessibilityLabel="End session"
                disabled={busy}
                onPress={() => {
                  setConvertChoice(null);
                  setConfirm("end");
                }}
                variant="danger"
              >
                End session
              </ActButton>
              <View style={js.row}>
                <Switch
                  accessibilityLabel="Allow extra characters this session"
                  accessibilityRole="switch"
                  onValueChange={toggleExtras}
                  value={current.extraCharacters}
                />
                <Text style={[js.body, { flex: 1 }]}>Allow extra characters this session</Text>
              </View>
              <Text style={js.muted}>Players may have more than one active character until the session ends. Characters made active stay active.</Text>
            </>
          ) : null}
        </View>
      ) : (
        <ActButton accessibilityLabel={`Start session ${n}`} disabled={busy} onPress={() => setConfirm("start")} variant="solid">
          {`Start session ${n}`}
        </ActButton>
      )}
      <ErrorLine error={start.error ?? end.error ?? extrasError} />
      {isGm && confirm !== null ? (
        <View accessibilityLabel={confirm === "end" ? "End the session?" : `Start session ${n}?`} style={js.card}>
          <Text accessibilityRole="header" style={js.heading}>
            {confirm === "end" ? "End the session?" : `Start session ${n}?`}
          </Text>
          {confirm === "end" ? (
            <>
              <Text style={js.body}>
                {endDialogText({ applies: witherApplies, convert })}
                {current.extraCharacters ? " Extra characters are no longer allowed; the ones in play stay active." : ""}
              </Text>
              {witherApplies ? (
                <CheckRow
                  checked={convert}
                  label="Turn Wither tokens into Fear (CB p.261). Untick to keep them on the sheets."
                  onPress={() => setConvertChoice(!convert)}
                />
              ) : null}
            </>
          ) : (
            <>
              <Text style={js.body}>Start-of-session features are given out: Prayer Dice, Luckbringer’s Hope and the moon die.</Text>
              {target === null ? <Text style={js.body}>{`No session is planned, so Session ${n} is created.`}</Text> : null}
            </>
          )}
          <View style={js.row}>
            <ActButton onPress={() => setConfirm(null)} variant="outline">
              Cancel
            </ActButton>
            <ActButton
              accessibilityLabel={confirm === "end" ? "Confirm end session" : "Confirm start session"}
              onPress={() => void run()}
              variant={confirm === "end" ? "dangerSolid" : "solid"}
            >
              {confirm === "end" ? "End session" : "Start session"}
            </ActButton>
          </View>
        </View>
      ) : null}
    </View>
  );
}
