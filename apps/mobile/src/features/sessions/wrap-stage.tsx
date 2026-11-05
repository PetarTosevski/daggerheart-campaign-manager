import { useMutation, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { SESSION_TEXT_MAX } from "../../../../../convex/lib/validators/sessions";
import { api } from "../../convex";
import type { Id } from "../../convex";
import type { SessionWrap } from "../../../../../convex/sessionWrap";
import { WriteButton } from "../../shell/offline";
import { Loading } from "../../ui/loading";
import { useIntent } from "../dashboard/intent";
import type { SessionSlotProps } from "./slots";
import { sessionStyles as styles } from "./styles";

const SAVE_DELAY_MS = 800;

type TextField = "recap" | "loot" | "threads";

export function WrapStage({ campaignId, sessionId }: Pick<SessionSlotProps, "campaignId" | "sessionId">) {
  const wrap = useQuery(api.sessionWrap.get, { campaignId, sessionId });
  if (wrap === undefined) return <Loading label="Loading wrap-up" />;
  if (wrap === null) {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>That session is not in this campaign anymore. Pick another one from the list.</Text>
      </View>
    );
  }
  return <WrapBody campaignId={campaignId} wrap={wrap} />;
}

function WrapBody({ campaignId, wrap }: { campaignId: Id<"campaigns">; wrap: SessionWrap }) {
  const setRecap = useMutation(api.sessionWrap.setRecap);
  const setLoot = useMutation(api.sessionWrap.setLoot);
  const setThreads = useMutation(api.sessionWrap.setThreads);
  const sessionId = wrap.sessionId;
  const save: Record<TextField, (text: string) => Promise<null>> = {
    recap: (recap) => setRecap({ campaignId, sessionId, recap }),
    loot: (loot) => setLoot({ campaignId, sessionId, loot }),
    threads: (threads) => setThreads({ campaignId, sessionId, threads }),
  };

  return (
    <View style={{ gap: styles.stack.gap }}>
      <TextCard
        field="recap"
        hint='Where the party stands, who they met, and what threat looms next. This shows on the dashboard as "Last Session".'
        placeholder="The party crossed the river at dawn…"
        save={save.recap}
        stored={wrap.recap}
        title="Recap"
      />
      <TextCard field="loot" placeholder="Items found, handfuls / bags / chests of gold…" save={save.loot} stored={wrap.loot} title="Loot & gold" />
      <TextCard
        field="threads"
        placeholder="Which countdowns ticked or ended, what changed in the world…"
        save={save.threads}
        stored={wrap.threads}
        title="Countdowns & threads"
      />
      <Milestone campaignId={campaignId} wrap={wrap} />
    </View>
  );
}

function TextCard({
  field,
  title,
  hint,
  placeholder,
  stored,
  save,
}: {
  field: TextField;
  title: string;
  hint?: string;
  placeholder: string;
  stored: string | undefined;
  save: (text: string) => Promise<null>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function flush(text: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (text.trim() === (stored ?? "")) return;
    setError(null);
    void save(text).catch((caught) => setError(errorMessage(caught)));
  }

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
      <TextInput
        accessibilityLabel={title}
        maxLength={SESSION_TEXT_MAX[field]}
        multiline
        onBlur={() => {
          if (draft !== null) flush(draft);
          setDraft(null);
        }}
        onChangeText={(text) => {
          setDraft(text);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(text), SAVE_DELAY_MS);
        }}
        placeholder={placeholder}
        placeholderTextColor={styles.muted.color}
        style={[styles.input, styles.textArea]}
        value={draft ?? stored ?? ""}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function Milestone({ campaignId, wrap }: { campaignId: Id<"campaigns">; wrap: SessionWrap }) {
  const router = useRouter();
  const call = useIntent(api.sessionWrap.callMilestone);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const called = wrap.milestoneAt !== undefined;

  async function onCall() {
    setConfirming(false);
    setNotice(null);
    const result = await call.fire({ campaignId, sessionId: wrap.sessionId });
    if (result?.called) {
      setNotice(result.flagged === 1 ? "1 character can level up." : `${result.flagged} characters can level up.`);
    }
  }

  return (
    <View accessibilityLabel="Milestone" style={styles.card}>
      {!called ? (
        <WriteButton accessibilityLabel="Milestone reached: the party levels up" onPress={() => setConfirming(true)} variant="primary">
          Milestone reached: the party levels up
        </WriteButton>
      ) : (
        <Text style={styles.body}>Milestone reached</Text>
      )}
      {confirming && !called ? (
        <View style={{ gap: styles.stack.gap }}>
          <Text style={styles.muted}>Every active character gets a level-up. This cannot be undone.</Text>
          <WriteButton accessibilityLabel="Level up the party" onPress={() => void onCall()} variant="primary">
            Level up the party
          </WriteButton>
          <WriteButton accessibilityLabel="Cancel milestone" onPress={() => setConfirming(false)} variant="outline">
            Cancel
          </WriteButton>
        </View>
      ) : null}
      {notice ? <Text style={styles.body}>{notice}</Text> : null}
      {call.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {call.error}
        </Text>
      ) : null}
      {called ? (
        <WriteButton accessibilityLabel="Open party to level up" onPress={() => router.push(`/campaign/${campaignId}/party`)} variant="outline">
          Open Party to level up
        </WriteButton>
      ) : null}
    </View>
  );
}
