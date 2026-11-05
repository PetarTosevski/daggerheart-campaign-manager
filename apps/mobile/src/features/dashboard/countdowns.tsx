import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { api, type Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type as textType } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";
import { AlertLine, PanelBoundary, QueryLoading } from "./chrome";
import { NewCountdownForm } from "./gm-panels";
import { useIntent } from "./intent";

type Countdown = FunctionReturnType<typeof api.countdowns.listByCampaign>[number];
type Item =
  | { kind: "single"; countdown: Countdown }
  | { kind: "chase"; party?: Countdown; rivals?: Countdown };

function listItems(countdowns: readonly Countdown[]): Item[] {
  const byId = new Map(countdowns.map((countdown) => [countdown._id, countdown]));
  const placed = new Set<string>();
  const items: Item[] = [];
  for (const countdown of countdowns) {
    if (placed.has(countdown._id)) continue;
    if (countdown.chase === null) {
      items.push({ kind: "single", countdown });
      continue;
    }
    const partner = byId.get(countdown.chase.partnerId);
    placed.add(countdown._id);
    if (partner) placed.add(partner._id);
    items.push(
      countdown.chase.side === "party"
        ? { kind: "chase", party: countdown, rivals: partner }
        : { kind: "chase", party: partner, rivals: countdown },
    );
  }
  return items;
}

export function Countdowns({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  return (
    <PanelBoundary title="Countdowns">
      <CountdownBody campaignId={campaignId} isGm={isGm} />
    </PanelBoundary>
  );
}

function CountdownBody({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const countdowns = useQuery(api.countdowns.listByCampaign, { campaignId });
  const [creating, setCreating] = useState(false);
  const [chasing, setChasing] = useState(false);
  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={styles.heading}>
        Countdowns
      </Text>
      {isGm ? (
        <View style={styles.row}>
          <Button accessibilityLabel="New chase" onPress={() => setChasing(true)} variant="outline">
            New chase
          </Button>
          <Button accessibilityLabel="New countdown" onPress={() => setCreating(true)} variant="outline">
            New countdown
          </Button>
        </View>
      ) : null}
      <QueryLoading label="Loading countdowns" value={countdowns} />
      {countdowns === undefined ? null : countdowns.length === 0 ? (
        <Text style={styles.empty}>
          {isGm ? "No countdowns running. Start one from 20 down to 1." : "No countdowns running."}
        </Text>
      ) : (
        listItems(countdowns).map((item) =>
          item.kind === "single" ? (
            <CountdownCard campaignId={campaignId} countdown={item.countdown} isGm={isGm} key={item.countdown._id} />
          ) : (
            <ChaseCard
              campaignId={campaignId}
              isGm={isGm}
              key={(item.party ?? item.rivals)!._id}
              party={item.party}
              rivals={item.rivals}
            />
          ),
        )
      )}
      {isGm ? (
        <>
          <Sheet onClose={() => setCreating(false)} open={creating} title="New countdown">
            <NewCountdownForm campaignId={campaignId} onClose={() => setCreating(false)} />
          </Sheet>
          <Sheet onClose={() => setChasing(false)} open={chasing} title="New chase">
            <NewChaseForm campaignId={campaignId} onClose={() => setChasing(false)} />
          </Sheet>
        </>
      ) : null}
    </View>
  );
}

function CountdownCard({
  campaignId,
  countdown,
  isGm,
}: {
  campaignId: Id<"campaigns">;
  countdown: Countdown;
  isGm: boolean;
}) {
  const name = countdown.name ?? "Countdown";
  return (
    <View accessibilityLabel={name} style={styles.card}>
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.meta}>{countdown.status}</Text>
      {countdown.currentValue !== null && countdown.startingValue !== null ? (
        <Text style={styles.meta}>{`${countdown.currentValue} / ${countdown.startingValue}`}</Text>
      ) : null}
      {countdown.description ? <Text style={styles.meta}>{countdown.description}</Text> : null}
      {countdown.steps
        ? countdown.steps.map((step) => (
            <Text key={step.value} style={styles.meta}>
              {step.text}
            </Text>
          ))
        : null}
      {isGm ? <GmCountdownActions campaignId={campaignId} countdown={countdown} /> : null}
    </View>
  );
}

