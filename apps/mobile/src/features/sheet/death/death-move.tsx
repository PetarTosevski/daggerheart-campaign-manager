import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation } from "convex/react";
import * as Crypto from "expo-crypto";

import { DEATH_MOVE_LABELS, type AwayReason, type DeathMove } from "../../../../../../src/lib/domain/death/index";
import { errorMessage } from "../../../../../../src/lib/convex-errors";
import { api } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { Sheet } from "../../../ui/sheet";
import type { SheetSlotProps } from "../contract";
import type { DeathMoveState } from "./types";

const MOVE_HINTS: Record<DeathMove, string> = {
  blazeOfGlory: "Take one last action, which critically succeeds, then cross through the veil.",
  avoidDeath: "Drop unconscious until an ally clears a Hit Point or the party finishes a long rest. Roll the Hope Die: at or under your level, gain a scar.",
  riskItAll: "Roll the Duality Dice. Hope higher: clear Hit Points and Stress worth the Hope Die. Fear higher: death. Matching: clear all.",
};

export function DeathMoveControls({
  character,
  canEdit,
  isGm,
  deathState: state,
}: SheetSlotProps & { deathState: DeathMoveState | undefined }) {
  const undo = useMutation(api.deathMoves.undo);
  const writes = useWritesEnabled();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  if (!canEdit || state === undefined) return null;

  const due = state.awaitingMove || state.pending !== null;
  const modalKey = `${character._id}:${character.sheet.hp}:${state.pending?.move ?? "choose"}`;
  const open = due && dismissedKey !== modalKey;

  return (
    <View style={styles.strip}>
      {due && !open ? (
        <Button onPress={() => setDismissedKey(null)} variant="solid">
          {state.pending ? `Finish ${DEATH_MOVE_LABELS[state.pending.move]}` : "Make a death move"}
        </Button>
      ) : null}
      {result || state.undoEntryId ? (
        <View style={styles.meta}>
          {result ? (
            <Text accessibilityRole="text" style={styles.result}>
              {result}
            </Text>
          ) : null}
          {state.undoEntryId ? (
            <Button
              disabled={!writes}
              onPress={() =>
                void undo({ entryId: state.undoEntryId!, idempotencyKey: Crypto.randomUUID() }).then(() => {
                  setResult("Death move undone.");
                })
              }
              variant="outline"
            >
              Undo death move
            </Button>
          ) : null}
        </View>
      ) : null}
      <Sheet onClose={() => setDismissedKey(modalKey)} open={open} title="Death move">
        {state.pending?.move === "blazeOfGlory" ? (
          <FinishBlaze
            characterId={character._id}
            isGm={isGm}
            lessLethal={state.lessLethal}
            name={character.sheet.name}
            onDone={setResult}
          />
        ) : state.pending?.move === "riskItAll" ? (
          <SplitRiskItAll
            characterId={character._id}
            hp={character.sheet.hp}
            onDone={setResult}
            stress={character.sheet.stress}
            undoKey={state.undoEntryId ?? "risk"}
            value={state.pending.value}
          />
        ) : (
          <ChooseMove
            characterId={character._id}
            isGm={isGm}
            lessLethal={state.lessLethal}
            level={character.sheet.level}
            name={character.sheet.name}
            onDone={setResult}
          />
        )}
      </Sheet>
    </View>
  );
}

