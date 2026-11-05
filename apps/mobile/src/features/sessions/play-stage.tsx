import { useMutation, useQuery } from "convex/react";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { TALLY_ROWS } from "../../../../../src/lib/domain/sessions";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import { SESSION_TEXT_MAX } from "../../../../../convex/lib/validators/sessions";
import { api } from "../../convex";
import type { Id } from "../../convex";
import { WriteButton } from "../../shell/offline";
import { Loading } from "../../ui/loading";
import type { SessionSlotProps } from "./slots";
import { sessionStyles as styles } from "./styles";

function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function PlayStage({ campaignId, sessionId }: Pick<SessionSlotProps, "campaignId" | "sessionId">) {
  return (
    <View accessibilityLabel="Play stage" style={{ gap: styles.stack.gap }}>
      <SpotlightCard campaignId={campaignId} sessionId={sessionId} />
      <TallyCard campaignId={campaignId} sessionId={sessionId} />
      <EncounterCard campaignId={campaignId} sessionId={sessionId} />
      <LogCard campaignId={campaignId} sessionId={sessionId} />
    </View>
  );
}

function SpotlightCard({ campaignId, sessionId }: { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> }) {
  const args = { campaignId, sessionId };
  const entries = useQuery(api.sessionPlay.spotlight, args);
  const bump = useMutation(api.sessionPlay.bumpSpotlight);
  const reset = useMutation(api.sessionPlay.resetSpotlight);
  const [error, setError] = useState<string | null>(null);

  if (entries === undefined) return <Loading label="Loading spotlight" />;

  function run(op: Promise<unknown>) {
    setError(null);
    void op.catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        Spotlight
      </Text>
      <Text style={styles.muted}>Tap a character each time they get a moment. Daggerheart has no initiative, so this helps you share the spotlight.</Text>
      {entries.length === 0 ? <Text style={styles.muted}>No characters in the party yet.</Text> : null}
      {entries.map((entry) => (
        <Pressable
          key={entry.characterId}
          accessibilityLabel={`${entry.name}, ${entry.count} spotlight ${entry.count === 1 ? "moment" : "moments"}${entry.due ? ", due" : ""}`}
          accessibilityRole="button"
          onPress={() =>
            run(bump({ campaignId, sessionId, characterId: entry.characterId, idempotencyKey: Crypto.randomUUID() }))
          }
          style={[styles.spotButton, entry.due ? styles.spotDue : null]}
        >
          <Text style={styles.body}>{entry.name}</Text>
          <Text style={styles.spotCount}>{entry.count}</Text>
        </Pressable>
      ))}
      <WriteButton accessibilityLabel="Reset spotlight" onPress={() => run(reset({ campaignId, sessionId }))} variant="outline">
        Reset spotlight
      </WriteButton>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function TallyCard({ campaignId, sessionId }: { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> }) {
  const view = useQuery(api.sessionPlay.tally, { campaignId, sessionId });
  if (view === undefined) return <Loading label="Loading session tally" />;
  const { tally, live, truncated } = view;
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        Session tally
      </Text>
      {TALLY_ROWS.map((row) => (
        <View key={row.key} style={styles.row}>
          <Text style={styles.body}>{row.label}</Text>
          <Text style={styles.spotCount}>{tally === null ? "—" : tally[row.key]}</Text>
        </View>
      ))}
      <Text style={styles.muted}>
        {tally === null
          ? "Counts itself once the session starts: Fear gained and spent on the dashboard, and finished rests."
          : live
            ? "Counting while the session runs: Fear gained and spent on the dashboard, and finished rests."
            : "Counted from the Fear history and the finished rests while the session ran."}
        {truncated ? " Very busy session: these are at least the counts shown." : ""}
      </Text>
    </View>
  );
}

function EncounterCard({ campaignId, sessionId }: { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> }) {
  const router = useRouter();
  const prep = useQuery(api.sessionPrep.get, { campaignId, sessionId });
  const start = useMutation(api.encounters.start);
  const [error, setError] = useState<string | null>(null);

  if (prep === undefined) return <Loading label="Loading encounter" />;
  const encounter = prep.encounter;
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        Encounter
      </Text>
      {encounter === null ? (
        <Text style={styles.muted}>No encounter is linked to this session. Build or link one in Prep.</Text>
      ) : (
        <>
          <Text style={styles.body}>{encounter.name}</Text>
          <Text style={styles.muted}>{encounter.status}</Text>
          {encounter.status === "draft" ? (
            <WriteButton
              accessibilityLabel="Start encounter"
              onPress={() => {
                setError(null);
                void start({ campaignId, encounterId: encounter._id }).catch((caught) => setError(errorMessage(caught)));
              }}
              variant="primary"
            >
              Start encounter
            </WriteButton>
          ) : (
            <WriteButton accessibilityLabel="Open adversaries" onPress={() => router.push(`/campaign/${campaignId}/adversaries`)} variant="outline">
              Open in Adversaries
            </WriteButton>
          )}
        </>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function LogCard({ campaignId, sessionId }: { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> }) {
  const args = { campaignId, sessionId };
  const entries = useQuery(api.sessionPlay.log, args);
  const add = useMutation(api.sessionPlay.addLog);
  const remove = useMutation(api.sessionPlay.removeLog);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (entries === undefined) return <Loading label="Loading session log" />;

  function submit() {
    const line = text.trim();
    if (line === "") return;
    setText("");
    setError(null);
    void add({ campaignId, sessionId, text: line, idempotencyKey: Crypto.randomUUID() }).catch((caught) => {
      setError(errorMessage(caught));
      setText(line);
    });
  }

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        Session log
      </Text>
      <TextInput
        accessibilityLabel="New log entry"
        maxLength={SESSION_TEXT_MAX.log}
        onChangeText={setText}
        placeholder="What just happened?"
        placeholderTextColor={styles.muted.color}
        style={styles.input}
        value={text}
      />
      <WriteButton accessibilityLabel="Add log entry" onPress={submit} variant="outline">
        Add
      </WriteButton>
      {entries.length === 0 ? (
        <Text style={styles.muted}>Quick notes as you play: who did what, names you invented, things to follow up.</Text>
      ) : null}
      {entries.map((line) => (
        <View key={line._id} style={styles.logRow}>
          <Text style={styles.logTime}>{clock(line.at)}</Text>
          <Text style={styles.body}>{line.text}</Text>
          {line.auto ? null : (
            <WriteButton
              accessibilityLabel={`Remove log entry: ${line.text}`}
              onPress={() => {
                setError(null);
                void remove({ campaignId, sessionId, logId: line._id }).catch((caught) => setError(errorMessage(caught)));
              }}
              variant="outline"
            >
              Remove
            </WriteButton>
          )}
        </View>
      ))}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
