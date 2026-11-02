import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  READING_DICE,
  REVELATION_EFFECTS,
  REVELATION_KINDS,
  REVELATION_LABELS,
  REVELATION_STATUSES,
  SHOWDOWN_EFFECT,
  SPREAD_ADVICE,
  TEXT_MAX,
  nightSkyEntry,
  placeClashes,
  type RevelationStatus,
} from "../../../../../src/lib/frames/trackers/weredragon";
import { api } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Loading } from "../../ui/loading";
import type { TrackerCampaign } from "./campaign";
import { CheckRow, ErrorText, Field, SavedField, TrackerButton, TrackerCard } from "./card";
import { useIntent } from "./intent";

type WeredragonView = FunctionReturnType<typeof api.trackers.weredragon.get>;
type Revelation = WeredragonView["revelations"][number];
type Secret = WeredragonView["secrets"][number];

const STATUS_LABEL: Record<RevelationStatus, string> = {
  hidden: "Hidden",
  revealed: "Revealed",
  achieved: "Achieved",
};

/** Reign of the Weredragon: the Astromancer's Revelations and Forlorne's secrets (HF pp.140-141). */
export function WeredragonTracker({ campaign }: { campaign: TrackerCampaign }) {
  const view = useQuery(api.trackers.weredragon.get, { campaignId: campaign._id });
  if (view === undefined) return <Loading label="Loading the frame tracker…" />;
  const isGm = view.role === "gm" && campaign.role === "gm";
  return (
    <View style={styles.stack}>
      <TrackerCard
        actions={<RollNightSky campaignId={campaign._id} waiting={!isGm && view.pendingRoll !== null} />}
        subtitle={isGm ? "Each revelation stays hidden from players until you reveal it." : "What the stars have shown you."}
        title="The Astromancer’s Revelations"
      >
        {view.pendingRoll ? (
          isGm ? (
            <ReadingPicker campaignId={campaign._id} roll={view.pendingRoll} />
          ) : (
            <Text style={styles.meta}>
              The stars show <Text testID="night-sky-roll">{view.pendingRoll.join(" · ")}</Text>. The GM places one die in each column.
            </Text>
          )
        ) : null}
        <View accessibilityLabel="Revelations" style={styles.stack}>
          {view.revelations.map((revelation, index) =>
            isGm ? (
              <GmRevelation key={revelation.kind} campaignId={campaign._id} index={index} revelation={revelation} />
            ) : (
              <PlayerRevelation key={revelation.kind} index={index} revelation={revelation} />
            ),
          )}
        </View>
        {view.showdownReady ? (
          <Text testID="showdown-ready" style={styles.ready}>
            Showdown ready. {SHOWDOWN_EFFECT}
          </Text>
        ) : null}
      </TrackerCard>
      <ForlorneSecrets campaignId={campaign._id} isGm={isGm} secrets={view.secrets} />
    </View>
  );
}

/** Any member rolls the 5d6 (HF p.140); a player waits until the GM has placed the last roll. */
function RollNightSky({ campaignId, waiting }: { campaignId: TrackerCampaign["_id"]; waiting: boolean }) {
  const read = useIntent(api.trackers.weredragon.readNightSky);
  return (
    <View>
      <TrackerButton disabled={read.pending || waiting} onPress={() => void read.fire({ campaignId })}>
        Roll the night sky
      </TrackerButton>
      <ErrorText error={read.error} />
    </View>
  );
}

function ReadingPicker({ campaignId, roll }: { campaignId: TrackerCampaign["_id"]; roll: number[] }) {
  const [assignment, setAssignment] = useState<number[]>(() => Array.from({ length: READING_DICE }, (_, index) => index));
  const assign = useIntent(api.trackers.weredragon.assignReading);
  const dice = assignment.map((index) => roll[index] ?? 0);
  const clashes = placeClashes(dice);

  function pick(column: number, dieIndex: number) {
    setAssignment((prev) => {
      const next = [...prev];
      const other = next.indexOf(dieIndex);
      const current = next[column];
      if (current === undefined || other < 0) return prev;
      next[other] = current;
      next[column] = dieIndex;
      return next;
    });
  }

  return (
    <View accessibilityLabel="Night sky reading" style={styles.block}>
      <Text style={styles.meta} testID="night-sky-roll">
        The stars show {roll.join(" · ")}. Place one die in each column. {SPREAD_ADVICE}
      </Text>
      {REVELATION_KINDS.map((kind, column) => (
        <View key={kind} style={styles.stack}>
          <Text style={styles.label}>{REVELATION_LABELS[kind]}</Text>
          <View accessibilityLabel={`Die for ${REVELATION_LABELS[kind]}`} accessibilityRole="radiogroup" style={styles.row}>
            {roll.map((die, index) => (
              <TrackerButton
                key={index}
                accessibilityLabel={`Die ${index + 1}: ${die}`}
                onPress={() => pick(column, index)}
                variant={assignment[column] === index ? "solid" : "outline"}
              >
                {`Die ${index + 1}: ${die}`}
              </TrackerButton>
            ))}
          </View>
          <Text style={styles.body}>{nightSkyEntry(kind, dice[column] ?? 1).text}</Text>
        </View>
      ))}
      {clashes.length ? (
        <View accessibilityLabel="Reading warnings" accessibilityRole="alert">
          {clashes.map((clash) => (
            <Text key={clash.place} style={styles.warn}>
              {clash.kinds.map((kind) => REVELATION_LABELS[kind]).join(" and ")} both send the PCs to {clash.place}.
            </Text>
          ))}
        </View>
      ) : null}
      <TrackerButton disabled={assign.pending} onPress={() => void assign.fire({ campaignId, assignment })}>
        Apply reading
      </TrackerButton>
      <ErrorText error={assign.error} />
    </View>
  );
}

