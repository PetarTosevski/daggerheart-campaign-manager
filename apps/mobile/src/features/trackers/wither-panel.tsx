import { useQuery } from "convex/react";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { WITHER_POOL } from "../../../../../src/lib/domain/wither";
import { frameHasMechanic, isFrameId } from "../../../../../src/lib/frames";
import { api } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Loading } from "../../ui/loading";
import { Sheet } from "../../ui/sheet";
import type { TrackerCampaign } from "./campaign";
import { CheckRow, ErrorText, TrackerButton, TrackerCard } from "./card";
import { endReportLines, witherEndDialogText } from "./end-report";
import { useIntent } from "./intent";

/**
 * Witherwild's Wither Tokens panel. Players read the count and the rule.
 * Ending the session is the GM's `sessions.end`.
 */
export function WitherPanel({ campaign }: { campaign: TrackerCampaign }) {
  if (!isFrameId(campaign.frameId) || !frameHasMechanic(campaign.frameId, "witherTokens")) return null;
  return <Panel campaign={campaign} />;
}

function Panel({ campaign }: { campaign: TrackerCampaign }) {
  const characters = useQuery(api.charactersReads.partySummary, { campaignId: campaign._id });
  const persists = Boolean(campaign.options?.witherPersists);
  const [choice, setChoice] = useState<boolean | null>(null);
  const convert = choice ?? !persists;
  const total =
    characters === undefined
      ? undefined
      : characters.reduce((sum, character) => sum + (character.corrupt ? 0 : (character.sheet.wither ?? 0)), 0);

  return (
    <TrackerCard title="Wither Tokens">
      {total === undefined ? (
        <Loading label="Loading…" />
      ) : (
        <Text testID="wither-panel-count" style={styles.count}>
          <Text style={styles.countStrong}>{total}</Text>
          {` on sheets · ${Math.max(0, WITHER_POOL - total)} in pool`}
        </Text>
      )}
      <Text style={styles.rule}>
        At the end of each session, clear all Wither tokens from the PCs’ sheets and gain an equal amount of Fear.
      </Text>
      {!convert ? <Text style={styles.house}>House rule: Wither stays on the sheets across sessions.</Text> : null}
      {campaign.role === "gm" ? (
        <GmEnd
          campaign={campaign}
          convert={convert}
          onReset={() => setChoice(null)}
          setConvert={setChoice}
          total={total}
        />
      ) : null}
    </TrackerCard>
  );
}

function GmEnd({
  campaign,
  convert,
  total,
  setConvert,
  onReset,
}: {
  campaign: TrackerCampaign;
  convert: boolean;
  total: number | undefined;
  setConvert: (value: boolean | null) => void;
  onReset: () => void;
}) {
  const current = useQuery(api.sessions.current, { campaignId: campaign._id });
  const end = useIntent(api.sessions.end);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState<string[] | null>(null);

  async function run() {
    setConfirm(false);
    setReport(null);
    const result = await end.fire({ campaignId: campaign._id, convertWither: convert });
    if (result) setReport(endReportLines(result));
  }

  return (
    <View style={styles.stack}>
      <TrackerButton
        disabled={total === undefined || end.pending}
        onPress={() => {
          onReset();
          setConfirm(true);
        }}
      >
        {convert ? `End Session · convert ${total ?? 0} to Fear` : "End Session · keep Wither"}
      </TrackerButton>
      <ErrorText error={end.error} />
      {report?.map((line, index) => (
        <Text key={`${index}-${line}`} style={styles.rule}>
          {line}
        </Text>
      ))}
      {confirm ? (
        <Sheet onClose={() => setConfirm(false)} open title="End the session?">
          <Text style={styles.rule}>
            {witherEndDialogText(convert)}
            {current?.extraCharacters ? " Extra characters are no longer allowed; the ones in play stay active." : ""}
          </Text>
          <CheckRow
            checked={convert}
            label="Turn Wither tokens into Fear (CB p.261). Untick to keep them on the sheets."
            onPress={() => setConvert(!convert)}
          />
          <TrackerButton onPress={() => setConfirm(false)}>Cancel</TrackerButton>
          <TrackerButton onPress={() => void run()} variant="dangerSolid">
            End session
          </TrackerButton>
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[2] },
  count: { color: colors.body, fontFamily: type.sans.fontFamily, fontSize: 15 },
  countStrong: { color: colors.fear, fontFamily: type.displayBold.fontFamily, fontSize: 22 },
  rule: { color: colors.body, fontFamily: type.sans.fontFamily, fontSize: 14 },
  house: {
    backgroundColor: colors.fearBg,
    borderRadius: radius.md,
    color: colors.fear,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    padding: space[2],
  },
});
