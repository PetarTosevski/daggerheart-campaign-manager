import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  BEAT_HINTS,
  BEAT_LABELS,
  FIELD_MAX,
  HUNT_BEATS,
  SUGGESTED_CLUES,
} from "../../../../../src/lib/frames/trackers/andaluria";
import { api } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Loading } from "../../ui/loading";
import { Sheet } from "../../ui/sheet";
import type { TrackerCampaign } from "./campaign";
import { CheckRow, ErrorText, Field, SavedField, TrackerButton, TrackerCard } from "./card";
import { useIntent } from "./intent";

type AndaluriaView = FunctionReturnType<typeof api.trackers.andaluria.get>;
type GmHunt = Extract<AndaluriaView, { role: "gm" }>["hunts"][number];
type PlayerHunt = Extract<AndaluriaView, { role: "player" }>["hunts"][number];
type Clue = GmHunt["clues"][number];

const MONSTER_FIELDS = [
  ["monster", "Monster"],
  ["what", "What is it?"],
  ["wants", "What does it want?"],
  ["where", "Where can you find it?"],
  ["defeat", "How can you defeat it?"],
] as const;

/** Dark Heart of Andaluria: Hunts and their Liminal Clues (HF pp.154-155). */
export function AndaluriaTracker({ campaign }: { campaign: TrackerCampaign }) {
  const view = useQuery(api.trackers.andaluria.get, { campaignId: campaign._id });
  if (view === undefined) return <Loading label="Loading the frame tracker…" />;
  if (view.role === "player" || campaign.role !== "gm") return <PlayerHunts hunts={view.role === "player" ? view.hunts : []} />;
  return <GmHunts campaignId={campaign._id} hunts={view.hunts} />;
}