function ChaseCard({
  campaignId,
  isGm,
  party,
  rivals,
}: {
  campaignId: Id<"campaigns">;
  isGm: boolean;
  party?: Countdown;
  rivals?: Countdown;
}) {
  const bothZero = party?.currentValue === 0 && rivals?.currentValue === 0;
  return (
    <View accessibilityLabel="Chase" style={styles.card}>
      <Text style={styles.name}>Chase</Text>
      {party ? <CountdownCard campaignId={campaignId} countdown={party} isGm={isGm} /> : null}
      {rivals ? <CountdownCard campaignId={campaignId} countdown={rivals} isGm={isGm} /> : null}
      {isGm && bothZero && party && party.chaseResult === null ? (
        <DecideChase campaignId={campaignId} countdownId={party._id} />
      ) : null}
    </View>
  );
}

function GmCountdownActions({ campaignId, countdown }: { campaignId: Id<"campaigns">; countdown: Countdown }) {
  const operate = useIntent(api.countdowns.operate);
  const arm = useIntent(api.countdowns.setArmed);
  const visibility = useIntent(api.countdowns.setVisibility);
  const setStep = useIntent(api.countdownTracks.setStep);
  const setRestMode = useIntent(api.countdownTracks.setRestMode);
  const writes = useWritesEnabled();
  const [stepText, setStepText] = useState("");
  const error = operate.error ?? arm.error ?? visibility.error ?? setStep.error ?? setRestMode.error;
  const active = countdown.status === "active";
  const paused = countdown.status === "paused";

  function run(action: "advance" | "reverse" | "pause" | "resume" | "cancel") {
    void operate.fire({ countdownId: countdown._id, action });
  }

  return (
    <View style={styles.block}>
      <View style={styles.row}>
        {active ? (
          <Button accessibilityLabel={`Advance ${countdown.name ?? "countdown"}`} disabled={!writes} onPress={() => run("advance")} variant="outline">
            Advance
          </Button>
        ) : null}
        {active ? (
          <Button accessibilityLabel={`Reverse ${countdown.name ?? "countdown"}`} disabled={!writes} onPress={() => run("reverse")} variant="outline">
            Reverse
          </Button>
        ) : null}
        {active ? (
          <Button accessibilityLabel={`Pause ${countdown.name ?? "countdown"}`} disabled={!writes} onPress={() => run("pause")} variant="outline">
            Pause
          </Button>
        ) : null}
        {paused ? (
          <Button accessibilityLabel={`Resume ${countdown.name ?? "countdown"}`} disabled={!writes} onPress={() => run("resume")} variant="outline">
            Resume
          </Button>
        ) : null}
        {countdown.status !== "cancelled" && countdown.status !== "completed" ? (
          <Button accessibilityLabel={`Cancel ${countdown.name ?? "countdown"}`} disabled={!writes} onPress={() => run("cancel")} variant="danger">
            Cancel
          </Button>
        ) : null}
      </View>
      {countdown.armed !== null ? (
        <Button
          accessibilityLabel={countdown.armed ? "Disarm countdown" : "Arm countdown"}
          disabled={!writes}
          onPress={() => void arm.fire({ campaignId, countdownId: countdown._id, armed: !countdown.armed })}
          variant="outline"
        >
          {countdown.armed ? "Disarm" : "Arm"}
        </Button>
      ) : null}
      <Button
        accessibilityLabel={countdown.visibility.mode === "private" ? "Show to players" : "Hide from players"}
        disabled={!writes}
        onPress={() =>
          void visibility.fire({
            campaignId,
            countdownId: countdown._id,
            visibility:
              countdown.visibility.mode === "private"
                ? { mode: "public", hidden: [] }
                : { mode: "private" },
          })
        }
        variant="outline"
      >
        {countdown.visibility.mode === "private" ? "Show to players" : "Hide from players"}
      </Button>
      {countdown.steps !== null && countdown.currentValue !== null ? (
        <View style={styles.block}>
          <TextInput
            accessibilityLabel="Step text"
            onChangeText={setStepText}
            placeholder="Step"
            placeholderTextColor={colors.subtle}
            style={styles.input}
            value={stepText}
          />
          <Button
            accessibilityLabel="Save step"
            disabled={!writes || stepText.trim().length === 0}
            onPress={() =>
              void setStep.fire({
                campaignId,
                countdownId: countdown._id,
                value: countdown.currentValue ?? 0,
                text: stepText.trim(),
              })
            }
            variant="outline"
          >
            Save step
          </Button>
        </View>
      ) : null}
      {countdown.restMode !== null ? (
        <View style={styles.row}>
          <Button
            accessibilityLabel="Rest mode automatic"
            disabled={!writes}
            onPress={() => void setRestMode.fire({ campaignId, countdownId: countdown._id, restMode: "auto" })}
            variant={countdown.restMode === "auto" ? "primary" : "outline"}
          >
            Automatic
          </Button>
          <Button
            accessibilityLabel="Rest mode reminder"
            disabled={!writes}
            onPress={() => void setRestMode.fire({ campaignId, countdownId: countdown._id, restMode: "remind" })}
            variant={countdown.restMode === "remind" ? "primary" : "outline"}
          >
            Reminder
          </Button>
        </View>
      ) : null}
      <AlertLine message={error} />
    </View>
  );
}

