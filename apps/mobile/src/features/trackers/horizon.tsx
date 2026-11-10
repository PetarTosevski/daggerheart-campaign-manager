import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { lastPlayedSession, liveSession } from "../../../../../src/lib/domain/sessions/summary";
import { DOOM_TRACK, type DoomBox, type DoomTier } from "../../../../../src/lib/frames/doom-track";
import {
  FIRST_ECHO,
  MAX_ECHOES,
  TIER_RULE_THRESHOLD,
  markedInTier,
  markRefusal,
  occurredEvents,
  tierRuleActive,
  unmarkRefusal,
  type HorizonState,
} from "../../../../../src/lib/frames/trackers/horizon";
import { api } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";
import { Loading } from "../../ui/loading";
import type { TrackerCampaign } from "./campaign";
import { CheckRow, ErrorText, Notice, TrackerButton, TrackerCard } from "./card";
import { useIntent } from "./intent";

type HorizonView = FunctionReturnType<typeof api.trackers.horizon.get>;
type PlayerView = Extract<HorizonView, { role: "player" }>;
type GmView = Extract<HorizonView, { role: "gm" }>;

/** Journey to Horizon: Soul Echoes (everyone) and the Doom Track (GM; occurred events shown to players). */
export function HorizonTracker({ campaign }: { campaign: TrackerCampaign }) {
  const view = useQuery(api.trackers.horizon.get, { campaignId: campaign._id });
  if (view === undefined) return <Loading label="Loading the frame tracker…" />;
  if (view.role === "player") return <PlayerHorizon view={view} />;
  if (campaign.role !== "gm") {
    return (
      <PlayerHorizon
        view={{ role: "player", echoesCollected: view.echoesCollected, occurred: occurredEvents(view) }}
      />
    );
  }
  return <GmHorizon campaignId={campaign._id} view={view} />;
}

