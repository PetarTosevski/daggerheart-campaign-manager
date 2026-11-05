import { useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { sessionLogTitle } from "../../../../../src/lib/domain/notes";
import { formatSessionDate } from "../../../../../src/lib/domain/sessions/status";
import { api, type Id } from "../../convex";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";
import { notesStyles } from "./styles";

const NONE = "none";

export function SessionPicker({
  campaignId,
  open,
  title,
  confirmLabel,
  current,
  onClose,
  onPick,
}: {
  campaignId: Id<"campaigns">;
  open: boolean;
  title: string;
  confirmLabel: string;
  current?: Id<"sessions"> | null;
  onClose: () => void;
  onPick: (sessionId: Id<"sessions"> | null) => Promise<void>;
}) {
  return (
    <Sheet onClose={onClose} open={open} title={title}>
      {open ? (
        <PickerBody
          campaignId={campaignId}
          confirmLabel={confirmLabel}
          current={current}
          onClose={onClose}
          onPick={onPick}
        />
      ) : null}
    </Sheet>
  );
}

function PickerBody({
  campaignId,
  confirmLabel,
  current,
  onPick,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  confirmLabel: string;
  current?: Id<"sessions"> | null;
  onClose: () => void;
  onPick: (sessionId: Id<"sessions"> | null) => Promise<void>;
}) {
  const sessions = useQuery(api.sessionRecords.list, { campaignId });
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sessions === undefined) {
    return (
      <Text accessibilityRole="text" style={notesStyles.muted}>
        Loading sessions…
      </Text>
    );
  }

  const preselected =
    current !== undefined
      ? (current ?? NONE)
      : ((sessions.find((s) => s.status === "live") ?? sessions[0])?._id ?? NONE);
  const picked = choice ?? (current && !sessions.some((s) => s._id === current) ? NONE : preselected);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onPick(picked === NONE ? null : (picked as Id<"sessions">));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <ScrollView style={{ maxHeight: 320 }}>
        <Pressable accessibilityRole="radio" onPress={() => setChoice(NONE)}>
          <Text style={notesStyles.line}>{picked === NONE ? "● " : "○ "}No session</Text>
        </Pressable>
        {sessions.map((session) => {
          const id = session._id;
          return (
            <Pressable accessibilityRole="radio" key={id} onPress={() => setChoice(id)}>
              <Text style={notesStyles.line}>
                {picked === id ? "● " : "○ "}
                {sessionLogTitle(session)}
              </Text>
              <Text style={notesStyles.muted}>
                {formatSessionDate(session.date)}
                {session.status === "live" ? " · Live" : session.status === "planned" ? " · Planned" : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {error ? (
        <Text accessibilityRole="alert" style={notesStyles.error}>
          {error}
        </Text>
      ) : null}
      <Button disabled={busy} onPress={() => void confirm()} variant="solid">
        {busy ? "Saving…" : confirmLabel}
      </Button>
    </View>
  );
}