function GmRevelation({
  campaignId,
  index,
  revelation,
}: {
  campaignId: TrackerCampaign["_id"];
  index: number;
  revelation: Revelation;
}) {
  const update = useIntent(api.trackers.weredragon.updateRevelation);
  const label = REVELATION_LABELS[revelation.kind];
  return (
    <View accessibilityLabel={label} style={styles.block}>
      <Text style={styles.label}>
        {index + 1}. {label}
      </Text>
      <View accessibilityLabel={`${label} die`} accessibilityRole="radiogroup" style={styles.row}>
        <TrackerButton
          accessibilityLabel={`${label} no die`}
          onPress={() => void update.fire({ campaignId, kind: revelation.kind, die: null })}
          variant={revelation.die === null ? "solid" : "outline"}
        >
          No die
        </TrackerButton>
        {[1, 2, 3, 4, 5, 6].map((die) => (
          <TrackerButton
            key={die}
            accessibilityLabel={`${label} d6: ${die}`}
            onPress={() => void update.fire({ campaignId, kind: revelation.kind, die })}
            variant={revelation.die === die ? "solid" : "outline"}
          >
            {`d6: ${die}`}
          </TrackerButton>
        ))}
      </View>
      <View accessibilityLabel={`${label} status`} accessibilityRole="radiogroup" style={styles.row}>
        {REVELATION_STATUSES.map((status) => (
          <TrackerButton
            key={status}
            accessibilityLabel={`${label} ${STATUS_LABEL[status]}`}
            onPress={() => void update.fire({ campaignId, kind: revelation.kind, status })}
            variant={revelation.status === status ? "solid" : "outline"}
          >
            {STATUS_LABEL[status]}
          </TrackerButton>
        ))}
      </View>
      <SavedField
        key={revelation.text}
        label={`${label} text`}
        maxLength={TEXT_MAX}
        multiline
        onSave={(text) => void update.fire({ campaignId, kind: revelation.kind, text })}
        value={revelation.text}
      />
      <Text style={styles.meta}>{REVELATION_EFFECTS[revelation.kind]}</Text>
      <ErrorText error={update.error} />
    </View>
  );
}

function PlayerRevelation({ index, revelation }: { index: number; revelation: Revelation }) {
  const label = REVELATION_LABELS[revelation.kind];
  return (
    <View accessibilityLabel={label} style={styles.block}>
      <Text style={styles.label}>
        {index + 1}. {label}
        {revelation.status === "achieved" ? " Achieved" : ""}
      </Text>
      {revelation.status === "hidden" ? (
        <Text style={styles.meta}>Not yet revealed.</Text>
      ) : (
        <>
          <Text style={styles.body}>{revelation.text}</Text>
          <Text style={styles.meta}>{REVELATION_EFFECTS[revelation.kind]}</Text>
        </>
      )}
    </View>
  );
}

function ForlorneSecrets({
  campaignId,
  isGm,
  secrets,
}: {
  campaignId: TrackerCampaign["_id"];
  isGm: boolean;
  secrets: Secret[];
}) {
  const submit = useIntent(api.trackers.weredragon.submitSecret);
  const [draft, setDraft] = useState("");
  return (
    <TrackerCard
      subtitle={
        isGm
          ? "Secrets your players wrote. Pick one between sessions to inspire what they uncover."
          : "Write a secret Forlorne is hiding. Only the GM will read it."
      }
      title="Forlorne’s Secrets"
    >
      <Field
        label="Secret Forlorne is hiding"
        maxLength={TEXT_MAX}
        multiline
        onChangeText={setDraft}
        placeholder="Forlorne is hiding…"
        value={draft}
      />
      <TrackerButton
        disabled={submit.pending || !draft.trim()}
        onPress={() => {
          void submit.fire({ campaignId, text: draft }).then((result) => {
            if (result) setDraft("");
          });
        }}
      >
        Submit secret
      </TrackerButton>
      <ErrorText error={submit.error} />
      {secrets.length ? (
        <View accessibilityLabel={isGm ? "Submitted secrets" : "Your secrets"} style={styles.stack}>
          {secrets.map((secret) => (
            <View key={secret.id} style={styles.block}>
              <Text style={secret.used ? styles.used : styles.body}>
                {secret.text}
                {isGm && secret.authorName ? ` — ${secret.authorName}` : ""}
              </Text>
              {isGm ? <SecretUsed campaignId={campaignId} secret={secret} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </TrackerCard>
  );
}

function SecretUsed({ campaignId, secret }: { campaignId: TrackerCampaign["_id"]; secret: Secret }) {
  const setUsed = useIntent(api.trackers.weredragon.setSecretUsed);
  return (
    <CheckRow
      checked={secret.used}
      label={`Used: ${secret.text}`}
      onPress={() => void setUsed.fire({ campaignId, secretId: secret.id, used: !secret.used })}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  block: {
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  label: { color: colors.parchment, fontFamily: type.displayBold.fontFamily, fontSize: 16 },
  meta: { color: colors.mutedText, fontFamily: type.sans.fontFamily, fontSize: 14 },
  body: { color: colors.parchment, fontFamily: type.serif.fontFamily, fontSize: 16 },
  used: {
    color: colors.mutedText,
    fontFamily: type.serif.fontFamily,
    fontSize: 16,
    textDecorationLine: "line-through",
  },
  ready: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.parchment,
    padding: space[3],
  },
  warn: { color: colors.hope, fontFamily: type.sans.fontFamily, fontSize: 13 },
});
