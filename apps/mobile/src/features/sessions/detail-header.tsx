import { useMutation } from "convex/react";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { formatSessionDate, sessionTitle, statusLabel } from "../../../../../src/lib/domain/sessions";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import { api } from "../../convex";
import type { Id } from "../../convex";
import type { SessionListItem } from "../../../../../convex/sessionRecords";
import { SESSION_TEXT_MAX } from "../../../../../convex/lib/validators/sessions";
import { WriteButton } from "../../shell/offline";
import { sessionStyles as styles } from "./styles";

function Unavailable({ isGm }: { isGm: boolean }) {
  return (
    <View accessibilityLabel="Session" style={styles.card}>
      <Text style={styles.muted}>
        {isGm
          ? "That session is not in this campaign anymore. Pick another one from the list."
          : "That session is not available. Pick one from the list."}
      </Text>
    </View>
  );
}

export function SessionHeaderCard({
  campaignId,
  sessionId,
  sessions,
  onDeleted,
}: {
  campaignId: Id<"campaigns">;
  sessionId: Id<"sessions">;
  sessions: SessionListItem[] | undefined;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const setTitle = useMutation(api.sessionRecords.setTitle);
  const setDate = useMutation(api.sessionRecords.setDate);
  const setPlayed = useMutation(api.sessionRecords.setPlayed);
  const remove = useMutation(api.sessionRecords.remove);

  if (sessions === undefined) {
    return (
      <View accessibilityLabel="Session" style={styles.card}>
        <Text accessibilityRole="status" style={styles.muted}>
          Loading…
        </Text>
      </View>
    );
  }
  const session = sessions.find((s) => s._id === sessionId);
  if (!session) return <Unavailable isGm />;

  function run(op: Promise<unknown>) {
    setError(null);
    void op.catch((e: unknown) => setError(errorMessage(e)));
  }

  function saveTitle() {
    if (draft === null || draft.id !== session!._id) return;
    const text = draft.text;
    setDraft(null);
    if (text.trim() !== (session!.title ?? "")) {
      run(setTitle({ campaignId, sessionId: session!._id, title: text }));
    }
  }

  async function onDelete() {
    if (confirmId !== session!._id) {
      setConfirmId(session!._id);
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await remove({ campaignId, sessionId: session!._id });
      setConfirmId(null);
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  }

  const live = session.status === "live";
  const played = session.status === "played";
  const confirming = confirmId === session._id;

  return (
    <View accessibilityLabel="Session" style={styles.card}>
      <Text style={styles.label}>{`Session ${session.n} title`}</Text>
      <TextInput
        accessibilityLabel={`Session ${session.n} title`}
        maxLength={SESSION_TEXT_MAX.title}
        onBlur={saveTitle}
        onChangeText={(text) => setDraft({ id: session._id, text })}
        placeholder="e.g. The Bridge at Dawn"
        placeholderTextColor={styles.muted.color}
        style={[styles.input, styles.inputTitle]}
        value={draft?.id === session._id ? draft.text : (session.title ?? "")}
      />
      <Text style={styles.label}>Date</Text>
      <TextInput
        accessibilityLabel="Session date"
        onChangeText={(text) =>
          run(setDate({ campaignId, sessionId: session._id, date: text.trim() === "" ? null : text.trim() }))
        }
        placeholder="YYYY-MM-DD"
        placeholderTextColor={styles.muted.color}
        style={styles.input}
        value={session.date ?? ""}
      />
      {!live ? (
        <WriteButton
          accessibilityLabel={played ? "Mark as not played" : "Mark as played"}
          onPress={() => run(setPlayed({ campaignId, sessionId: session._id, played: !played }))}
          variant="outline"
        >
          {played ? "Mark as not played" : "Mark as played"}
        </WriteButton>
      ) : null}
      {!live && !deleting ? (
        <WriteButton
          accessibilityLabel={confirming ? "Click again to delete" : "Delete session"}
          onPress={() => void onDelete()}
          variant="outline"
        >
          {confirming ? "Click again to delete" : "Delete"}
        </WriteButton>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function PlayerSessionView({
  sessionId,
  sessions,
}: {
  sessionId: Id<"sessions">;
  sessions: SessionListItem[] | undefined;
}) {
  if (sessions === undefined) {
    return (
      <View accessibilityLabel="Session" style={styles.card}>
        <Text accessibilityRole="status" style={styles.muted}>
          Loading…
        </Text>
      </View>
    );
  }
  const session = sessions.find((s) => s._id === sessionId);
  if (!session) return <Unavailable isGm={false} />;
  return <PlayerSessionBody session={session} />;
}

function PlayerSessionBody({ session }: { session: SessionListItem }) {
  return (
    <View accessibilityLabel="Session" style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.sessionN}>{`SESSION ${session.n}`}</Text>
        <View style={[styles.chip, session.status === "live" ? styles.chipLive : session.status === "played" ? styles.chipPlayed : null]}>
          <Text style={styles.chipText}>{statusLabel(session.status)}</Text>
        </View>
      </View>
      <Text accessibilityRole="header" style={styles.heading}>
        {sessionTitle(session.title)}
      </Text>
      <Text style={styles.muted}>{formatSessionDate(session.date)}</Text>
      <Text style={styles.label}>Recap</Text>
      {session.recap ? (
        <Text style={styles.body}>{session.recap}</Text>
      ) : (
        <Text style={styles.muted}>
          {session.status === "live" ? "This session is being played right now." : "No recap was written for this session."}
        </Text>
      )}
    </View>
  );
}
