import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { StyleSheet, Text, View } from "react-native";

import { restTickRestFor } from "../../../../../src/lib/domain/countdowns/rest-ticks";
import { MAX_SHORT_RESTS, MOVE_LABELS, mustLongRest } from "../../../../../src/lib/domain/rest/moves";
import { api, type Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type as textType } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { AlertLine, Panel, QueryLoading } from "./chrome";
import { useIntent } from "./intent";
import type { PartyMember } from "./party";

type RestState = FunctionReturnType<typeof api.restsReads.current>;
type Reminder = NonNullable<FunctionReturnType<typeof api.countdownTracks.afterRest>>["reminders"][number];
const KIND_LABEL = { short: "Short rest", long: "Long rest" } as const;

export function RestLauncher({
  campaignId,
  isGm,
  party,
}: {
  campaignId: Id<"campaigns">;
  isGm: boolean;
  party: PartyMember[] | undefined;
}) {
  const state = useQuery(api.restsReads.current, { campaignId });
  if (!isGm && state !== undefined && state.open === null) return null;
  return (
    <Panel title="Rest">
      <QueryLoading label="Loading rests" value={state === undefined || party === undefined ? undefined : state} />
      {state && party ? <RestBody campaignId={campaignId} isGm={isGm} party={party} state={state} /> : null}
    </Panel>
  );
}

function RestBody({
  campaignId,
  isGm,
  party,
  state,
}: {
  campaignId: Id<"campaigns">;
  isGm: boolean;
  party: PartyMember[];
  state: RestState;
}) {
  const { open, shortRestsSinceLong, last } = state;
  return (
    <View style={styles.block}>
      <Text style={styles.count}>{`${shortRestsSinceLong} of ${MAX_SHORT_RESTS} short rests`}</Text>
      {open === null ? (
        isGm ? (
          <GmIdle campaignId={campaignId} last={last} shortRestsSinceLong={shortRestsSinceLong} />
        ) : null
      ) : (
        <OpenRest campaignId={campaignId} isGm={isGm} open={open} party={party} />
      )}
    </View>
  );
}

function GmIdle({
  campaignId,
  last,
  shortRestsSinceLong,
}: {
  campaignId: Id<"campaigns">;
  last: RestState["last"];
  shortRestsSinceLong: number;
}) {
  const start = useIntent(api.rests.start);
  const undo = useIntent(api.rests.undo);
  const writes = useWritesEnabled();
  const blocked = mustLongRest("short", shortRestsSinceLong);
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <Button
          accessibilityLabel="Start short rest"
          disabled={!writes || blocked}
          onPress={() => void start.fire({ campaignId, kind: "short" })}
          variant="outline"
        >
          Start short rest
        </Button>
        <Button
          accessibilityLabel="Start long rest"
          disabled={!writes}
          onPress={() => void start.fire({ campaignId, kind: "long" })}
          variant="outline"
        >
          Start long rest
        </Button>
      </View>
      {blocked ? (
        <Text style={styles.body}>Three short rests taken: the next rest must be a long rest (CB 105).</Text>
      ) : null}
      {last ? (
        <View style={styles.block}>
          <Text style={styles.body}>
            {`Last: ${KIND_LABEL[last.kind]}${last.status === "interrupted" ? " (interrupted)" : ""}${last.fearGained !== null ? ` · GM gained ${last.fearGained} Fear` : ""}`}
          </Text>
          {last.undoable ? (
            <Button
              accessibilityLabel="Undo rest"
              disabled={!writes}
              onPress={() => void undo.fire({ campaignId, restId: last._id })}
              variant="danger"
            >
              Undo rest
            </Button>
          ) : null}
        </View>
      ) : null}
      {last && restTickRestFor(last) !== null ? <CountdownsAfterRest campaignId={campaignId} /> : null}
      <AlertLine message={start.error ?? undo.error} />
    </View>
  );
}

