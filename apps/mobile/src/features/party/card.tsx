import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useMutation } from "convex/react";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { api } from "../../convex";
import type { Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { className, defenseOf, heritageLine, hopeMax, subclassName } from "../sheet/catalog";
import { PortraitControl } from "./portrait";
import type { PartyTable, SheetCharacter } from "../sheet/types";

export function RosterCard({
  character,
  table,
  isGm,
  activeOfOwner,
  onOpen,
}: {
  character: SheetCharacter;
  table: PartyTable | null;
  isGm: boolean;
  activeOfOwner: number;
  onOpen: () => void;
}) {
  const setStatus = useMutation(api.characters.setStatus);
  const assignOwner = useMutation(api.characters.assignOwner);
  const remove = useMutation(api.characters.remove);
  const writes = useWritesEnabled();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sheet = character.sheet;
  const dead = character.status === "dead";
  const hopeCap = hopeMax(sheet.scars, sheet.hopeSlotBonus);
  const evasion = defenseOf(sheet).evasion;
  const owner = ownerLabel(character, table);
  const canEdit = character.canEdit && character.corrupt !== true;
  const benched = character.status === "away" && character.benched === true;

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <View accessibilityLabel={dead ? `${sheet.name} (fallen)` : sheet.name} style={styles.card}>
      <Text style={styles.className}>{className(sheet.classId)}</Text>
      <Text accessibilityRole="header" style={styles.name}>
        {sheet.name}
      </Text>
      <Text style={styles.meta}>{heritageLine(sheet)}</Text>
      <Text style={styles.meta}>
        {subclassName(sheet.subclassId)} · Level {sheet.level}
      </Text>
      <Text accessibilityLabel="Owner" style={styles.owner}>
        {owner}
      </Text>
      {activeOfOwner > 1 ? (
        <Text style={styles.warn}>
          {activeOfOwner} active: send one away
        </Text>
      ) : null}
      <Text accessibilityLabel={`${sheet.hp} of ${sheet.hpMax} Hit Points marked`} style={styles.stat}>
        HP {sheet.hp} / {sheet.hpMax}
      </Text>
      <Text accessibilityLabel={`Evasion ${evasion}`} style={styles.stat}>
        Evasion {evasion}
      </Text>
      <Text accessibilityLabel={`Hope ${Math.min(sheet.hope, hopeCap)} of ${hopeCap}`} style={styles.hope}>
        Hope {Math.min(sheet.hope, hopeCap)} / {hopeCap}
        {sheet.scars > 0 ? ` · ${sheet.scars} scar${sheet.scars > 1 ? "s" : ""}` : ""}
      </Text>
      {sheet.levelUpPending === true ? <Text style={styles.warn}>Level up pending</Text> : null}
      <Button onPress={onOpen} variant="outline">
        Open character sheet
      </Button>
      <PortraitControl
        canEdit={canEdit}
        characterId={character._id}
        hasPortrait={character.portraitUrl !== null}
        name={sheet.name}
        portrait={sheet.portrait}
        portraitUrl={character.portraitUrl}
      />
      {canEdit && !dead ? (
        <Button
          accessibilityLabel={`Kill ${sheet.name}`}
          disabled={!writes}
          onPress={() => void run(() => setStatus({ characterId: character._id, status: "dead" }))}
          variant="danger"
        >
          Kill
        </Button>
      ) : null}
      {dead && isGm ? (
        <Button
          accessibilityLabel={`Revive ${sheet.name}`}
          disabled={!writes}
          onPress={() => void run(() => setStatus({ characterId: character._id, status: "active" }))}
          variant="outline"
        >
          Revive
        </Button>
      ) : null}
      {canEdit && (character.status === "active" || benched) ? (
        <Button
          accessibilityLabel={benched ? `Bring ${sheet.name} back` : `Send ${sheet.name} away`}
          disabled={!writes}
          onPress={() => void run(() => setStatus({ characterId: character._id, status: benched ? "active" : "away" }))}
          variant="outline"
        >
          {benched ? "Bring back" : "Send away"}
        </Button>
      ) : null}
      {isGm && table ? (
        <View accessibilityLabel={`Assign ${sheet.name}`} style={styles.assign}>
          <Assign
            disabled={!writes}
            label="Unassigned (GM)"
            onPress={() => void run(() => assignOwner({ characterId: character._id, ownerId: table.gm.userId as Id<"users"> }))}
            selected={character.ownerId === table.gm.userId}
          />
          {table.players.map((player) => (
            <Assign
              disabled={!writes}
              key={player.userId}
              label={player.name}
              onPress={() => void run(() => assignOwner({ characterId: character._id, ownerId: player.userId as Id<"users"> }))}
              selected={character.ownerId === player.userId}
            />
          ))}
        </View>
      ) : null}
      {isGm ? (
        <Button accessibilityLabel={`Delete ${sheet.name}`} disabled={!writes} onPress={() => setConfirmDelete(true)} variant="danger">
          Delete
        </Button>
      ) : null}
      {confirmDelete ? (
        <View accessibilityLabel={`Delete ${sheet.name}`} accessibilityRole="alert" style={styles.confirm}>
          <Text style={styles.confirmCopy}>Delete {sheet.name} for good? This can’t be undone.</Text>
          <Button onPress={() => setConfirmDelete(false)} variant="outline">
            Keep
          </Button>
          <Button
            disabled={!writes}
            onPress={() => void run(() => remove({ characterId: character._id }))}
            variant="dangerSolid"
          >
            Delete character
          </Button>
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function Assign({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Button disabled={disabled || selected} onPress={onPress} variant={selected ? "solid" : "outline"}>
      {label}
    </Button>
  );
}

function ownerLabel(character: SheetCharacter, table: PartyTable | null): string {
  if (!table) return "…";
  if (character.ownerId === table.gm.userId) return "Unassigned";
  if (character.mine) return "Yours";
  return table.players.find((player) => player.userId === character.ownerId)?.name ?? "Former player";
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[2],
    padding: space[4],
  },
  className: {
    color: colors.hope,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
    fontWeight: type.displayBold.fontWeight,
  },
  name: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 24,
    fontWeight: type.displayBold.fontWeight,
  },
  meta: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  owner: {
    color: colors.brand,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 14,
    fontWeight: type.sansSemibold.fontWeight,
  },
  stat: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
  },
  hope: {
    color: colors.hope,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 16,
    fontWeight: type.sansSemibold.fontWeight,
  },
  warn: {
    color: colors.hope,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  assign: {
    gap: space[2],
  },
  confirm: {
    gap: space[2],
  },
  confirmCopy: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
