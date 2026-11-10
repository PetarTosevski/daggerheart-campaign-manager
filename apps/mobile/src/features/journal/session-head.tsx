import { useMutation } from "convex/react";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { formatSessionDate, isSessionDate, sessionTitle } from "../../../../../src/lib/domain/sessions";
import { headingLine, patchListed } from "../../../../../src/lib/journal/sessions";
import { SESSION_TEXT_MAX } from "../../../../../convex/lib/validators/sessions";
import type { SessionListItem } from "../../../../../convex/sessionRecords";
import { api, type Id } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { colors } from "../../theme/colors";
import { useOptimistic } from "./optimistic";
import { js } from "./styles";
import { ActButton, ErrorLine, StatusChip } from "./ui";

type Editing = { id: string; field: "title" | "date"; text: string };

/**
 * The session heading (website: src/components/journal/session-head): 'Session 6 · Sun 2 Nov · 19:10', the title and
 * the status chip. The GM taps the title or the date to edit it in place (saved when the field is left; optimistic on
 * the cached list) and has 'Session options' with Mark as played / not played and Delete session (asks twice); both are
 * off while the session is live. Players read it only. A bad, deleted or (for a player) planned id shows 'not
 * available' instead of failing.
 */
export function SessionHeading({ session, onDeleted }: { session: SessionListItem | undefined; onDeleted: () => void }) {
  const campaign = useCampaign();
  const campaignId = campaign._id;
  const isGm = campaign.role === "gm";
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setTitle = useOptimistic(api.sessionRecords.setTitle, (store, args) =>
    patchListed(store, args.campaignId, args.sessionId, { title: args.title.trim() || undefined }),
  );
  const setDate = useOptimistic(api.sessionRecords.setDate, (store, args) =>
    patchListed(store, args.campaignId, args.sessionId, { date: args.date || undefined }),
  );

  if (session === undefined) {
    return (
      <Text style={js.muted}>
        {isGm ? "That session isn't in this campaign anymore. Pick another one from the list." : "That session isn't available. Pick one from the list."}
      </Text>
    );
  }
  const s = session;
  const current = editing?.id === s._id ? editing : null;
  const title = sessionTitle(s.title);

  function run(op: Promise<unknown>) {
    op.catch((e: unknown) => setError(errorMessage(e)));
  }

  function begin(field: Editing["field"]) {
    setError(null);
    setEditing({ id: s._id, field, text: field === "title" ? (s.title ?? "") : (s.date ?? "") });
  }

  function save() {
    const draft = current;
    setEditing(null);
    if (draft === null) return;
    const text = draft.text.trim();
    if (draft.field === "title") {
      if (text !== (s.title ?? "")) run(setTitle({ campaignId, sessionId: s._id, title: draft.text }));
      return;
    }
    if (text === (s.date ?? "")) return;
    if (text !== "" && !isSessionDate(text)) {
      setError("Write the date as YYYY-MM-DD.");
      return;
    }
    run(setDate({ campaignId, sessionId: s._id, date: text === "" ? null : text }));
  }

  return (
    <View style={{ gap: 6 }}>
      {isGm && current?.field === "date" ? (
        <TextInput
          accessibilityLabel={`Session ${s.n} date`}
          autoFocus
          keyboardType="numbers-and-punctuation"
          onBlur={save}
          onChangeText={(text) => setEditing({ ...current, text })}
          onSubmitEditing={save}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.subtle}
          style={js.input}
          value={current.text}
        />
      ) : isGm ? (
        <Pressable
          accessibilityHint={`Change the date (${formatSessionDate(s.date)})`}
          accessibilityLabel={headingLine(s)}
          accessibilityRole="button"
          onPress={() => begin("date")}
          style={js.link}
        >
          <Text style={js.label}>{headingLine(s)}</Text>
        </Pressable>
      ) : (
        <Text style={js.label}>{headingLine(s)}</Text>
      )}
      <View style={js.row}>
        {isGm && current?.field === "title" ? (
          <TextInput
            accessibilityLabel={`Session ${s.n} title`}
            autoFocus
            maxLength={SESSION_TEXT_MAX.title}
            onBlur={save}
            onChangeText={(text) => setEditing({ ...current, text })}
            onSubmitEditing={save}
            placeholder="e.g. The Bridge at Dawn"
            placeholderTextColor={colors.subtle}
            style={[js.input, { flex: 1 }]}
            value={current.text}
          />
        ) : isGm ? (
          <Pressable accessibilityHint="Rename the session" accessibilityRole="button" onPress={() => begin("title")} style={{ flexShrink: 1, minHeight: 44, justifyContent: "center" }}>
            <Text accessibilityRole="header" style={js.headTitle}>
              {title}
            </Text>
          </Pressable>
        ) : (
          <Text accessibilityRole="header" style={js.headTitle}>
            {title}
          </Text>
        )}
        <StatusChip showPlayed status={s.status} />
      </View>
      {isGm ? <SessionMenu campaignId={campaignId} onDeleted={onDeleted} onError={setError} session={s} /> : null}
      <ErrorLine error={error} />
    </View>
  );
}

/** 'Session options': Mark as played / not played and Delete session (asks twice). Off while live. */
function SessionMenu({
  campaignId,
  session,
  onDeleted,
  onError,
}: {
  campaignId: Id<"campaigns">;
  session: SessionListItem;
  onDeleted: () => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // The session whose Delete was pressed once; closing the menu or switching sessions cancels it without an effect.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const setPlayed = useOptimistic(api.sessionRecords.setPlayed, (store, args) =>
    patchListed(store, args.campaignId, args.sessionId, { status: args.played ? "played" : "planned" }),
  );
  const remove = useMutation(api.sessionRecords.remove);
  const live = session.status === "live";
  const played = session.status === "played";
  const confirming = confirmId === session._id;

  function close() {
    setOpen(false);
    setConfirmId(null);
  }

  function togglePlayed() {
    onError(null);
    close();
    setPlayed({ campaignId, sessionId: session._id, played: !played }).catch((e: unknown) => onError(errorMessage(e)));
  }

  async function onDelete() {
    if (!confirming) {
      setConfirmId(session._id);
      return;
    }
    onError(null);
    setDeleting(true);
    try {
      await remove({ campaignId, sessionId: session._id });
      close();
      onDeleted();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <View style={{ gap: 6 }}>
      <Pressable
        accessibilityLabel="Session options"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => (open ? close() : setOpen(true))}
        style={js.link}
      >
        <Text style={js.linkText}>{open ? "Close options" : "Session options ⋯"}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 8 }}>
          <ActButton disabled={live} onPress={togglePlayed}>
            {played ? "Mark as not played" : "Mark as played"}
          </ActButton>
          <ActButton disabled={live || deleting} onPress={() => void onDelete()} variant="danger">
            {confirming ? "Tap again to delete" : "Delete session"}
          </ActButton>
          {live ? <Text style={js.muted}>End the session first to mark it or delete it.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
