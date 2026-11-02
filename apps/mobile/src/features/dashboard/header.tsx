import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { getPhaseName, monthOf, weekInMonth } from "../../../../../src/lib/domain/campaign-time";
import { frameName } from "../../../../../src/lib/campaign-display";
import { frameHasMechanic } from "../../../../../src/lib/frames";
import { api } from "../../convex";
import type { LoadedCampaign } from "../../shell/campaign-provider";
import { WriteButton } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type as textType } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";
import { AlertLine, PanelBoundary, QueryLoading } from "./chrome";
import { useIntent } from "./intent";
import { LastSession } from "./last-session";

export type SessionDashboard = FunctionReturnType<typeof api.sessionWrap.dashboard>;

export function SessionBlock({ campaign }: { campaign: LoadedCampaign }) {
  return (
    <PanelBoundary title="Campaign">
      <SessionBody campaign={campaign} />
    </PanelBoundary>
  );
}

function SessionBody({ campaign }: { campaign: LoadedCampaign }) {
  const summary = useQuery(api.sessionWrap.dashboard, { campaignId: campaign._id });
  return (
    <View style={styles.block}>
      <Header campaign={campaign} summary={summary} />
      <LastSession summary={summary} />
    </View>
  );
}

function Header({
  campaign,
  summary,
}: {
  campaign: LoadedCampaign;
  summary: SessionDashboard | undefined;
}) {
  const isGm = campaign.role === "gm";
  return (
    <View style={styles.header}>
      {frameHasMechanic(campaign.frameId, "campaignTime") ? (
        <TimeArc campaign={campaign} />
      ) : null}
      <Text style={styles.kicker}>{`Active campaign · ${frameName(campaign.frameId)}`}</Text>
      <Text accessibilityRole="header" style={styles.name}>
        {campaign.name}
      </Text>
      <QueryLoading label="Loading sessions" value={summary} />
      {summary ? (
        <Text style={styles.line}>
          {`${summary.dashboardNumber} · Tier ${campaign.tier} · Level ${campaign.level} · ${summary.nextSessionLine}`}
        </Text>
      ) : null}
      <SessionAction campaign={campaign} isGm={isGm} summary={summary} />
    </View>
  );
}

function SessionAction({
  campaign,
  isGm,
  summary,
}: {
  campaign: LoadedCampaign;
  isGm: boolean;
  summary: SessionDashboard | undefined;
}) {
  if (!summary) return null;
  if (summary.live) {
    return <Text style={styles.live}>{`Session ${summary.live.n} in progress`}</Text>;
  }
  if (!isGm) return null;
  return <StartSession campaign={campaign} />;
}

function StartSession({ campaign }: { campaign: LoadedCampaign }) {
  const start = useIntent(api.sessions.start);
  const [confirm, setConfirm] = useState(false);
  return (
    <View style={styles.action}>
      <WriteButton accessibilityLabel="Start Session" onPress={() => setConfirm(true)} variant="primary">
        Start Session
      </WriteButton>
      <Sheet onClose={() => setConfirm(false)} open={confirm} title="Start the session?">
        <Text style={styles.line}>
          The next planned session starts, or a new one if none is planned.
        </Text>
        <WriteButton
          accessibilityLabel="Start session"
          onPress={() => {
            setConfirm(false);
            void start.fire({ campaignId: campaign._id });
          }}
          variant="primary"
        >
          Start session
        </WriteButton>
      </Sheet>
      <AlertLine message={start.error} />
    </View>
  );
}

function TimeArc({ campaign }: { campaign: LoadedCampaign }) {
  const time = useQuery(api.campaignTime.get, { campaignId: campaign._id });
  return (
    <View accessibilityLabel="Time of the long cycle" style={styles.time}>
      <QueryLoading label="Loading time" value={time} />
      {time ? <TimeArcBody campaign={campaign} time={time} /> : null}
    </View>
  );
}

function TimeArcBody({
  campaign,
  time,
}: {
  campaign: LoadedCampaign;
  time: NonNullable<FunctionReturnType<typeof api.campaignTime.get>>;
}) {
  const isGm = campaign.role === "gm";
  const night = time.cycle === "NIGHT";
  return (
    <View style={styles.time}>
      <Text style={styles.kicker}>{night ? "The Long Night" : "The Long Day"}</Text>
      <Text accessibilityLabel="Time stage" style={styles.stage}>
        {getPhaseName(time.cycle, time.cycleDay)}
      </Text>
      <Text style={styles.line}>
        {`Month ${monthOf(time.week)} · Week ${weekInMonth(time.week)} · Day ${time.cycleDay}`}
      </Text>
      <View style={styles.days}>
        {Array.from({ length: 7 }, (_, index) => {
          const day = index + 1;
          const current = day === time.cycleDay;
          const label = `Day ${day}: ${getPhaseName(time.cycle, day)}`;
          return isGm && !current ? (
            <GmDay campaign={campaign} day={day} key={day} label={label} />
          ) : (
            <View key={day} style={styles.day}>
              <Button accessibilityLabel={label} disabled onPress={() => undefined} variant={current ? "primary" : "outline"}>
                {String(day)}
              </Button>
            </View>
          );
        })}
      </View>
      {time.cycleDay === 7 && isGm ? <AdvanceWeek campaign={campaign} night={night} /> : null}
    </View>
  );
}

function GmDay({ campaign, day, label }: { campaign: LoadedCampaign; day: number; label: string }) {
  const setDay = useIntent(api.campaignTime.setDay);
  return (
    <View style={styles.day}>
      <WriteButton
        accessibilityLabel={label}
        onPress={() => void setDay.fire({ campaignId: campaign._id, cycleDay: day })}
        variant="outline"
      >
        {String(day)}
      </WriteButton>
      <AlertLine message={setDay.error} />
    </View>
  );
}

function AdvanceWeek({ campaign, night }: { campaign: LoadedCampaign; night: boolean }) {
  const advance = useIntent(api.campaignTime.advance);
  const label = night ? "Bring the Dawn" : "Bring the Night";
  return (
    <View style={styles.action}>
      <WriteButton accessibilityLabel={label} onPress={() => void advance.fire({ campaignId: campaign._id })} variant="outline">
        {label}
      </WriteButton>
      <AlertLine message={advance.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space[4],
  },
  header: {
    gap: space[2],
  },
  kicker: {
    color: colors.label,
    fontFamily: textType.sans.fontFamily,
    fontSize: 13,
    fontWeight: textType.sans.fontWeight,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  name: {
    color: colors.parchment,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 36,
    fontWeight: textType.displayBold.fontWeight,
  },
  line: {
    color: colors.body,
    fontFamily: textType.sans.fontFamily,
    fontSize: 15,
    fontWeight: textType.sans.fontWeight,
  },
  live: {
    color: colors.ok,
    fontFamily: textType.sansSemibold.fontFamily,
    fontSize: 16,
    fontWeight: textType.sansSemibold.fontWeight,
  },
  action: {
    gap: space[2],
  },
  time: {
    gap: space[2],
  },
  stage: {
    color: colors.brand,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: textType.displayBold.fontWeight,
  },
  days: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  day: {
    gap: space[1],
  },
});
