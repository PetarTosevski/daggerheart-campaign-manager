import { useMutation, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import {
  MAX_SCENES,
  SESSION_SCENE_TYPES,
  SESSION_TEXT_MAX,
  type SessionSceneType,
} from "../../../../../convex/lib/validators/sessions";
import { api } from "../../convex";
import type { Id } from "../../convex";
import { WriteButton } from "../../shell/offline";
import { Loading } from "../../ui/loading";
import { useIntent } from "../dashboard/intent";
import type { SessionSlotProps } from "./slots";
import { sessionStyles as styles } from "./styles";
import type { SessionListItem } from "../../../../../convex/sessionRecords";

const SCENE_LABEL: Record<SessionSceneType, string> = {
  combat: "Combat",
  social: "Social",
  exploration: "Exploration",
  downtime: "Downtime",
};

export function PrepStage({
  campaignId,
  sessionId,
  sessions,
}: Pick<SessionSlotProps, "campaignId" | "sessionId"> & { sessions: SessionListItem[] | undefined }) {
  if (sessions === undefined) {
    return (
      <View style={styles.card}>
        <Text accessibilityRole="status" style={styles.muted}>
          Loading the prep…
        </Text>
      </View>
    );
  }
  if (!sessions.some((s) => s._id === sessionId)) {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>That session is not in this campaign anymore. Pick another one from the list.</Text>
      </View>
    );
  }
  return <PrepBody campaignId={campaignId} sessionId={sessionId} />;
}

function PrepBody({ campaignId, sessionId }: { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> }) {
  const prep = useQuery(api.sessionPrep.get, { campaignId, sessionId });
  if (prep === undefined) return <Loading label="Loading the prep" />;
  return (
    <View style={{ gap: styles.stack.gap }}>
      <Scenes campaignId={campaignId} sessionId={sessionId} scenes={prep.scenes} />
      <Hooks campaignId={campaignId} hooks={prep.hooks} sessionId={sessionId} />
      <SessionEncounter campaignId={campaignId} encounter={prep.encounter} sessionId={sessionId} />
    </View>
  );
}