function PlayerHunts({ hunts }: { hunts: PlayerHunt[] }) {
  const active = hunts.filter((hunt) => !hunt.archived);
  const archived = hunts.filter((hunt) => hunt.archived);
  const [showPast, setShowPast] = useState(false);
  return (
    <TrackerCard subtitle="Clues that have become solid." title="The Hunt">
      {active.length ? (
        <View accessibilityLabel="Hunts" style={styles.stack}>
          {active.map((hunt) => (
            <PlayerHuntCard key={hunt.id} hunt={hunt} />
          ))}
        </View>
      ) : (
        <Text style={styles.meta}>No hunt is under way.</Text>
      )}
      {archived.length ? (
        <View>
          <TrackerButton onPress={() => setShowPast((open) => !open)}>{`Past hunts (${archived.length})`}</TrackerButton>
          {showPast ? (
            <View style={styles.stack}>
              {archived.map((hunt) => (
                <PlayerHuntCard key={hunt.id} hunt={hunt} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </TrackerCard>
  );
}

function PlayerHuntCard({ hunt }: { hunt: PlayerHunt }) {
  return (
    <View accessibilityLabel={hunt.title} style={styles.block}>
      <Text style={styles.huntTitle}>{hunt.title}</Text>
      <Text style={styles.meta}>{BEAT_LABELS[hunt.beat]}</Text>
      {hunt.allCluesRevealed ? <Text style={styles.badge}>All clues revealed</Text> : null}
      {hunt.monster
        ? MONSTER_FIELDS.map(([key, label]) =>
            hunt.monster?.[key] ? (
              <Text key={key} style={styles.body}>
                {label}: {hunt.monster[key]}
              </Text>
            ) : null,
          )
        : null}
      {hunt.clues.length ? (
        <View accessibilityLabel={`Clues for ${hunt.title}`}>
          {hunt.clues.map((clue) => (
            <Text key={clue.id} style={styles.body}>
              {clue.text}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.meta}>No clues have surfaced yet.</Text>
      )}
    </View>
  );
}

function GmHunts({ campaignId, hunts }: { campaignId: TrackerCampaign["_id"]; hunts: GmHunt[] }) {
  const create = useIntent(api.trackers.andaluria.createHunt);
  const [title, setTitle] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const active = hunts.filter((hunt) => !hunt.archived);
  const archived = hunts.filter((hunt) => hunt.archived);
  return (
    <TrackerCard subtitle="Players see each hunt’s name, beat and revealed clues only." title="The Hunt">
      <Field label="New hunt name" maxLength={100} onChangeText={setTitle} placeholder="Name a new hunt (e.g. The Drowned Bell)" value={title} />
      <TrackerButton
        disabled={create.pending || !title.trim()}
        onPress={() => {
          void create.fire({ campaignId, title }).then((result) => {
            if (result) setTitle("");
          });
        }}
      >
        New hunt
      </TrackerButton>
      <ErrorText error={create.error} />
      {active.length ? (
        <View accessibilityLabel="Hunts" style={styles.stack}>
          {active.map((hunt) => (
            <GmHuntCard key={hunt.id} campaignId={campaignId} hunt={hunt} />
          ))}
        </View>
      ) : (
        <Text style={styles.meta}>No hunt is under way.</Text>
      )}
      {archived.length ? (
        <View>
          <TrackerButton onPress={() => setShowArchived((open) => !open)}>
            {`Archived hunts (${archived.length})`}
          </TrackerButton>
          {showArchived
            ? archived.map((hunt) => <GmHuntCard key={hunt.id} campaignId={campaignId} hunt={hunt} />)
            : null}
        </View>
      ) : null}
    </TrackerCard>
  );
}

function GmHuntCard({ campaignId, hunt }: { campaignId: TrackerCampaign["_id"]; hunt: GmHunt }) {
  const update = useIntent(api.trackers.andaluria.updateHunt);
  const remove = useIntent(api.trackers.andaluria.deleteHunt);
  const addClue = useIntent(api.trackers.andaluria.createClue);
  const [clue, setClue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const revealedCount = hunt.clues.filter((item) => item.revealed).length;
  const save = (patch: {
    title?: string;
    monster?: string;
    what?: string;
    wants?: string;
    where?: string;
    defeat?: string;
    beat?: string;
    underlings?: string[];
    bystanders?: string[];
    archived?: boolean;
    monsterRevealed?: boolean;
  }) => update.fire({ campaignId, huntId: hunt.id, patch });

  return (
    <View accessibilityLabel={hunt.title} style={styles.block}>
      <Text style={styles.huntTitle}>{hunt.title}</Text>
      {hunt.allCluesRevealed ? <Text style={styles.badge}>All clues revealed</Text> : null}
      {hunt.archived ? <Text style={styles.meta}>Archived</Text> : null}
      <SavedField label="Hunt name" maxLength={100} onSave={(title) => void save({ title })} value={hunt.title} />
      <View accessibilityLabel={`Beat for ${hunt.title}`} accessibilityRole="radiogroup" style={styles.stack}>
        {HUNT_BEATS.map((beat) => (
          <TrackerButton
            key={beat}
            accessibilityLabel={BEAT_LABELS[beat]}
            onPress={() => void save({ beat })}
            variant={hunt.beat === beat ? "solid" : "outline"}
          >
            {BEAT_LABELS[beat]}
          </TrackerButton>
        ))}
      </View>
      <Text style={styles.meta}>{BEAT_HINTS[hunt.beat]}</Text>
      <Text style={styles.section}>The monster (GM only)</Text>
      {MONSTER_FIELDS.map(([key, label]) => (
        <SavedField key={key} label={label} multiline={key !== "monster"} onSave={(next) => void save({ [key]: next })} value={hunt[key]} />
      ))}
      <CheckRow
        checked={hunt.monsterRevealed}
        label="Reveal monster to players"
        onPress={() => void save({ monsterRevealed: !hunt.monsterRevealed })}
      />
      <SavedField
        label="Underlings (one per line)"
        multiline
        onSave={(next) => void save({ underlings: toLines(next) })}
        value={hunt.underlings.join("\n")}
      />
      <SavedField
        label="Bystanders (one per line)"
        multiline
        onSave={(next) => void save({ bystanders: toLines(next) })}
        value={hunt.bystanders.join("\n")}
      />
      <Text accessibilityRole="header" style={styles.section}>
        Liminal clues {revealedCount}/{hunt.clues.length} (prepare {SUGGESTED_CLUES.min} to {SUGGESTED_CLUES.max}; revealing one makes it solid for players)
      </Text>
      <View accessibilityLabel={`Liminal clues for ${hunt.title}`} style={styles.stack}>
        {hunt.clues.map((item, index) => (
          <ClueRow key={item.id} campaignId={campaignId} clue={item} huntId={hunt.id} n={index + 1} />
        ))}
      </View>
      <Field label={`New clue for ${hunt.title}`} maxLength={FIELD_MAX} onChangeText={setClue} placeholder="A fact, a sign, or a symptom of the monster’s nature" value={clue} />
      <TrackerButton
        disabled={addClue.pending || !clue.trim()}
        onPress={() => {
          void addClue.fire({ campaignId, huntId: hunt.id, text: clue }).then((result) => {
            if (result) setClue("");
          });
        }}
      >
        Add clue
      </TrackerButton>
      <ErrorText error={addClue.error} />
      <TrackerButton onPress={() => void save({ archived: !hunt.archived })}>
        {hunt.archived ? "Restore hunt" : "Archive hunt"}
      </TrackerButton>
      <TrackerButton disabled={remove.pending} onPress={() => setConfirmDelete(true)}>
        Delete hunt
      </TrackerButton>
      <ErrorText error={update.error ?? remove.error} />
      {confirmDelete ? (
        <Sheet onClose={() => setConfirmDelete(false)} open title={`Delete ${hunt.title}`}>
          <Text style={styles.body}>{`Delete “${hunt.title}” and its clues?`}</Text>
          <TrackerButton
            onPress={() => {
              setConfirmDelete(false);
              void remove.fire({ campaignId, huntId: hunt.id });
            }}
            variant="dangerSolid"
          >
            Delete hunt
          </TrackerButton>
        </Sheet>
      ) : null}
    </View>
  );
}

function ClueRow({
  campaignId,
  huntId,
  clue,
  n,
}: {
  campaignId: TrackerCampaign["_id"];
  huntId: string;
  clue: Clue;
  n: number;
}) {
  const update = useIntent(api.trackers.andaluria.updateClue);
  const remove = useIntent(api.trackers.andaluria.deleteClue);
  return (
    <View style={styles.block}>
      <CheckRow
        checked={clue.revealed}
        label={`Clue ${n} revealed`}
        onPress={() => void update.fire({ campaignId, huntId, clueId: clue.id, patch: { revealed: !clue.revealed } })}
      />
      <Text style={styles.meta}>{clue.revealed ? "Solid" : "Potential"}</Text>
      <SavedField
        label={`Clue ${n}`}
        onSave={(text) => void update.fire({ campaignId, huntId, clueId: clue.id, patch: { text } })}
        value={clue.text}
      />
      <SavedField
        label={`Clue ${n} GM note`}
        onSave={(note) => void update.fire({ campaignId, huntId, clueId: clue.id, patch: { note } })}
        value={clue.note}
      />
      <TrackerButton
        accessibilityLabel={`Remove clue ${n}`}
        onPress={() => void remove.fire({ campaignId, huntId, clueId: clue.id })}
      >
        Remove
      </TrackerButton>
      <ErrorText error={update.error ?? remove.error} />
    </View>
  );
}

function toLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  block: {
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  huntTitle: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
  },
  section: {
    color: colors.label,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  meta: { color: colors.mutedText, fontFamily: type.sans.fontFamily, fontSize: 14 },
  body: { color: colors.parchment, fontFamily: type.serif.fontFamily, fontSize: 16 },
  badge: { color: colors.brand, fontFamily: type.sansMedium.fontFamily, fontSize: 12, letterSpacing: 1 },
});