function AwayReasonPicker({
  value,
  onChange,
  request,
}: {
  value: AwayReason;
  onChange: (reason: AwayReason) => void;
  request: boolean;
}) {
  return (
    <View accessibilityLabel="Less lethal away reason" style={styles.reasons}>
      <Text style={styles.reasonLegend}>
        {request
          ? "Less lethal (Castle High): instead of dying, the character is… — the GM decides"
          : "Less lethal (Castle High): instead of dying, the character is…"}
      </Text>
      {(["infirmary", "sentHome"] as const).map((reason) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: value === reason }}
          key={reason}
          onPress={() => onChange(reason)}
          style={styles.reasonRow}
        >
          <Text style={styles.reasonLabel}>
            {request ? "Request: " : ""}
            {reason === "infirmary" ? "In the infirmary" : "Sent home"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function MoveOption({ move, disabled, onPick }: { move: DeathMove; disabled: boolean; onPick: () => void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPick} style={styles.moveOption}>
      <Text style={styles.moveName}>{DEATH_MOVE_LABELS[move]}</Text>
      <Text style={styles.moveHint}>{MOVE_HINTS[move]}</Text>
    </Pressable>
  );
}

function ChooseMove({
  characterId,
  name,
  level,
  lessLethal,
  isGm,
  onDone,
}: {
  characterId: SheetSlotProps["character"]["_id"];
  name: string;
  level: number;
  lessLethal: boolean;
  isGm: boolean;
  onDone: (text: string) => void;
}) {
  const choose = useMutation(api.deathMoves.choose);
  const writes = useWritesEnabled();
  const [action, setAction] = useState("");
  const [awayReason, setAwayReason] = useState<AwayReason>("infirmary");
  const [error, setError] = useState<string | null>(null);
  const request = lessLethal && !isGm;

  async function pick(move: DeathMove) {
    if (!writes) return;
    setError(null);
    try {
      const r = await choose({
        characterId,
        move,
        idempotencyKey: Crypto.randomUUID(),
        ...(move === "blazeOfGlory" && action.trim() ? { action: action.trim() } : {}),
        ...(lessLethal ? { awayReason } : {}),
      });
      if (move === "avoidDeath") {
        onDone(
          `Hope Die ${r.hopeDie} against level ${level}: ${r.scarred ? "a scar" : "no scar"}.${r.journeyEnds ? " The last Hope slot is gone: the journey ends." : ""}`,
        );
      } else if (move === "riskItAll") {
        const lead = `Hope ${r.hopeDie}, Fear ${r.fearDie}: `;
        onDone(
          lead +
            (r.status !== "active"
              ? r.status === "away"
                ? `away instead of dead${request ? " (requested; the GM decides)" : ""}.`
                : "death."
              : r.pending !== null
                ? "clear Hit Points and Stress."
                : "matching dice, everything cleared."),
        );
      } else onDone("Blaze of Glory: the action critically succeeds.");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <View style={styles.modalBody}>
      <Text style={styles.lede}>{name} has marked their last Hit Point. Choose a death move.</Text>
      {lessLethal ? <AwayReasonPicker onChange={setAwayReason} request={request} value={awayReason} /> : null}
      {(["blazeOfGlory", "avoidDeath", "riskItAll"] as const).map((move) => (
        <View key={move} style={styles.moveBlock}>
          <MoveOption disabled={!writes} move={move} onPick={() => void pick(move)} />
          {move === "blazeOfGlory" ? (
            <TextInput
              accessibilityLabel="Last action (optional)"
              maxLength={200}
              onChangeText={setAction}
              placeholder="Last action (optional)"
              placeholderTextColor={colors.mutedText}
              style={styles.input}
              value={action}
            />
          ) : null}
        </View>
      ))}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function FinishBlaze({
  characterId,
  name,
  lessLethal,
  isGm,
  onDone,
}: {
  characterId: SheetSlotProps["character"]["_id"];
  name: string;
  lessLethal: boolean;
  isGm: boolean;
  onDone: (text: string) => void;
}) {
  const finish = useMutation(api.deathMoves.finishBlaze);
  const writes = useWritesEnabled();
  const [awayReason, setAwayReason] = useState<AwayReason>("infirmary");
  const request = lessLethal && !isGm;

  return (
    <View style={styles.modalBody}>
      <Text style={styles.lede}>
        {name} takes their last action, which critically succeeds. When it is done, they cross through the veil.
      </Text>
      {lessLethal ? <AwayReasonPicker onChange={setAwayReason} request={request} value={awayReason} /> : null}
      <Button
        disabled={!writes}
        onPress={() =>
          void finish({
            characterId,
            idempotencyKey: Crypto.randomUUID(),
            ...(lessLethal ? { awayReason } : {}),
          }).then((r) => {
            if (r)
              onDone(
                r.status === "away"
                  ? `${name} is away instead of dead${request ? " (requested; the GM decides)" : ""}.`
                  : `${name} has crossed through the veil.`,
              );
          })
        }
        variant="solid"
      >
        {lessLethal ? "End the action" : "Cross through the veil"}
      </Button>
    </View>
  );
}

function SplitRiskItAll({
  characterId,
  value,
  hp,
  stress,
  undoKey,
  onDone,
}: {
  characterId: SheetSlotProps["character"]["_id"];
  value: number;
  hp: number;
  stress: number;
  undoKey: string;
  onDone: (text: string) => void;
}) {
  const resolve = useMutation(api.deathMoves.resolveRiskItAll);
  const writes = useWritesEnabled();
  const total = Math.min(value, hp + stress);
  const minHp = Math.max(0, total - stress);
  const maxHp = Math.min(hp, total);
  const [hpClear, setHpClear] = useState(maxHp);
  const stressClear = total - hpClear;
  return (
    <View key={undoKey} style={styles.modalBody}>
      <Text style={styles.lede}>
        The Hope Die shows {value}: clear {total} in total, split between Hit Points and Stress.
      </Text>
      <Text style={styles.lede}>Hit Points to clear: {hpClear}</Text>
      <View style={styles.splitRow}>
        <Button disabled={hpClear <= minHp || !writes} onPress={() => setHpClear((n) => Math.max(minHp, n - 1))} variant="outline">
          Fewer HP
        </Button>
        <Button disabled={hpClear >= maxHp || !writes} onPress={() => setHpClear((n) => Math.min(maxHp, n + 1))} variant="outline">
          More HP
        </Button>
      </View>
      <Text style={styles.lede} testID="risk-stress">
        Stress to clear: {stressClear}
      </Text>
      <Button
        disabled={!writes}
        onPress={() =>
          void resolve({ characterId, hp: hpClear, stress: stressClear, idempotencyKey: Crypto.randomUUID() }).then((r) => {
            if (r) onDone(`Cleared ${hpClear} Hit Points and ${stressClear} Stress.`);
          })
        }
        variant="solid"
      >
        Clear them
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    gap: space[3],
  },
  meta: {
    gap: space[2],
  },
  result: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  modalBody: {
    gap: space[4],
  },
  lede: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
  },
  reasons: {
    gap: space[2],
  },
  reasonLegend: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  reasonRow: {
    minHeight: 44,
    justifyContent: "center",
  },
  reasonLabel: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
  },
  moveBlock: {
    gap: space[2],
  },
  moveOption: {
    backgroundColor: colors.panel,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    minHeight: 44,
    padding: space[3],
  },
  moveName: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
    fontWeight: type.displayBold.fontWeight,
  },
  moveHint: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  input: {
    backgroundColor: colors.ink,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: space[3],
  },
  splitRow: {
    flexDirection: "row",
    gap: space[2],
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