function OpenRest({
  campaignId,
  isGm,
  open,
  party,
}: {
  campaignId: Id<"campaigns">;
  isGm: boolean;
  open: NonNullable<RestState["open"]>;
  party: PartyMember[];
}) {
  const resting = party.filter((character) => character.status === "active");
  return (
    <View style={styles.block}>
      <Text accessibilityLabel="Open rest" style={styles.body}>
        {`${KIND_LABEL[open.kind]} under way${open.gmOverride ? " (GM override)" : ""}. Each player picks two moves on their sheet.`}
      </Text>
      <View accessibilityLabel="Downtime choices" style={styles.block}>
        {resting.map((character) => {
          const choice = open.choices.find((item) => item.characterId === character._id);
          const line = character.sheet.conditions?.includes("unconscious")
            ? "unconscious"
            : choice
              ? choice.moves.map((move) => MOVE_LABELS[move.move]).join(", ")
              : "choosing…";
          return (
            <Text key={character._id} style={styles.body}>
              {`${character.sheet.name}: ${line}`}
            </Text>
          );
        })}
      </View>
      {isGm ? <GmOpen campaignId={campaignId} restId={open._id} /> : null}
    </View>
  );
}

function GmOpen({ campaignId, restId }: { campaignId: Id<"campaigns">; restId: Id<"rests"> }) {
  const finish = useIntent(api.rests.finish);
  const interrupt = useIntent(api.rests.interrupt);
  const writes = useWritesEnabled();
  return (
    <View style={styles.row}>
      <Button
        accessibilityLabel="Finish rest"
        disabled={!writes}
        onPress={() => void finish.fire({ campaignId, restId })}
        variant="primary"
      >
        Finish rest
      </Button>
      <Button
        accessibilityLabel="Interrupt"
        disabled={!writes}
        onPress={() => void interrupt.fire({ campaignId, restId })}
        variant="danger"
      >
        Interrupt
      </Button>
      <AlertLine message={finish.error ?? interrupt.error} />
    </View>
  );
}

/**
 * What the latest ended rest did to the countdowns (rest-ticks RT3): the Automatic ticks' lines and a "Tick <name>?
 * <amount> (<roll>)" Reminder per countdown, any type, for a long rest or a short one (an interrupted long rest fires
 * the short-rest setting). `afterRest` is null when nothing ticked or reminds.
 */
function CountdownsAfterRest({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const state = useQuery(api.countdownTracks.afterRest, { campaignId });
  const title = state?.kind === "short" ? "Countdowns after the short rest" : "Countdowns after the long rest";
  return (
    <View style={styles.block}>
      <QueryLoading label="Loading countdowns" value={state} />
      {state && (state.lines.length > 0 || state.reminders.length > 0) ? (
        <View accessibilityLabel={title} style={styles.block}>
          <Text style={styles.count}>{title}</Text>
          {state.lines.map((line) => (
            <Text key={line.countdownId} style={styles.body}>
              {line.line}
            </Text>
          ))}
          {state.reminders.map((reminder) => (
            <TickReminder campaignId={campaignId} key={reminder.countdownId} reminder={reminder} restId={state.restId} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TickReminder({
  campaignId,
  reminder,
  restId,
}: {
  campaignId: Id<"campaigns">;
  reminder: Reminder;
  restId: Id<"rests">;
}) {
  const tick = useIntent(api.countdownTracks.tickOnRest);
  const writes = useWritesEnabled();
  const roll = reminder.rollText === null ? "" : ` (${reminder.rollText})`;
  return (
    <View style={styles.row}>
      <Text style={styles.body}>{`Tick ${reminder.name}? ${reminder.amount}${roll}`}</Text>
      <Button
        accessibilityLabel={`Tick ${reminder.name}`}
        disabled={!writes}
        onPress={() => void tick.fire({ campaignId, restId, countdownId: reminder.countdownId })}
        variant="outline"
      >
        {`Tick −${reminder.amount}`}
      </Button>
      <AlertLine message={tick.error} />
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
  count: {
    color: colors.subtle,
    fontFamily: textType.sans.fontFamily,
    fontSize: 13,
    fontWeight: textType.sans.fontWeight,
  },
  body: {
    color: colors.body,
    fontFamily: textType.sans.fontFamily,
    fontSize: 15,
    fontWeight: textType.sans.fontWeight,
  },
});
