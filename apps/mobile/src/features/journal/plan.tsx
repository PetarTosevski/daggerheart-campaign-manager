import { useMutation, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { nextSceneId } from "../../../../../src/lib/domain/journal/scenes";
import { MAX_PCS, MIN_PCS } from "../../../../../convex/lib/encounters";
import {
  MAX_SCENES,
  SESSION_SCENE_TYPES,
  SESSION_TEXT_MAX,
  type SessionStatus,
} from "../../../../../convex/lib/validators/sessions";
import { api, type Id } from "../../convex";
import { colors } from "../../theme/colors";
import { useIntent } from "../dashboard/intent";
import { battleScene, PENDING_SCENE, prepNote, SCENE_TYPE_LABEL, type Prep, type PrepScene } from "./model";
import { patchPrep, prepPatches, useOptimistic } from "./optimistic";
import { journalColors, js } from "./styles";
import { ActButton, Card, ErrorLine, LoadingLine, Option } from "./ui";

/**
 * The GM's Plan (website: src/components/journal/plan; GM only, `sessionPrep.get` is a GM query): 'Planned scenes'
 * (number, type, title and text edited in place and saved when the field is left, the state, the scene's options),
 * the 'GM prep' paper at its foot, a Combat scene's encounter, and 'Battle points · Scene N' for the playing Combat
 * scene, else the first one. User Q7: a Combat scene starts playing from the Combat Map, so it has no 'Play this
 * scene'. Every write is optimistic. One `sessionPrep.get` (and at most one `encounters.list`) for the whole view.
 */

type Ids = { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> };
type EncounterList = NonNullable<ReturnType<typeof useEncounterList>>;
type SceneEncounter = NonNullable<PrepScene["encounter"]>;

function useEncounterList(campaignId: Id<"campaigns">, needed: boolean) {
  return useQuery(api.encounters.list, needed ? { campaignId } : "skip");
}

function useRun() {
  const [error, setError] = useState<string | null>(null);
  function run(op: Promise<unknown>) {
    setError(null);
    op.catch((e: unknown) => setError(errorMessage(e)));
  }
  return { error, run };
}

/** A text field showing the server's value, with its own draft only while focused (no effect, no content key). */
function useFieldDraft(value: string, onSave: (text: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    value: draft ?? value,
    onFocus: () => setDraft(value),
    onChangeText: (text: string) => setDraft(text),
    onBlur: () => {
      const text = draft;
      setDraft(null);
      if (text !== null && text.trim() !== value) onSave(text);
    },
  };
}

export function PlanView({ ids, status }: { ids: Ids; status: SessionStatus | undefined }) {
  const prep = useQuery(api.sessionPrep.get, ids);
  const needsList = prep?.scenes.some((s) => s.type === "combat" && !s.encounter && !s.id.startsWith(PENDING_SCENE)) ?? false;
  const encounters = useEncounterList(ids.campaignId, needsList);
  if (prep === undefined) return <LoadingLine>Loading the plan…</LoadingLine>;
  const aside = battleScene(prep.scenes);
  return (
    <View style={{ gap: 16 }}>
      <Card actions={<AddScene count={prep.scenes.length} ids={ids} />} heading="Planned scenes">
        <SceneList encounters={encounters} ids={ids} scenes={prep.scenes} status={status} />
        <GmPrep hooks={prep.hooks} ids={ids} />
      </Card>
      {aside ? <BattlePoints encounter={aside.scene.encounter ?? null} number={aside.number} /> : null}
    </View>
  );
}

function AddScene({ ids, count }: { ids: Ids; count: number }) {
  const { error, run } = useRun();
  const addScene = useOptimistic(api.sessionPrep.addScene, prepPatches.addScene);
  const full = count >= MAX_SCENES;
  return (
    <View style={{ gap: 4 }}>
      <ActButton accessibilityLabel="Add scene" disabled={full} onPress={() => run(addScene(ids))}>
        + Add scene
      </ActButton>
      {full ? <Text style={js.muted}>{`A session holds at most ${MAX_SCENES} scenes.`}</Text> : null}
      <ErrorLine error={error} />
    </View>
  );
}

function SceneList({
  ids,
  scenes,
  status,
  encounters,
}: {
  ids: Ids;
  scenes: Prep["scenes"];
  status: SessionStatus | undefined;
  encounters: EncounterList | undefined;
}) {
  if (scenes.length === 0) {
    return <Text style={js.muted}>Plan a few scenes: a fight, a conversation, a place to explore. Keep them loose; the players will take things elsewhere.</Text>;
  }
  const nextId = nextSceneId(scenes);
  return (
    <View accessibilityLabel="Planned scenes" style={{ gap: 12 }}>
      {scenes.map((scene, i) => (
        <SceneRow key={scene.id} encounters={encounters} ids={ids} isNext={scene.id === nextId} n={i + 1} scene={scene} status={status} />
      ))}
    </View>
  );
}

function StateBadge({ scene, isNext }: { scene: PrepScene; isNext: boolean }) {
  if (scene.state === "done") return <Text style={[js.chipText, { color: colors.label }]}>✓ Done</Text>;
  if (scene.state === "playing") return <Text style={[js.chipText, { color: journalColors.live }]}>● Playing now</Text>;
  if (isNext) return <Text style={[js.chipText, { color: journalColors.planned }]}>Next</Text>;
  return null;
}

function SceneRow({
  ids,
  scene,
  n,
  isNext,
  status,
  encounters,
}: {
  ids: Ids;
  scene: PrepScene;
  n: number;
  isNext: boolean;
  status: SessionStatus | undefined;
  encounters: EncounterList | undefined;
}) {
  const { error, run } = useRun();
  const [open, setOpen] = useState(false);
  const pending = scene.id.startsWith(PENDING_SCENE);
  const setScene = useOptimistic(api.sessionPrep.setScene, prepPatches.setScene);
  const setState = useOptimistic(api.sessionPrep.setSceneState, prepPatches.setSceneState);
  const removeScene = useOptimistic(api.sessionPrep.removeScene, prepPatches.removeScene);
  const title = useFieldDraft(scene.title ?? "", (text) => run(setScene({ ...ids, sceneId: scene.id, title: text })));
  const text = useFieldDraft(scene.text, (value) => run(setScene({ ...ids, sceneId: scene.id, text: value })));

  const state = scene.state ?? "planned";
  const combat = scene.type === "combat";
  // Q7: a Combat scene plays from the Combat Map; a played session's scenes cannot start playing (the server refuses).
  const canPlay = !combat && state !== "playing" && status !== "played";

  function act(op: Promise<unknown>) {
    setOpen(false);
    run(op);
  }

  return (
    <View accessibilityLabel={`Scene ${n}`} style={[js.scene, state === "playing" ? js.scenePlaying : null]}>
      <View style={js.between}>
        <Text style={js.sceneNum}>{`${n} · ${SCENE_TYPE_LABEL[scene.type]}`}</Text>
        <StateBadge isNext={isNext} scene={scene} />
      </View>
      <TextInput
        accessibilityLabel={`Scene ${n} title`}
        editable={!pending}
        maxLength={SESSION_TEXT_MAX.sceneTitle}
        placeholder="Name this scene"
        placeholderTextColor={colors.subtle}
        style={js.input}
        {...title}
      />
      <TextInput
        accessibilityLabel={`Scene ${n} description`}
        editable={!pending}
        maxLength={SESSION_TEXT_MAX.scene}
        multiline
        placeholder="What happens here?"
        placeholderTextColor={colors.subtle}
        style={js.input}
        {...text}
      />
      {combat && !pending ? <SceneEncounterCard encounter={scene.encounter ?? null} encounters={encounters} ids={ids} sceneId={scene.id} /> : null}
      {pending ? null : (
        <Pressable
          accessibilityLabel={`Scene ${n} options`}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((v) => !v)}
          style={js.link}
        >
          <Text style={js.linkText}>{open ? "Close options" : "Scene options ⋯"}</Text>
        </Pressable>
      )}
      {open ? (
        <View style={{ gap: 8 }}>
          {canPlay ? <ActButton onPress={() => act(setState({ ...ids, sceneId: scene.id, state: "playing" }))}>Play this scene</ActButton> : null}
          {combat && state === "planned" ? <Text style={js.muted}>Plays when its encounter goes on the Combat Map.</Text> : null}
          {state !== "done" ? <ActButton onPress={() => act(setState({ ...ids, sceneId: scene.id, state: "done" }))}>Mark done</ActButton> : null}
          {state !== "planned" ? (
            <ActButton onPress={() => act(setState({ ...ids, sceneId: scene.id, state: "planned" }))}>Back to planned</ActButton>
          ) : null}
          <Text style={js.label}>Type</Text>
          <View style={js.row}>
            {SESSION_SCENE_TYPES.map((type) => (
              <Option
                key={type}
                label={SCENE_TYPE_LABEL[type]}
                on={scene.type === type}
                onPress={() => {
                  if (type !== scene.type) act(setScene({ ...ids, sceneId: scene.id, type }));
                }}
              />
            ))}
          </View>
          <ActButton onPress={() => act(removeScene({ ...ids, sceneId: scene.id }))} variant="danger">
            Remove scene
          </ActButton>
        </View>
      ) : null}
      <ErrorLine error={error} />
    </View>
  );
}

