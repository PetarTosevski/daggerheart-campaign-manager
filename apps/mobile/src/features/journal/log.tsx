import { useQuery } from "convex/react";
import { randomUUID } from "expo-crypto";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { addPending, clock, hiddenPending, isPending, LOG_LABELS, removePending, textPending } from "../../../../../src/lib/journal/log";
import type { JournalLogLine } from "../../../../../convex/journalLog";
import { SESSION_TEXT_MAX } from "../../../../../convex/lib/validators/sessions";
import { api, type Id } from "../../convex";
import { colors } from "../../theme/colors";
import { useOptimistic } from "./optimistic";
import { js } from "./styles";
import { ActButton, Card, ErrorLine, LoadingLine } from "./ui";

type Ids = { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> };

/**
 * The session log (website: src/components/journal/log): `journalLog.list` oldest first, time, kind, title and sub
 * line. GM: × on a GM line deletes it (`sessionPlay.removeLog`), on any other line hides it (`journalLog.hide`);
 * 'Show N hidden' lists the hidden lines dimmed, each with Unhide; tapping a title re-words it (`journalLog.setText`;
 * leaving the field saves, an empty text on a generated line restores its own words); 'Add a log entry…' + Add
 * (`sessionPlay.addLog`, keyed). Every write is optimistic. Players: the same log read only, without hidden lines (the
 * server leaves them out).
 */
export function SessionLog({ ids, isGm }: { ids: Ids; isGm: boolean }) {
  const log = useQuery(api.journalLog.list, ids);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useOptimistic(api.sessionPlay.addLog, addPending);
  const remove = useOptimistic(api.sessionPlay.removeLog, removePending);
  const hide = useOptimistic(api.journalLog.hide, hiddenPending(true));
  const unhide = useOptimistic(api.journalLog.unhide, hiddenPending(false));
  const reword = useOptimistic(api.journalLog.setText, textPending);
  const caption = isGm ? "Written by the Combat Map as you play · edit anything" : "Written by the Combat Map as you play";

  if (log === undefined) {
    return (
      <Card heading="Session log">
        <LoadingLine>Loading the session log…</LoadingLine>
      </Card>
    );
  }

  const hiddenCount = log.lines.filter((l) => l.hidden).length;
  const lines = log.lines.filter((l) => !l.hidden || showHidden);

  function run(op: Promise<unknown>) {
    setError(null);
    op.catch((e: unknown) => setError(errorMessage(e)));
  }

  function onX(line: JournalLogLine) {
    if (line.source === "gm") run(remove({ ...ids, logId: line.sourceId }));
    else run(hide({ ...ids, source: line.source, sourceId: line.sourceId }));
  }

  function onUnhide(line: JournalLogLine) {
    if (line.source !== "gm") run(unhide({ ...ids, source: line.source, sourceId: line.sourceId }));
  }

  function onReword(line: JournalLogLine, text: string) {
    const next = text.trim();
    if (next === line.title) return;
    // A GM line can't be emptied (delete it with ×); an empty text on a generated line restores its own words.
    if (next === "" && line.source === "gm") return;
    run(reword({ ...ids, source: line.source, sourceId: line.sourceId, text: next }));
  }

  async function onAdd(text: string): Promise<boolean> {
    setError(null);
    try {
      await add({ ...ids, text, idempotencyKey: randomUUID() });
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  return (
    <Card heading="Session log">
      <Text style={js.muted}>{caption}</Text>
      {lines.length === 0 ? (
        <Text style={js.muted}>
          {log.lines.length === 0 ? "Nothing logged yet. Rolls, Fear, combat and scenes from the Combat Map show here as you play." : "Every line is hidden."}
        </Text>
      ) : (
        <View accessibilityLabel="Session log lines, oldest first" style={{ gap: 4 }}>
          {lines.map((line) => (
            <LogRow key={line.key} isGm={isGm} line={line} onReword={onReword} onUnhide={onUnhide} onX={onX} />
          ))}
        </View>
      )}
      {log.truncated ? <Text style={js.muted}>The log is too long to show whole: the earliest lines are here, later ones are not.</Text> : null}
      {isGm && hiddenCount > 0 ? (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: showHidden }} onPress={() => setShowHidden((v) => !v)} style={js.link}>
          <Text style={js.linkText}>{showHidden ? `Hide ${hiddenCount} hidden` : `Show ${hiddenCount} hidden`}</Text>
        </Pressable>
      ) : null}
      <ErrorLine error={error} />
      {isGm ? <AddLine onAdd={onAdd} /> : null}
    </Card>
  );
}

function LogRow({
  line,
  isGm,
  onX,
  onUnhide,
  onReword,
}: {
  line: JournalLogLine;
  isGm: boolean;
  onX: (line: JournalLogLine) => void;
  onUnhide: (line: JournalLogLine) => void;
  onReword: (line: JournalLogLine, text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = isPending(line);
  const tags = [line.sub, line.edited ? "edited" : null, line.hidden ? "hidden" : null].filter(Boolean).join(" · ");

  function save() {
    if (draft === null) return;
    setDraft(null);
    onReword(line, draft);
  }

  return (
    <View style={[js.logRow, line.hidden ? js.dimmed : null]}>
      <Text style={js.logTime}>{clock(line.at)}</Text>
      <View style={js.logBody}>
        <Text style={js.logKind}>{LOG_LABELS[line.icon]}</Text>
        {draft !== null ? (
          <TextInput
            accessibilityLabel="Re-word the line"
            autoFocus
            maxLength={SESSION_TEXT_MAX.log}
            onBlur={save}
            onChangeText={setDraft}
            onSubmitEditing={save}
            placeholder={line.source === "gm" ? undefined : "Empty restores the line's own words"}
            placeholderTextColor={colors.subtle}
            style={js.input}
            value={draft}
          />
        ) : isGm && !pending ? (
          <Pressable accessibilityHint="Re-word the line" accessibilityRole="button" onPress={() => setDraft(line.title)}>
            <Text style={js.logTitle}>{line.title}</Text>
          </Pressable>
        ) : (
          <Text style={js.logTitle}>{line.title}</Text>
        )}
        {tags !== "" ? <Text style={js.logSub}>{tags}</Text> : null}
      </View>
      {isGm ? (
        line.hidden ? (
          <Pressable accessibilityLabel={`Unhide log line: ${line.title}`} accessibilityRole="button" onPress={() => onUnhide(line)} style={js.link}>
            <Text style={js.linkText}>Unhide</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityLabel={line.source === "gm" ? `Delete log line: ${line.title}` : `Hide log line: ${line.title}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: pending }}
            disabled={pending}
            onPress={() => onX(line)}
            style={[js.link, { alignItems: "center" }]}
          >
            <Text style={[js.linkText, { color: line.source === "gm" ? colors.danger : colors.label }]}>×</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

function AddLine({ onAdd }: { onAdd: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");

  function submit() {
    const line = text.trim();
    if (line === "") return;
    setText("");
    void onAdd(line).then((ok) => {
      if (!ok) setText((now) => (now === "" ? line : now));
    });
  }

  return (
    <View style={js.row}>
      <TextInput
        accessibilityLabel="New log entry"
        maxLength={SESSION_TEXT_MAX.log}
        onChangeText={setText}
        onSubmitEditing={submit}
        placeholder="Add a log entry…"
        placeholderTextColor={colors.subtle}
        returnKeyType="done"
        style={[js.input, { flex: 1 }]}
        value={text}
      />
      <ActButton accessibilityLabel="Add log entry" onPress={submit}>
        + Add
      </ActButton>
    </View>
  );
}
