import { useQuery } from "convex/react";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import type { RollRecord } from "../../../../../../src/lib/domain/duality";
import { TRAIT_IDS, type TraitId } from "../../../../../../src/lib/srd/types";
import { api, type Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { RollResult } from "../../../ui/roll-result";
import { traitLabel } from "../catalog";
import type { SheetCharacter } from "../types";
import { useIntent } from "./intent";
import { rollHeadline } from "./roll-copy";

const COST = 3;

export type PendingTagTeam = {
  entryId: Id<"actionLog">;
  rolls: { characterId: Id<"characters">; entryId: Id<"actionLog">; roll: RollRecord; name: string }[];
};

export function TagTeam({
  campaignId,
  character,
  disabled,
  pending,
}: {
  campaignId: Id<"campaigns">;
  character: SheetCharacter;
  disabled: boolean;
  pending: PendingTagTeam | null;
}) {
  const writes = useWritesEnabled();
  const [open, setOpen] = useState(false);
  const party = useQuery(api.characters.listByCampaign, open || pending !== null ? { campaignId } : "skip");
  const [partnerId, setPartnerId] = useState("");
  const [mine, setMine] = useState<TraitId>("agility");
  const [theirs, setTheirs] = useState<TraitId>("agility");
  const [difficulty, setDifficulty] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const start = useIntent(api.rolls.tagTeam);
  const apply = useIntent(api.rolls.tagTeamApply);

  const sheet = character.sheet;
  const used = (sheet as { featureUses?: { key: string }[] }).featureUses?.some((u) => u.key === "tagTeam") ?? false;
  const partners = (party ?? []).filter(
    (c) =>
      c._id !== character._id &&
      c.status === "active" &&
      !((c.sheet as { conditions?: string[] }).conditions ?? []).includes("unconscious") &&
      !(c as { corrupt?: boolean }).corrupt,
  );
  const partner = partners.find((c) => c._id === partnerId);

  async function begin() {
    if (!partner) return;
    setApplied(null);
    const diff = Number.parseInt(difficulty, 10);
    const out = await start.fire({
      characterId: character._id,
      partnerId: partner._id,
      ...(Number.isFinite(diff) ? { difficulty: diff } : {}),
      initiator: { trait: mine, modifier: 0 },
      partner: { trait: theirs, modifier: 0 },
    });
    if (out) setOpen(true);
  }

  async function pick(entryId: Id<"actionLog">, pickId: Id<"characters">, name: string) {
    const out = await apply.fire({ entryId, pick: pickId });
    if (out) {
      setApplied(`${name}’s roll counts for both${out.fearGained > 0 ? `; the GM gains ${out.fearGained} Fear` : ""}.`);
    }
  }

  if (applied !== null && pending === null) {
    return (
      <View accessibilityLabel="Tag Team Roll" accessibilityRole="summary" style={styles.box}>
        <View style={styles.header}>
          <Text style={styles.label}>Tag Team Roll</Text>
          <Button onPress={() => { setApplied(null); setOpen(false); }} variant="pill">
            Close
          </Button>
        </View>
        <Text accessibilityRole="text" style={styles.status}>
          {applied}
        </Text>
      </View>
    );
  }

  if (!open && pending === null) {
    return (
      <Button disabled={disabled || !writes} onPress={() => setOpen(true)} variant="pill">
        Tag Team Roll…
      </Button>
    );
  }

  return (
    <View accessibilityLabel="Tag Team Roll" accessibilityRole="summary" style={styles.box}>
      <View style={styles.header}>
        <Text style={styles.label}>Tag Team Roll ({COST} Hope, once per session)</Text>
        {pending === null ? (
          <Button onPress={() => setOpen(false)} variant="pill">
            Close
          </Button>
        ) : null}
      </View>
      {used && pending === null ? (
        <Text style={styles.note}>You already started a Tag Team Roll this session.</Text>
      ) : null}
      {pending ? (
        <View style={styles.stack}>
          <Text style={styles.note}>Choose the roll that counts for both:</Text>
          {pending.rolls.map((r) => (
            <View key={r.entryId} style={styles.pickRow}>
              <Text style={styles.pickName}>
                {r.name}: {rollHeadline(r.roll)}
              </Text>
              <RollResult dice={r.roll.dice} />
              <Button disabled={apply.pending || !writes} onPress={() => void pick(pending.entryId, r.characterId, r.name)} variant="solid">
                {`Use ${r.name}’s roll`}
              </Button>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.stack}>
          <Text style={styles.fieldLabel}>Partner</Text>
          {party === undefined ? (
            <Text style={styles.note}>Loading the party…</Text>
          ) : (
            <View style={styles.chips}>
              {partners.map((c) => (
                <Button
                  key={c._id}
                  onPress={() => setPartnerId(c._id)}
                  variant={partnerId === c._id ? "solid" : "outline"}
                >
                  {c.sheet.name}
                </Button>
              ))}
            </View>
          )}
          <LabeledInput label="Difficulty" onChangeText={setDifficulty} placeholder="GM’s call" value={difficulty} />
          <Text style={styles.fieldLabel}>Your trait</Text>
          <TraitPick onPick={setMine} value={mine} />
          <Text style={styles.fieldLabel}>Partner’s trait</Text>
          <TraitPick onPick={setTheirs} value={theirs} />
          <Button
            disabled={disabled || !writes || used || !partner || sheet.hope < COST || start.pending}
            onPress={() => void begin()}
            variant="solid"
          >
            {`Roll together (${COST} Hope)`}
          </Button>
        </View>
      )}
      <Text accessibilityLiveRegion="polite" style={styles.error}>
        {start.error ?? apply.error ?? ""}
      </Text>
    </View>
  );
}

function TraitPick({ value, onPick }: { value: TraitId; onPick: (t: TraitId) => void }) {
  return (
    <View style={styles.chips}>
      {TRAIT_IDS.map((t) => (
        <Button key={t} onPress={() => onPick(t)} variant={value === t ? "solid" : "outline"}>
          {traitLabel(t)}
        </Button>
      ))}
    </View>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType="number-pad"
        onChangeText={(text) => onChangeText(text.replace(/[^0-9]/g, "").slice(0, 2))}
        placeholder={placeholder}
        placeholderTextColor={colors.subtle}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space[3],
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    justifyContent: "space-between",
  },
  label: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 15,
    fontWeight: type.sansSemibold.fontWeight,
  },
  stack: {
    gap: space[2],
  },
  note: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  status: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  pickRow: {
    gap: space[2],
  },
  pickName: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  fieldLabel: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  inputWrap: {
    gap: space[1],
  },
  input: {
    backgroundColor: colors.raised,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: space[3],
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
