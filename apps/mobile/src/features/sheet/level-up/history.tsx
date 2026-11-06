import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { availableOptions, offersOption, OPTION_ORDER, OPTION_RULES, picksFor, TIERS, type Tier } from "../../../../../../src/lib/domain/level-up";
import { MAX_LEVEL, tierForLevel } from "../../../../../../src/lib/domain/characters";
import { TRAIT_IDS } from "../../../../../../src/lib/srd/types";
import type { AdvancementOption, CharacterSheet } from "../../../../../../src/lib/validation/characters";

import { api } from "../../../convex";
import type { Id } from "../../../convex";
import { useIntent } from "../intent";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { Section } from "../chrome";

import { useLevelUpDraft } from "./draft";
import { OPTION_SHORT, OPTION_TEXT, traitLabel } from "../../../../../../src/lib/party/level-up";

const UNLOCK_LEVEL = { 2: 2, 3: 5, 4: 8 } as const;

export function AdvancementHistory({ sheet, hopeAndFear }: { sheet: CharacterSheet; hopeAndFear: boolean }) {
  const lu = useLevelUpDraft();
  const drafting = lu.active;
  const options = availableOptions({ ...sheet, level: Math.min(sheet.level, MAX_LEVEL - 1) });
  const total = 2 * (sheet.level - 1);
  const used = sheet.advancements.reduce((sum, a) => sum + a.picks.reduce((s, p) => s + OPTION_RULES[p.option].cost, 0), 0);
  const current = tierForLevel(drafting ? lu.level : sheet.level);

  return (
    <Section title="Level Up">
      <Text style={styles.budget}>
        {total ? `${used} / ${total} advancements used` : "No advancements yet"}
        {drafting ? ` · Level ${lu.level}: ${lu.picksUsed} / 2 picks` : ""}
      </Text>
      <Text style={styles.hint}>
        {drafting
          ? `Tick two options for level ${lu.level} in tier ${current} or below.`
          : total
            ? "2 per level gained. Spend them in your current tier or any tier below it."
            : "Reach level 2 to choose your first advancements."}
      </Text>
      {TIERS.map((tier) => {
        const locked = tier > current;
        return (
          <View key={tier} style={[styles.tier, locked && styles.tierLocked]}>
            <Text accessibilityRole="header" style={styles.tierTitle}>
              Tier {tier}
            </Text>
            {locked ? <Text style={styles.locked}>Reach level {UNLOCK_LEVEL[tier]} to unlock</Text> : null}
            {OPTION_ORDER.filter((o) => tier >= OPTION_RULES[o].fromTier && offersOption(sheet, o)).map((option) => {
              const taken = picksFor(sheet, tier, option);
              const blocked = options.find((o) => o.tier === tier && o.option === option)?.blocked ?? null;
              const crossed = taken.length === 0 && Boolean(blocked) && !blocked?.startsWith("Reach");
              if (drafting && !locked) {
                return (
                  <DraftOption
                    blocked={blocked}
                    crossed={crossed}
                    hopeAndFear={hopeAndFear}
                    key={option}
                    option={option}
                    sheet={sheet}
                    taken={taken}
                    tier={tier}
                  />
                );
              }
              return (
                <View key={option} style={styles.option}>
                  <Text style={[styles.optionText, crossed && styles.crossed]}>
                    {OPTION_TEXT[option]}
                    {taken.length > 0 ? ` (level ${taken.map((t) => t.level).join(", ")})` : ""}
                  </Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </Section>
  );
}

function DraftOption({
  sheet,
  tier,
  option,
  taken,
  blocked,
  crossed,
}: {
  sheet: CharacterSheet;
  tier: Tier;
  option: AdvancementOption;
  taken: ReturnType<typeof picksFor>;
  blocked: string | null;
  crossed: boolean;
  hopeAndFear: boolean;
}) {
  const { level, draft, picksUsed, togglePick, setPickTargets } = useLevelUpDraft();
  const rule = OPTION_RULES[option];
  const joined = rule.cost === 2;
  const drafted = draft.picks.filter((p) => p.option === option && p.tier === tier).length;
  let reason: string | null = null;
  if (taken.length + drafted < (joined ? 1 : rule.slots)) {
    if (blocked) reason = blocked;
    else if (picksUsed + rule.cost > 2) reason = joined && picksUsed < 2 ? "It takes both picks; untick your other pick first." : "Both picks for this level are used.";
  }

  return (
    <View style={styles.option}>
      <View style={styles.row}>
        <Pressable
          accessibilityLabel={`Tier ${tier}: ${OPTION_SHORT[option]} for level ${level}`}
          accessibilityState={{ disabled: reason !== null || crossed }}
          disabled={reason !== null || crossed}
          onPress={() => togglePick(option, tier, true)}
          style={styles.tick}
        >
          <Text style={styles.tickLabel}>{drafted > 0 ? "☑" : "☐"}</Text>
        </Pressable>
        <Text style={[styles.optionText, crossed && styles.crossed]}>{OPTION_SHORT[option]}</Text>
      </View>
      {reason ? <Text style={styles.reason}>{reason}</Text> : null}
      {option === "traits" && drafted > 0 ? (
        <TraitPicker
          onPick={(targets) => setPickTargets("traits", tier, targets, 0)}
          sheet={sheet}
          targets={draft.picks.find((p) => p.option === "traits" && p.tier === tier)?.targets ?? []}
        />
      ) : null}
    </View>
  );
}

function TraitPicker({
  sheet,
  targets,
  onPick,
}: {
  sheet: CharacterSheet;
  targets: string[];
  onPick: (targets: string[]) => void;
}) {
  const unmarked = TRAIT_IDS.filter((id) => (sheet.traitMarks[id] ?? 0) === 0 && !targets.includes(id));
  return (
    <View style={styles.picker}>
      <Text style={styles.pickerHint}>Pick two unmarked traits.</Text>
      {targets.map((id) => (
        <Text key={id} style={styles.picked}>
          {traitLabel(id)}
        </Text>
      ))}
      {unmarked.map((id) => (
        <Button
          key={id}
          onPress={() => {
            const next = [...targets, id];
            onPick(next.length <= 2 ? next : next.slice(-2));
          }}
          variant="outline"
        >
          {traitLabel(id)}
        </Button>
      ))}
    </View>
  );
}

export function CorrectLevel({ characterId, level, isGm }: { characterId: Id<"characters">; level: number; isGm: boolean }) {
  const [value, setValue] = useState(String(level));
  const { fire, error, pending } = useIntent(api.levelUp.correctLevel);
  if (!isGm) return null;
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL && n !== level;
  return (
    <View style={styles.correct}>
      <Text style={styles.correctLabel}>GM correction: set the level (no automation)</Text>
      <TextInput
        accessibilityLabel="GM correction level"
        keyboardType="number-pad"
        onChangeText={setValue}
        style={styles.input}
        value={value}
      />
      <Button disabled={!valid || pending} onPress={() => void fire({ characterId, level: n })}>
        Set level
      </Button>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  budget: { color: colors.ink, fontFamily: type.sans.fontFamily, fontSize: 15, fontWeight: "600" },
  hint: { color: colors.body, fontFamily: type.sans.fontFamily, fontSize: 14, marginBottom: space[3] },
  tier: {
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    marginBottom: space[3],
    padding: space[3],
  },
  tierLocked: { opacity: 0.65 },
  tierTitle: { color: colors.ink, fontFamily: type.displayBold.fontFamily, fontSize: 16 },
  locked: { color: colors.mutedText, fontFamily: type.sans.fontFamily, fontSize: 13 },
  option: { gap: 4, marginTop: space[2] },
  row: { alignItems: "center", flexDirection: "row", gap: space[2] },
  tick: { minHeight: 44, minWidth: 44, justifyContent: "center" },
  tickLabel: { color: colors.ink, fontSize: 20 },
  optionText: { color: colors.body, flex: 1, fontFamily: type.sans.fontFamily, fontSize: 14 },
  crossed: { textDecorationLine: "line-through" },
  reason: { color: colors.mutedText, fontFamily: type.sans.fontFamily, fontSize: 13 },
  picker: { gap: space[2], marginLeft: space[6] },
  pickerHint: { color: colors.body, fontFamily: type.sans.fontFamily, fontSize: 13 },
  picked: { color: colors.ink, fontFamily: type.sans.fontFamily, fontSize: 14 },
  correct: { gap: space[2], marginTop: space[4] },
  correctLabel: { color: colors.body, fontFamily: type.sans.fontFamily, fontSize: 14 },
  input: {
    backgroundColor: colors.parchment,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    maxWidth: 120,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  error: { color: colors.danger, fontFamily: type.sans.fontFamily, fontSize: 14 },
});