/** 'GM prep': the hooks text read as paper ('- ' lines are bullets); Edit turns it into a field saved when left. */
function GmPrep({ ids, hooks }: { ids: Ids; hooks: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const { error, run } = useRun();
  const setHooks = useOptimistic(api.sessionPrep.setHooks, prepPatches.setHooks);

  function save() {
    const text = draft;
    setDraft(null);
    if (text !== null && text.trim() !== hooks) run(setHooks({ ...ids, hooks: text }));
  }

  const blocks = prepNote(hooks);
  return (
    <View style={js.paper}>
      <View style={js.between}>
        <Text style={js.paperLabel}>GM prep</Text>
        {draft === null ? (
          <Pressable accessibilityLabel="Edit GM prep" accessibilityRole="button" onPress={() => setDraft(hooks)} style={js.link}>
            <Text style={[js.linkText, { color: journalColors.paperInk }]}>Edit</Text>
          </Pressable>
        ) : null}
      </View>
      {draft !== null ? (
        <>
          <TextInput
            accessibilityLabel="GM prep"
            autoFocus
            maxLength={SESSION_TEXT_MAX.hooks}
            multiline
            onBlur={save}
            onChangeText={setDraft}
            placeholder={"- A rumour to drop\n- An NPC to bring back"}
            placeholderTextColor={journalColors.paperMuted}
            style={js.paperInput}
            value={draft}
          />
          <Text style={js.paperMuted}>Start a line with “- ” for a bullet. Saved when you leave the field.</Text>
        </>
      ) : blocks.length === 0 ? (
        <Text style={js.paperMuted}>Rumours to drop, NPCs to bring back, questions left from last time.</Text>
      ) : (
        // Blocks have no ids; they are rebuilt from the text on every render and hold no state.
        blocks.map((block, i) =>
          block.kind === "list" ? (
            <View key={i} style={{ gap: 2 }}>
              {block.items.map((item, j) => (
                <Text key={j} style={js.paperText}>{`•  ${item}`}</Text>
              ))}
            </View>
          ) : (
            <Text key={i} style={js.paperText}>
              {block.text}
            </Text>
          ),
        )
      )}
      <ErrorLine error={error} />
    </View>
  );
}

/** A Combat scene's encounter: its name, party size, the adversaries with type and Battle Points; or create / link one. */
function SceneEncounterCard({
  ids,
  sceneId,
  encounter,
  encounters,
}: {
  ids: Ids;
  sceneId: string;
  encounter: SceneEncounter | null;
  encounters: EncounterList | undefined;
}) {
  const router = useRouter();
  const { error, run } = useRun();
  const unlink = useOptimistic(api.sessionPrep.unlinkSceneEncounter, prepPatches.unlink);
  if (encounter === null) return <NoEncounter encounters={encounters} ids={ids} sceneId={sceneId} />;
  return (
    <View accessibilityLabel={`Encounter · ${encounter.name}`} style={js.encounter} testID="scene-encounter">
      <Text style={[js.body, { color: journalColors.combat }]}>{`Encounter · ${encounter.name}`}</Text>
      <PartySize encounterId={encounter._id} ids={ids} pcs={encounter.pcs} />
      {encounter.instances.length === 0 ? (
        <Text style={js.muted}>No adversaries yet. Add them in the Adversaries tab; the Battle Points show how hard the fight is.</Text>
      ) : (
        <View accessibilityLabel="Adversaries in this encounter" style={js.row}>
          {encounter.instances.map((i) => (
            <View key={i._id} style={js.encounterChip}>
              <Text style={js.encounterChipText}>{`${i.label}${i.count > 1 ? ` ×${i.count}` : ""} · ${i.type ?? "Unknown"} · ${i.bp}`}</Text>
            </View>
          ))}
        </View>
      )}
      {encounter.onMap ? <Text style={[js.body, { color: journalColors.live }]}>✓ On the Combat Map</Text> : null}
      <View style={js.row}>
        <ActButton onPress={() => router.push(`/campaign/${ids.campaignId}/combat-map`)}>Open map</ActButton>
        <ActButton onPress={() => router.push(`/campaign/${ids.campaignId}/adversaries/${encounter._id}`)}>Edit in Adversaries</ActButton>
        <ActButton accessibilityLabel={`Unlink ${encounter.name} from this scene`} onPress={() => run(unlink({ ...ids, sceneId }))}>
          Unlink
        </ActButton>
      </View>
      <ErrorLine error={error} />
    </View>
  );
}

/** Party size − / + (`encounters.setBudget`, the Adversaries builder's intent), optimistic on the plan. */
function PartySize({ ids, encounterId, pcs }: { ids: Ids; encounterId: Id<"encounters">; pcs: number }) {
  const { error, run } = useRun();
  const setBudget = useOptimistic(api.encounters.setBudget, (store, args) => {
    if (args.change.kind !== "pcs") return;
    const delta = args.change.delta;
    patchPrep(store, ids, (prep) => ({
      ...prep,
      scenes: prep.scenes.map((s) =>
        s.encounter && s.encounter._id === args.encounterId
          ? { ...s, encounter: { ...s.encounter, pcs: Math.min(MAX_PCS, Math.max(MIN_PCS, s.encounter.pcs + delta)) } }
          : s,
      ),
    }));
  });
  const step = (delta: number) => run(setBudget({ campaignId: ids.campaignId, encounterId, change: { kind: "pcs", delta } }));
  return (
    <View style={{ gap: 4 }}>
      <View accessibilityLabel="Party size" style={js.row}>
        <Text style={js.body}>Party size</Text>
        <ActButton accessibilityLabel="Fewer player characters" disabled={pcs <= MIN_PCS} onPress={() => step(-1)}>
          −
        </ActButton>
        <Text accessibilityLiveRegion="polite" style={[js.body, { minWidth: 24, textAlign: "center" }]} testID="scene-encounter-pcs">
          {String(pcs)}
        </Text>
        <ActButton accessibilityLabel="More player characters" disabled={pcs >= MAX_PCS} onPress={() => step(1)}>
          +
        </ActButton>
      </View>
      <ErrorLine error={error} />
    </View>
  );
}

const STATUS_LABEL = { draft: "Draft", running: "Running", ended: "Ended" } as const;

function NoEncounter({ ids, sceneId, encounters }: { ids: Ids; sceneId: string; encounters: EncounterList | undefined }) {
  const create = useIntent(api.sessionPrep.createSceneEncounter);
  const link = useMutation(api.sessionPrep.linkSceneEncounter);
  const [choice, setChoice] = useState("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = encounters ? [...encounters.active, ...encounters.ended] : [];
  const picked = options.some((e) => e._id === choice) ? choice : (options[0]?._id ?? "");

  async function onLink() {
    if (picked === "") return;
    setError(null);
    setLinking(true);
    try {
      await link({ ...ids, sceneId, encounterId: picked });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLinking(false);
    }
  }

  return (
    <View accessibilityLabel="Encounter" style={js.encounter} testID="scene-encounter">
      <Text style={js.muted}>No encounter yet. Build this fight with real stat blocks and Battle Points; it also appears in the Adversaries tab.</Text>
      <ActButton onPress={() => void create.fire({ ...ids, sceneId })} variant="solid">
        Create encounter
      </ActButton>
      {encounters === undefined ? (
        <LoadingLine>Loading encounters…</LoadingLine>
      ) : options.length === 0 ? (
        <Text style={js.muted}>No encounters yet</Text>
      ) : (
        <>
          <Text style={js.label}>Link an encounter</Text>
          <View style={js.row}>
            {options.map((e) => (
              <Option key={e._id} label={`${e.name} (${STATUS_LABEL[e.status]})`} on={picked === e._id} onPress={() => setChoice(e._id)} />
            ))}
          </View>
          <ActButton disabled={picked === "" || linking} onPress={() => void onLink()}>
            Link
          </ActButton>
        </>
      )}
      <ErrorLine error={create.error ?? error} />
    </View>
  );
}

/**
 * 'Battle points · Scene N': the scene's encounter's budget from the plan (spent of budget and the verdict). The
 * difficulty adjustments are set in the Adversaries tab's builder, as on the website's panel.
 */
function BattlePoints({ encounter, number }: { encounter: SceneEncounter | null; number: number }) {
  return (
    <Card heading={`Battle points · Scene ${number}`}>
      {encounter === null ? (
        <Text style={js.muted}>No encounter yet. Create or link one on the scene to see its Battle Points.</Text>
      ) : (
        <>
          <View accessibilityLabel={`${encounter.spent} of ${encounter.budget} Battle Points spent`} accessible style={js.between}>
            <Text style={js.body}>Spent</Text>
            <Text style={js.tileN}>{`${encounter.spent} / ${encounter.budget}`}</Text>
          </View>
          <Text style={js.body}>{encounter.verdict}</Text>
          <Text style={js.muted}>{`Party of ${encounter.pcs} · ${encounter.adversaries} ${encounter.adversaries === 1 ? "adversary" : "adversaries"}`}</Text>
        </>
      )}
    </Card>
  );
}