function PlayerHorizon({ view }: { view: PlayerView }) {
  return (
    <View style={styles.stack}>
      <EchoReadout value={view.echoesCollected} />
      <TrackerCard subtitle="Disasters that have befallen New Valloren." title="Doom Track">
        {view.occurred.length ? (
          <View style={styles.stack}>
            {view.occurred.map((event) => (
              <Text key={event.id} style={styles.event}>
                <Text style={styles.meta}>Tier {event.tier} </Text>
                {event.text}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={styles.meta}>No disasters have struck yet.</Text>
        )}
      </TrackerCard>
    </View>
  );
}

function EchoReadout({ value }: { value: number }) {
  return (
    <TrackerCard
      subtitle={`${value} of ${MAX_ECHOES} collected. The party levels up with each new Echo; all ten unlock Horizon.`}
      title="Soul Echoes"
    >
      <View accessibilityLabel="Soul Echoes collected" style={styles.row}>
        {Array.from({ length: MAX_ECHOES }, (_, index) => {
          const n = index + 1;
          const lit = n <= value;
          return (
            <Text key={n} accessibilityLabel={`Soul Echo ${n} of ${MAX_ECHOES}`} style={lit ? styles.echoOn : styles.echoOff}>
              {n}
            </Text>
          );
        })}
      </View>
    </TrackerCard>
  );
}

function GmHorizon({ campaignId, view }: { campaignId: TrackerCampaign["_id"]; view: GmView }) {
  const state: HorizonState = { boxes: view.boxes, echoesCollected: view.echoesCollected };
  return (
    <View style={styles.stack}>
      <SoulEchoes campaignId={campaignId} value={view.echoesCollected} />
      <DoomTrack campaignId={campaignId} partyTier={view.partyTier} state={state} />
    </View>
  );
}

function SoulEchoes({ campaignId, value }: { campaignId: TrackerCampaign["_id"]; value: number }) {
  const set = useIntent(api.trackers.horizon.setEchoes);
  const [notice, setNotice] = useState<string | null>(null);

  async function choose(n: number) {
    const next = n === value ? Math.max(FIRST_ECHO, n - 1) : n;
    if (next === value) return;
    const result = await set.fire({ campaignId, value: next });
    if (!result) return;
    if (result.horizonUnlocked) setNotice("All ten Soul Echoes: the way to Horizon is open.");
    else if (result.levelUps > 0) {
      setNotice(result.levelUps === 1 ? "The party levels up." : `The party levels up ${result.levelUps} times.`);
    } else setNotice(null);
  }

  return (
    <TrackerCard
      subtitle={`${value} of ${MAX_ECHOES} collected. The party levels up with each new Echo; all ten unlock Horizon.`}
      title="Soul Echoes"
    >
      <View accessibilityLabel="Soul Echoes collected" style={styles.row}>
        {Array.from({ length: MAX_ECHOES }, (_, index) => {
          const n = index + 1;
          return (
            <TrackerButton
              key={n}
              accessibilityLabel={`Soul Echo ${n} of ${MAX_ECHOES}`}
              disabled={set.pending}
              onPress={() => void choose(n)}
              variant={n <= value ? "solid" : "outline"}
            >
              {String(n)}
            </TrackerButton>
          );
        })}
      </View>
      <Notice>{notice}</Notice>
      <ErrorText error={set.error} />
    </TrackerCard>
  );
}

function DoomTrack({
  campaignId,
  state,
  partyTier,
}: {
  campaignId: TrackerCampaign["_id"];
  state: HorizonState;
  partyTier: number;
}) {
  const mark = useIntent(api.trackers.horizon.markBox);
  const unmark = useIntent(api.trackers.horizon.unmarkBox);
  const occur = useIntent(api.trackers.horizon.setOccurred);
  const sessions = useQuery(api.sessionRecords.list, { campaignId });
  const sessionNumber = sessions ? (liveSession(sessions) ?? lastPlayedSession(sessions))?.n : undefined;
  const [notice, setNotice] = useState<string | null>(null);
  const pending = mark.pending || unmark.pending || occur.pending;

  async function toggle(id: string, marked: boolean) {
    setNotice(null);
    if (marked) {
      await unmark.fire({ campaignId, boxId: id });
      return;
    }
    const result = await mark.fire({
      campaignId,
      boxId: id,
      ...(sessionNumber !== undefined ? { session: sessionNumber } : {}),
    });
    if (result?.fear) {
      const { gained, lost } = result.fear;
      setNotice(`Gained ${gained} Fear${lost > 0 ? ` (${lost} lost at the cap)` : ""}.`);
    }
  }

  const ctx: BoxCtx = {
    state,
    partyTier,
    pending,
    onToggle: (id, marked) => void toggle(id, marked),
    onOccurred: (id, occurred) => void occur.fire({ campaignId, boxId: id, occurred }),
  };

  return (
    <TrackerCard
      gmOnly
      subtitle={`At the end of each session, mark a box in the party’s tier (Tier ${partyTier}) or below. Nested boxes need the box above. Players see an event once it has occurred.`}
      title="Doom Track"
    >
      <Notice>{notice}</Notice>
      <ErrorText error={mark.error ?? unmark.error ?? occur.error} />
      {DOOM_TRACK.map((tier) => (
        <TierSection key={tier.tier} ctx={ctx} tier={tier} />
      ))}
    </TrackerCard>
  );
}

type BoxCtx = {
  state: HorizonState;
  partyTier: number;
  pending: boolean;
  onToggle: (id: string, marked: boolean) => void;
  onOccurred: (id: string, occurred: boolean) => void;
};

function TierSection({ tier, ctx }: { tier: DoomTier; ctx: BoxCtx }) {
  const count = markedInTier(ctx.state, tier.tier);
  const active = tierRuleActive(ctx.state, tier.tier);
  const locked = tier.tier > ctx.partyTier;
  return (
    <View style={locked ? styles.locked : undefined}>
      <Text accessibilityRole="header" style={styles.tier}>
        Tier {tier.tier}: {tier.title}
      </Text>
      <Text style={styles.meta}>
        {count} marked{active ? " · Active" : ""}
      </Text>
      <Text style={styles.meta}>
        {tier.rule}
        {tier.tier !== 4 && !active ? ` (${count}/${TIER_RULE_THRESHOLD})` : ""}
      </Text>
      {locked ? <Text style={styles.meta}>Above the party’s tier.</Text> : null}
      <BoxList boxes={tier.boxes} ctx={ctx} />
    </View>
  );
}

function BoxList({ boxes, ctx, nested = false }: { boxes: DoomBox[]; ctx: BoxCtx; nested?: boolean }) {
  return (
    <View style={nested ? styles.nested : styles.stack}>
      {boxes.map((box) => (
        <BoxItem key={box.id} box={box} ctx={ctx} />
      ))}
    </View>
  );
}

function BoxItem({ box, ctx }: { box: DoomBox; ctx: BoxCtx }) {
  const entry = ctx.state.boxes[box.id];
  const marked = entry?.marked === true;
  const allowed = marked ? unmarkRefusal(ctx.state, box.id) === null : markRefusal(ctx.state, box.id, ctx.partyTier) === null;
  return (
    <View>
      <CheckRow
        checked={marked}
        disabled={!allowed || ctx.pending}
        label={entry?.session ? `${box.text} (session ${entry.session})` : box.text}
        onPress={() => ctx.onToggle(box.id, marked)}
      />
      {marked ? (
        <TrackerButton
          accessibilityLabel={`Occurred: ${box.text}`}
          disabled={ctx.pending}
          onPress={() => ctx.onOccurred(box.id, !entry.occurred)}
          variant={entry.occurred ? "solid" : "outline"}
        >
          {entry.occurred ? "Occurred" : "Not yet"}
        </TrackerButton>
      ) : null}
      {box.children ? <BoxList boxes={box.children} ctx={ctx} nested /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[3],
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  meta: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  event: {
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.serif.fontFamily,
    fontSize: 16,
    padding: space[3],
  },
  echoOn: {
    color: colors.hope,
    fontFamily: type.displayBold.fontFamily,
    minHeight: hit.minHeight,
    minWidth: hit.minHeight,
    textAlign: "center",
  },
  echoOff: {
    color: colors.mutedText,
    fontFamily: type.displayBold.fontFamily,
    minHeight: hit.minHeight,
    minWidth: hit.minHeight,
    textAlign: "center",
  },
  tier: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 16,
  },
  locked: {
    opacity: 0.75,
  },
  nested: {
    borderColor: colors.line,
    borderLeftWidth: 1,
    gap: space[2],
    marginLeft: space[4],
    paddingLeft: space[3],
  },
});
