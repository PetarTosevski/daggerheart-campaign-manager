import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  ALLY_MOVES,
  MOVE_LABELS,
  MOVES_PER_REST,
  REST_MOVES,
  type RestKind,
  type RestMove,
} from "../../../../../../src/lib/domain/rest/moves";
import { api, type Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type as textType } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { Section } from "../chrome";
import type { SheetCharacter } from "../types";
import { readParty } from "../types";
import { useIntent } from "./intent";

type RestState = FunctionReturnType<typeof api.rests.current>;
type OpenRest = NonNullable<RestState["open"]>;
type Pick = { move: RestMove; targetId?: Id<"characters">; countdownId?: Id<"countdowns"> };

export function RestPicker({
  campaignId,
  character,
  canEdit,
  open,
}: {
  campaignId: Id<"campaigns">;
  character: SheetCharacter;
  canEdit: boolean;
  open: OpenRest;
}) {
  const choice = open.choices.find((item) => item.characterId === character._id);
  const kindLabel = open.kind === "short" ? "Short rest" : "Long rest";
  const unavailable = character.status !== "active" ? character.status : null;

  const partyRaw = useQuery(api.characters.listByCampaign, canEdit ? { campaignId } : "skip");
  const party = canEdit ? readParty(partyRaw) : null;
  if (canEdit && party === undefined) {
    return (
      <Text accessibilityRole="status" style={styles.status}>
        Loading the rest…
      </Text>
    );
  }
  if (canEdit && party === null) {
    return (
      <Text accessibilityRole="alert" style={styles.status}>
        The party could not be loaded.
      </Text>
    );
  }

  const moves = open.moves.find((row) => row.characterId === character._id)?.moves ?? REST_MOVES[open.kind];
  const allies = (party ?? []).filter((row) => row._id !== character._id && row.status === "active");

  return (
    <Section title={`${kindLabel}: downtime moves`}>
      {!canEdit || unavailable !== null ? (
        <Text style={styles.body}>
          {unavailable !== null
            ? `${character.sheet.name} is ${unavailable} and can't pick downtime moves.`
            : choice
              ? `Picked: ${choice.moves.map((move) => MOVE_LABELS[move.move as RestMove] ?? move.move).join(", ")}`
              : "Still choosing."}
        </Text>
      ) : (
        <MoveForm
          allies={allies}
          character={character}
          initial={choice?.moves ?? []}
          kind={open.kind}
          moves={moves}
          restId={open._id}
        />
      )}
    </Section>
  );
}

function MoveForm({
  restId,
  kind,
  moves,
  character,
  allies,
  initial,
}: {
  restId: Id<"rests">;
  kind: RestKind;
  moves: readonly RestMove[];
  character: SheetCharacter;
  allies: SheetCharacter[];
  initial: Pick[];
}) {
  const choose = useIntent(api.rests.choose);
  const projects = useQuery(api.rests.projects, kind === "long" ? { characterId: character._id } : "skip");
  const writes = useWritesEnabled();
  const [picks, setPicks] = useState<Pick[]>(() =>
    Array.from({ length: MOVES_PER_REST }, (_, index) => initial[index] ?? { move: moves[0] ?? "prepare" }),
  );
  const [saved, setSaved] = useState(initial.length > 0);

  function set(index: number, next: Pick) {
    setSaved(false);
    setPicks((all) => all.map((pick, key) => (key === index ? next : pick)));
  }

  return (
    <View style={styles.form}>
      {picks.map((pick, index) => (
        <View key={index} style={styles.slot}>
          <Text accessibilityRole="header" style={styles.slotLabel}>
            {`Move ${index + 1}`}
          </Text>
          <View accessibilityRole="radiogroup" style={styles.chips}>
            {moves.map((move) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: pick.move === move }}
                key={move}
                onPress={() => set(index, { move })}
                style={pick.move === move ? styles.chipOn : styles.chip}
              >
                <Text style={pick.move === move ? styles.chipLabelOn : styles.chipLabel}>{MOVE_LABELS[move]}</Text>
              </Pressable>
            ))}
          </View>
          {ALLY_MOVES.includes(pick.move) && allies.length > 0 ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>On</Text>
              <View style={styles.chips}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: pick.targetId === undefined }}
                  onPress={() => set(index, { move: pick.move })}
                  style={pick.targetId === undefined ? styles.chipOn : styles.chip}
                >
                  <Text style={pick.targetId === undefined ? styles.chipLabelOn : styles.chipLabel}>Myself</Text>
                </Pressable>
                {allies.map((ally) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: pick.targetId === ally._id }}
                    key={ally._id}
                    onPress={() => set(index, { move: pick.move, targetId: ally._id })}
                    style={pick.targetId === ally._id ? styles.chipOn : styles.chip}
                  >
                    <Text style={pick.targetId === ally._id ? styles.chipLabelOn : styles.chipLabel}>{ally.sheet.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {pick.move === "workOnProject" ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Project</Text>
              <View style={styles.chips}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: pick.countdownId === undefined }}
                  onPress={() => set(index, { move: pick.move })}
                  style={pick.countdownId === undefined ? styles.chipOn : styles.chip}
                >
                  <Text style={pick.countdownId === undefined ? styles.chipLabelOn : styles.chipLabel}>GM asks for a roll</Text>
                </Pressable>
                {(projects ?? [])
                  .filter((project) => project.status === "active")
                  .map((project) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: pick.countdownId === project._id }}
                      key={project._id}
                      onPress={() => set(index, { move: pick.move, countdownId: project._id })}
                      style={pick.countdownId === project._id ? styles.chipOn : styles.chip}
                    >
                      <Text style={pick.countdownId === project._id ? styles.chipLabelOn : styles.chipLabel}>
                        {`${project.name} (${project.currentValue} left)`}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            </View>
          ) : null}
        </View>
      ))}
      {picks.some((pick) => pick.move === "workOnProject" && pick.countdownId === undefined) ? (
        <Text style={styles.hint}>The GM asks for an action roll to gauge the project&apos;s progress: roll it in the dice box.</Text>
      ) : null}
      {picks.some((pick) => pick.move === "martialPreparation") ? (
        <Text style={styles.hint}>
          Martial Preparation: describe how you train with the party. You gain a d6 Slayer Die, up to your Proficiency, to spend on an attack or
          damage roll in the dice box.
        </Text>
      ) : null}
      <Button
        accessibilityLabel="Save moves"
        disabled={!writes}
        onPress={() =>
          void choose.fire({ restId, characterId: character._id, moves: picks }).then((result) => setSaved(result !== undefined))
        }
        variant="primary"
      >
        Save moves
      </Button>
      {saved ? <Text style={styles.saved}>Saved. The GM applies them when the rest ends.</Text> : null}
      {choose.error ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
          {choose.error}
        </Text>
      ) : null}
      {kind === "long" ? <NewProject characterId={character._id} /> : null}
    </View>
  );
}

