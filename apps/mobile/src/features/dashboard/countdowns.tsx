import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { listItems } from "../../../../../src/lib/domain/countdowns/items";
import {
  MAX_REST_TICK_FIXED,
  REST_TICK_DICE_SIDES,
  restTickAmountLabel,
  type RestTick,
  type RestTickAmount,
  type RestTickKind,
  type RestTickRest,
} from "../../../../../src/lib/domain/countdowns/rest-ticks";
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
  restControls = true,
}: {
  campaignId: Id<"campaigns">;
  countdown: Countdown;
  isGm: boolean;
  /** False inside a chase: the pair shares one rest setting, shown once on the chase card. */
  restControls?: boolean;
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
      {isGm && restControls ? <RestTickControls campaignId={campaignId} countdown={countdown} /> : null}
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
  // The pair shares its rest settings (setRestTick writes both rows); edit them through a side that isn't cancelled.
  const restRow = party !== undefined && party.status !== "cancelled" ? party : rivals;
  return (
    <View accessibilityLabel="Chase" style={styles.card}>
      <Text style={styles.name}>Chase</Text>
      {party ? <CountdownCard campaignId={campaignId} countdown={party} isGm={isGm} restControls={false} /> : null}
      {rivals ? <CountdownCard campaignId={campaignId} countdown={rivals} isGm={isGm} restControls={false} /> : null}
      {isGm && restRow ? <RestTickControls campaignId={campaignId} countdown={restRow} /> : null}
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
  const writes = useWritesEnabled();
  const [stepText, setStepText] = useState("");
  const error = operate.error ?? arm.error ?? visibility.error ?? setStep.error;
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
      {/* Armed = ticks on PC action rolls; long-term countdowns never do (Q3), their rest setting is below. */}
      {countdown.armed !== null && countdown.mode !== "longTerm" ? (
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
      <AlertLine message={error} />
    </View>
  );
}

const REST_LABEL: Record<RestTickRest, string> = { long: "On long rest", short: "On short rest" };
const KIND_LABEL: Record<RestTickKind, string> = { fixed: "Fixed", pcs: "PCs who rested", die: "Die", diePlusPcs: "Die + PCs" };
const KINDS = Object.keys(KIND_LABEL) as RestTickKind[];
const DEFAULT_SIDES = 6;

/** The amount a kind gets when the GM picks it, keeping the current N or die size where it has one. */
function amountFor(kind: RestTickKind, current: RestTickAmount | undefined): RestTickAmount {
  const sides = current !== undefined && "sides" in current ? current.sides : DEFAULT_SIDES;
  switch (kind) {
    case "fixed":
      return { kind, n: current?.kind === "fixed" ? current.n : 1 };
    case "pcs":
      return { kind };
    case "die":
    case "diePlusPcs":
      return { kind, sides };
  }
}

/**
 * "On long rest" and "On short rest" (rest-ticks RT3): Off or an amount kind (Fixed N, PCs who rested, a die, a die +
 * PCs) and Automatic / Reminder, for every countdown type. Every tap is one `countdowns.setRestTick` intent (one rest
 * kind, the whole setting or null); a chase card shows it once and the server writes both rows.
 */
function RestTickControls({ campaignId, countdown }: { campaignId: Id<"campaigns">; countdown: Countdown }) {
  if (countdown.status === "cancelled") return null;
  return (
    <View style={styles.block}>
      <RestTickControl campaignId={campaignId} countdownId={countdown._id} rest="long" setting={countdown.onLongRest} />
      <RestTickControl campaignId={campaignId} countdownId={countdown._id} rest="short" setting={countdown.onShortRest} />
    </View>
  );
}

function RestTickControl({
  campaignId,
  countdownId,
  rest,
  setting,
}: {
  campaignId: Id<"campaigns">;
  countdownId: Id<"countdowns">;
  rest: RestTickRest;
  setting: RestTick | null;
}) {
  const save = useIntent(api.countdowns.setRestTick);
  const writes = useWritesEnabled();
  const label = REST_LABEL[rest];
  const amount = setting?.amount;

  function send(next: RestTick | null) {
    void save.fire({ campaignId, countdownId, rest, setting: next });
  }

  return (
    <View accessibilityLabel={label} style={styles.block}>
      <Text style={styles.meta}>
        {setting === null
          ? `${label}: Off`
          : `${label}: ${restTickAmountLabel(setting.amount)}, ${setting.mode === "auto" ? "Automatic" : "Reminder"}`}
      </Text>
      <View style={styles.row}>
        <Button
          accessibilityLabel={`${label}: Off`}
          disabled={!writes}
          onPress={() => send(null)}
          variant={setting === null ? "primary" : "outline"}
        >
          Off
        </Button>
        {KINDS.map((kind) => (
          <Button
            accessibilityLabel={`${label}: ${KIND_LABEL[kind]}`}
            disabled={!writes}
            key={kind}
            onPress={() => send({ amount: amountFor(kind, amount), mode: setting?.mode ?? "auto" })}
            variant={amount?.kind === kind ? "primary" : "outline"}
          >
            {KIND_LABEL[kind]}
          </Button>
        ))}
      </View>
      {setting !== null && amount?.kind === "fixed" ? (
        <View style={styles.row}>
          <Button
            accessibilityLabel={`${label}: fewer`}
            disabled={!writes || amount.n <= 1}
            onPress={() => send({ ...setting, amount: { kind: "fixed", n: amount.n - 1 } })}
            variant="outline"
          >
            −
          </Button>
          <Text style={styles.meta}>{`${amount.n}`}</Text>
          <Button
            accessibilityLabel={`${label}: more`}
            disabled={!writes || amount.n >= MAX_REST_TICK_FIXED}
            onPress={() => send({ ...setting, amount: { kind: "fixed", n: amount.n + 1 } })}
            variant="outline"
          >
            +
          </Button>
        </View>
      ) : null}
      {setting !== null && (amount?.kind === "die" || amount?.kind === "diePlusPcs") ? (
        <View style={styles.row}>
          {REST_TICK_DICE_SIDES.map((sides) => (
            <Button
              accessibilityLabel={`${label}: d${sides}`}
              disabled={!writes}
              key={sides}
              onPress={() => send({ ...setting, amount: { kind: amount.kind, sides } })}
              variant={amount.sides === sides ? "primary" : "outline"}
            >
              {`d${sides}`}
            </Button>
          ))}
        </View>
      ) : null}
      {setting !== null ? (
        <View style={styles.row}>
          <Button
            accessibilityLabel={`${label}: Automatic`}
            disabled={!writes}
            onPress={() => send({ ...setting, mode: "auto" })}
            variant={setting.mode === "auto" ? "primary" : "outline"}
          >
            Automatic
          </Button>
          <Button
            accessibilityLabel={`${label}: Reminder`}
            disabled={!writes}
            onPress={() => send({ ...setting, mode: "remind" })}
            variant={setting.mode === "remind" ? "primary" : "outline"}
          >
            Reminder
          </Button>
        </View>
      ) : null}
      <AlertLine message={save.error} />
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