function Scenes({
  campaignId,
  sessionId,
  scenes,
}: {
  campaignId: Id<"campaigns">;
  sessionId: Id<"sessions">;
  scenes: { id: string; type: SessionSceneType; text: string }[];
}) {
  const addScene = useMutation(api.sessionPrep.addScene);
  const setScene = useMutation(api.sessionPrep.setScene);
  const removeScene = useMutation(api.sessionPrep.removeScene);
  const [error, setError] = useState<string | null>(null);
  const full = scenes.length >= MAX_SCENES;

  function run(op: Promise<unknown>) {
    setError(null);
    void op.catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <View accessibilityLabel="Prep stage" style={styles.card}>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.heading}>
          Planned scenes
        </Text>
        {!full ? (
          <WriteButton accessibilityLabel="Add scene" onPress={() => run(addScene({ campaignId, sessionId }))} variant="outline">
            + Scene
          </WriteButton>
        ) : null}
      </View>
      {scenes.length === 0 ? (
        <Text style={styles.muted}>Plan a few scenes: a fight, a conversation, a place to explore. Keep them loose; the players will take things elsewhere.</Text>
      ) : (
        scenes.map((scene, index) => (
          <View key={scene.id} style={{ gap: styles.stack.gap }}>
            <Text style={styles.label}>{`Scene ${index + 1}`}</Text>
            <View style={styles.row}>
              {SESSION_SCENE_TYPES.map((type) => (
                <Pressable
                  key={type}
                  accessibilityRole="button"
                  accessibilityState={{ selected: scene.type === type }}
                  onPress={() => run(setScene({ campaignId, sessionId, sceneId: scene.id, type }))}
                  style={[styles.tab, scene.type === type ? styles.tabActive : null]}
                >
                  <Text style={[styles.tabText, scene.type === type ? styles.tabTextActive : null]}>{SCENE_LABEL[type]}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              accessibilityLabel={`Scene ${index + 1} description`}
              defaultValue={scene.text}
              maxLength={SESSION_TEXT_MAX.scene}
              onEndEditing={(e) => {
                const text = e.nativeEvent.text;
                if (text.trim() === scene.text) return;
                run(setScene({ campaignId, sessionId, sceneId: scene.id, text }));
              }}
              placeholder="What happens here?"
              placeholderTextColor={styles.muted.color}
              style={styles.input}
            />
            <WriteButton accessibilityLabel={`Remove scene ${index + 1}`} onPress={() => run(removeScene({ campaignId, sessionId, sceneId: scene.id }))} variant="outline">
              Remove scene
            </WriteButton>
          </View>
        ))
      )}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function Hooks({
  campaignId,
  sessionId,
  hooks,
}: {
  campaignId: Id<"campaigns">;
  sessionId: Id<"sessions">;
  hooks: string;
}) {
  const setHooks = useMutation(api.sessionPrep.setHooks);
  const [error, setError] = useState<string | null>(null);

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        Hooks & loose threads
      </Text>
      <TextInput
        accessibilityLabel="Hooks and loose threads"
        defaultValue={hooks}
        maxLength={SESSION_TEXT_MAX.hooks}
        multiline
        onEndEditing={(e) => {
          const text = e.nativeEvent.text;
          if (text.trim() === hooks) return;
          setError(null);
          void setHooks({ campaignId, sessionId, hooks: text }).catch((caught) => setError(errorMessage(caught)));
        }}
        placeholder="Open questions, NPC motives, clocks you might tick…"
        placeholderTextColor={styles.muted.color}
        style={[styles.input, styles.textArea]}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function SessionEncounter({
  campaignId,
  sessionId,
  encounter,
}: {
  campaignId: Id<"campaigns">;
  sessionId: Id<"sessions">;
  encounter: { _id: Id<"encounters">; name: string; status: "draft" | "running" | "ended" } | null;
}) {
  const router = useRouter();
  const list = useQuery(api.encounters.list, { campaignId });
  const create = useIntent(api.sessionPrep.createEncounter);
  const link = useMutation(api.sessionPrep.linkEncounter);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (encounter) {
    return (
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>
          Encounter builder
        </Text>
        <Text style={styles.body}>{encounter.name}</Text>
        <Text style={styles.muted}>{encounter.status}</Text>
        <WriteButton accessibilityLabel="Open adversaries" onPress={() => router.push(`/campaign/${campaignId}/adversaries`)} variant="outline">
          Open in Adversaries
        </WriteButton>
      </View>
    );
  }

  const options = list ? [...list.active, ...list.ended] : [];
  const picked = options.some((e) => e._id === choice) ? choice : (options[0]?._id ?? "");

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        Encounter builder
      </Text>
      <Text style={styles.muted}>Build this session fight with real stat blocks and Battle Points.</Text>
      <WriteButton accessibilityLabel="Create the session encounter" onPress={() => void create.fire({ campaignId, sessionId })} variant="primary">
        Create the session encounter
      </WriteButton>
      {options.length > 0 ? (
        <>
          <Text style={styles.label}>Link an encounter</Text>
          <View style={styles.row}>
            {options.map((item) => (
              <Pressable
                key={item._id}
                accessibilityRole="button"
                accessibilityState={{ selected: picked === item._id }}
                onPress={() => setChoice(item._id)}
                style={[styles.tab, picked === item._id ? styles.tabActive : null]}
              >
                <Text style={styles.tabText}>{item.name}</Text>
              </Pressable>
            ))}
          </View>
          {picked !== "" ? (
            <WriteButton
              accessibilityLabel="Link encounter"
              onPress={() => {
                setError(null);
                void link({ campaignId, sessionId, encounterId: picked as Id<"encounters"> }).catch((caught) =>
                  setError(errorMessage(caught)),
                );
              }}
              variant="outline"
            >
              Link encounter
            </WriteButton>
          ) : null}
        </>
      ) : list === undefined ? (
        <Text style={styles.muted}>Loading encounters…</Text>
      ) : (
        <Text style={styles.muted}>No encounters in this campaign yet.</Text>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