function DecideChase({ campaignId, countdownId }: { campaignId: Id<"campaigns">; countdownId: Id<"countdowns"> }) {
  const decide = useIntent(api.countdowns.decideChase);
  const writes = useWritesEnabled();
  return (
    <View style={styles.row}>
      <Button
        accessibilityLabel="The chase is caught"
        disabled={!writes}
        onPress={() => void decide.fire({ campaignId, countdownId, result: "caught" })}
        variant="outline"
      >
        Caught
      </Button>
      <Button
        accessibilityLabel="The chase escaped"
        disabled={!writes}
        onPress={() => void decide.fire({ campaignId, countdownId, result: "escaped" })}
        variant="outline"
      >
        Escaped
      </Button>
      <AlertLine message={decide.error} />
    </View>
  );
}

function NewChaseForm({ campaignId, onClose }: { campaignId: Id<"campaigns">; onClose: () => void }) {
  const create = useIntent(api.countdowns.createChase);
  const writes = useWritesEnabled();
  const [name, setName] = useState("");
  const [starting, setStarting] = useState("6");
  const value = Number.parseInt(starting, 10);
  const ready = name.trim().length > 0 && Number.isInteger(value) && value >= 2 && value <= 20;
  return (
    <View style={styles.block}>
      <TextInput
        accessibilityLabel="Rivals"
        onChangeText={setName}
        placeholder="Who the party chases"
        placeholderTextColor={colors.subtle}
        style={styles.input}
        value={name}
      />
      <TextInput
        accessibilityLabel="Chase start"
        keyboardType="number-pad"
        onChangeText={setStarting}
        style={styles.input}
        value={starting}
      />
      <Button
        accessibilityLabel="Create chase"
        disabled={!writes || !ready}
        onPress={() => {
          void create
            .fire({
              campaignId,
              name: name.trim(),
              description: "",
              startingValue: value,
              lead: 1,
              party: "pursuing",
            })
            .then((result) => {
              if (result) onClose();
            });
        }}
        variant="primary"
      >
        Create chase
      </Button>
      <AlertLine message={create.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space[2],
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  heading: {
    color: colors.parchment,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 24,
    fontWeight: textType.displayBold.fontWeight,
  },
  empty: {
    color: colors.mutedText,
    fontFamily: textType.serif.fontFamily,
    fontSize: 16,
    fontStyle: textType.serif.fontStyle,
    fontWeight: textType.serif.fontWeight,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[2],
    padding: space[4],
  },
  name: {
    color: colors.parchment,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 18,
    fontWeight: textType.displayBold.fontWeight,
  },
  meta: {
    color: colors.body,
    fontFamily: textType.sans.fontFamily,
    fontSize: 14,
    fontWeight: textType.sans.fontWeight,
  },
  input: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: textType.sans.fontFamily,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: space[3],
  },
});
