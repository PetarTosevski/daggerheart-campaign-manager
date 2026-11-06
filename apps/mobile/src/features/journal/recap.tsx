import { useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { SESSION_TEXT_MAX } from "../../../../../convex/lib/validators/sessions";
import type { SessionListItem } from "../../../../../convex/sessionRecords";
import { api, type Id } from "../../convex";
import { colors } from "../../theme/colors";
import { levelUps } from "./model";
import { patchLoot, patchRecap, useOptimistic } from "./optimistic";
import { journalColors, js } from "./styles";
import { ActButton, Card, ErrorLine, LoadingLine } from "./ui";

type Ids = { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> };

/** The text the server stores for a write: trimmed, empty clears it. */
const stored = (text: string) => text.trim() || null;

/**
 * The recap (website: src/components/journal/recap; Q4: everyone writes it, always visible to the table). The GM
 * reads it from `sessionWrap.get`, a player from their `sessionRecords.list` row. 'Edit recap' opens a field; Save
 * (or leaving the field) saves it (`sessionWrap.setRecap`, optimistic); Cancel drops the draft.
 */
export function Recap({ ids, isGm, session }: { ids: Ids; isGm: boolean; session: SessionListItem | undefined }) {
  return (
    <Card actions={<Text style={js.muted}>Visible to the table</Text>} heading="Recap">
      {isGm ? <GmRecap ids={ids} /> : session === undefined ? <Gone /> : <RecapBody ids={ids} text={session.recap ?? null} />}
    </Card>
  );
}

function Gone() {
  return <Text style={js.muted}>That session isn&apos;t in this campaign anymore.</Text>;
}

function GmRecap({ ids }: { ids: Ids }) {
  const wrap = useQuery(api.sessionWrap.get, ids);
  if (wrap === undefined) return <LoadingLine>Loading the recap…</LoadingLine>;
  if (wrap === null) return <Gone />;
  return <RecapBody ids={ids} text={wrap.recap ?? null} />;
}

function RecapBody({ ids, text }: { ids: Ids; text: string | null }) {
  const setRecap = useOptimistic(api.sessionWrap.setRecap, patchRecap);
  // The draft belongs to one session, so a draft typed for one never shows in another (no remount key needed).
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editing = draft?.id === ids.sessionId ? draft.text : null;

  function save(value: string) {
    setDraft(null);
    if (stored(value) === text) return;
    setError(null);
    setRecap({ ...ids, recap: value }).catch((e: unknown) => {
      setError(errorMessage(e));
      setDraft({ id: ids.sessionId, text: value });
    });
  }

  if (editing !== null) {
    return (
      <View style={js.paper}>
        <TextInput
          accessibilityLabel="Recap"
          autoFocus
          maxLength={SESSION_TEXT_MAX.recap}
          multiline
          onChangeText={(value) => setDraft({ id: ids.sessionId, text: value })}
          placeholder="Where the party went, who they met, and what threat looms next…"
          placeholderTextColor={journalColors.paperMuted}
          style={js.paperInput}
          value={editing}
        />
        <ErrorLine error={error} />
        <View style={js.row}>
          <ActButton onPress={() => save(editing)} variant="solid">
            Save recap
          </ActButton>
          <ActButton
            onPress={() => {
              setDraft(null);
              setError(null);
            }}
          >
            Cancel
          </ActButton>
        </View>
      </View>
    );
  }

  return (
    <View style={js.paper}>
      {text ? <Text style={js.paperText}>{text}</Text> : <Text style={js.paperMuted}>No recap yet. Anyone at the table can write it.</Text>}
      <ErrorLine error={error} />
      <Pressable accessibilityRole="button" onPress={() => setDraft({ id: ids.sessionId, text: text ?? "" })} style={js.link}>
        <Text style={[js.linkText, { color: journalColors.paperInk }]}>{text ? "Edit recap" : "Write the recap"}</Text>
      </Pressable>
    </View>
  );
}

/** 'After the session' (GM only; `sessionWrap.after` is a GM query): Level-ups, and Loot edited in place. */
export function AfterSession({ ids }: { ids: Ids }) {
  const after = useQuery(api.sessionWrap.after, ids);
  const party = useQuery(api.charactersReads.partySummary, { campaignId: ids.campaignId });
  const names = new Map((party ?? []).map((c) => [c._id as string, c.sheet.name]));
  return (
    <Card heading="After the session">
      {after === undefined ? (
        <LoadingLine>Loading…</LoadingLine>
      ) : after === null ? (
        <Gone />
      ) : (
        <>
          <View style={{ gap: 2 }}>
            <Text style={js.label}>Level-ups</Text>
            <Text style={js.body}>{levelUps(after.levelUps, names)}</Text>
          </View>
          <Loot ids={ids} loot={after.loot} />
          {after.truncated ? <Text style={js.muted}>A long session: later level-ups may be missing.</Text> : null}
        </>
      )}
    </Card>
  );
}

function Loot({ ids, loot }: { ids: Ids; loot: string | null }) {
  const setLoot = useOptimistic(api.sessionWrap.setLoot, patchLoot);
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editing = draft?.id === ids.sessionId ? draft.text : null;

  function save(value: string) {
    setDraft(null);
    if (stored(value) === loot) return;
    setError(null);
    setLoot({ ...ids, loot: value }).catch((e: unknown) => {
      setError(errorMessage(e));
      setDraft({ id: ids.sessionId, text: value });
    });
  }

  return (
    <View style={{ gap: 2 }}>
      <Text style={js.label}>Loot</Text>
      {editing === null ? (
        <Pressable
          accessibilityLabel={`Edit loot: ${loot ?? "none"}`}
          accessibilityRole="button"
          onPress={() => setDraft({ id: ids.sessionId, text: loot ?? "" })}
          style={js.link}
        >
          <Text style={js.body}>{`${loot ?? "None"}  ✎`}</Text>
        </Pressable>
      ) : (
        <TextInput
          accessibilityLabel="Loot"
          autoFocus
          maxLength={SESSION_TEXT_MAX.loot}
          onBlur={() => save(editing)}
          onChangeText={(value) => setDraft({ id: ids.sessionId, text: value })}
          onSubmitEditing={() => save(editing)}
          placeholder="Items found, handfuls of gold…"
          placeholderTextColor={colors.subtle}
          style={js.input}
          value={editing}
        />
      )}
      <ErrorLine error={error} />
    </View>
  );
}