function NewProject({ characterId }: { characterId: Id<"characters"> }) {
  const create = useIntent(api.rests.createProject);
  const writes = useWritesEnabled();
  const [name, setName] = useState("");
  const [start, setStart] = useState("4");

  return (
    <View style={styles.project}>
      <Text accessibilityRole="header" style={styles.projectTitle}>
        New project
      </Text>
      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput
        accessibilityLabel="Project name"
        editable={writes}
        maxLength={80}
        onChangeText={setName}
        style={styles.input}
        value={name}
      />
      <Text style={styles.fieldLabel}>Countdown</Text>
      <TextInput
        accessibilityLabel="Project countdown"
        editable={writes}
        keyboardType="number-pad"
        maxLength={2}
        onChangeText={setStart}
        style={styles.input}
        value={start}
      />
      <Button
        accessibilityLabel="Create project"
        disabled={!writes || name.trim() === ""}
        onPress={() => {
          const startingValue = Number.parseInt(start, 10);
          if (!Number.isFinite(startingValue) || startingValue < 1) return;
          void create.fire({ characterId, name: name.trim(), startingValue }).then((result) => {
            if (result) setName("");
          });
        }}
        variant="outline"
      >
        Create project
      </Button>
      {create.error ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
          {create.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  status: {
    color: colors.body,
    fontFamily: textType.serif.fontFamily,
    fontSize: 16,
    fontStyle: textType.serif.fontStyle,
  },
  body: {
    color: colors.body,
    fontFamily: textType.sans.fontFamily,
    fontSize: 16,
  },
  form: {
    gap: space[3],
  },
  slot: {
    gap: space[2],
  },
  slotLabel: {
    color: colors.parchment,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 16,
    fontWeight: textType.displayBold.fontWeight,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  chip: {
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  chipOn: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  chipLabel: {
    color: colors.parchment,
    fontFamily: textType.sans.fontFamily,
    fontSize: 14,
  },
  chipLabelOn: {
    color: colors.brandInk,
    fontFamily: textType.sansSemibold.fontFamily,
    fontSize: 14,
    fontWeight: textType.sansSemibold.fontWeight,
  },
  field: {
    gap: space[1],
  },
  fieldLabel: {
    color: colors.mutedText,
    fontFamily: textType.sansMedium.fontFamily,
    fontSize: 14,
    fontWeight: textType.sansMedium.fontWeight,
  },
  hint: {
    color: colors.mutedText,
    fontFamily: textType.serif.fontFamily,
    fontSize: 15,
    fontStyle: textType.serif.fontStyle,
  },
  saved: {
    color: colors.hope,
    fontFamily: textType.sans.fontFamily,
    fontSize: 15,
  },
  error: {
    color: colors.danger,
    fontFamily: textType.sans.fontFamily,
    fontSize: 15,
  },
  project: {
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  projectTitle: {
    color: colors.parchment,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 15,
    fontWeight: textType.displayBold.fontWeight,
  },
  input: {
    backgroundColor: colors.ink,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: textType.sans.fontFamily,
    fontSize: 16,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
});
