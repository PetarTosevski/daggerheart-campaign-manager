import { StyleSheet, Text, TextInput, View } from "react-native";

import { ACHIEVEMENT_LEVELS } from "../../../../../../src/lib/domain/level-up";
import { achievementText, cardName, OPTION_SHORT, targetNames } from "../../../../../../src/lib/party/level-up";
import { CLASSES } from "../../../../../../src/lib/srd/classes";
import { DOMAINS } from "../../../../../../src/lib/srd/domain-cards";
import { SUBCLASSES } from "../../../../../../src/lib/srd/subclasses";
import type { CharacterSheet } from "../../../../../../src/lib/validation/characters";

import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";

import { useLevelUpDraft, type LevelUpDraftValue } from "./draft";

function Summary({ lu, sheet }: { lu: LevelUpDraftValue; sheet: CharacterSheet }) {
  const { draft, choice, level } = lu;
  const mc = choice.multiclass;
  return (
    <View accessibilityLabel="Your choices" style={styles.summary}>
      <Text style={styles.summaryLine}>
        Level {sheet.level} → {level}; damage thresholds +1.
      </Text>
      {ACHIEVEMENT_LEVELS.includes(level) ? (
        <Text style={styles.summaryLine}>
          {draft.experienceName.trim() ? `New Experience “${draft.experienceName.trim()}” +2; Proficiency +1.` : "New Experience: not named yet. Proficiency +1."}
        </Text>
      ) : null}
      {draft.picks.length === 0 ? <Text style={styles.summaryLine}>Advancements: none ticked yet.</Text> : null}
      {draft.picks.map((p, i) => (
        <Text key={`${p.tier}-${p.option}-${i}`} style={styles.summaryLine}>
          Tier {p.tier}: {OPTION_SHORT[p.option]}
          {targetNames(p, sheet)}
          {p.option === "multiclass" && mc
            ? `: ${CLASSES.find((c) => c.id === mc.classId)?.name ?? mc.classId}, ${DOMAINS.find((d) => d.id === mc.domainId)?.name ?? mc.domainId}, ${SUBCLASSES.find((s) => s.id === mc.subclassId)?.name ?? mc.subclassId}`
            : ""}
        </Text>
      ))}
      <Text style={styles.summaryLine}>{draft.cardId ? `Domain card: ${cardName(draft.cardId)}` : "Domain card: not chosen yet."}</Text>
      {choice.trade ? (
        <Text style={styles.summaryLine}>
          Exchange {cardName(choice.trade.out)} for {cardName(choice.trade.in)}
        </Text>
      ) : null}
    </View>
  );
}

function StepBody({ lu, sheet }: { lu: LevelUpDraftValue; sheet: CharacterSheet }) {
  const { step, draft, setExperienceName, setCardId } = lu;
  if (step === "experiences") {
    return (
      <View style={styles.stepBody}>
        <Text style={styles.stepHint}>Name the new Experience at +2.</Text>
        <TextInput
          accessibilityLabel="New Experience name"
          onChangeText={setExperienceName}
          placeholder="New Experience (+2)"
          style={styles.input}
          value={draft.experienceName}
        />
      </View>
    );
  }
  if (step === "deck") {
    return (
      <View style={styles.stepBody}>
        <Text style={styles.stepHint}>Choose the level domain card.</Text>
        <Button onPress={() => setCardId("get-back-up")} variant="outline">
          Take Get Back Up
        </Button>
        <Text style={styles.muted}>Selected: {draft.cardId ? cardName(draft.cardId) : "None"}</Text>
      </View>
    );
  }
  if (step === "advancements") {
    return <Text style={styles.stepHint}>Tick two options in the Level Up history below.</Text>;
  }
  if (step === "finish") {
    return <Summary lu={lu} sheet={sheet} />;
  }
  return null;
}

export function LevelUpRibbon() {
  const lu = useLevelUpDraft();
  const { active, sheet, steps, step, level, issues, goTo, cancel, finish, problems, pending, error } = lu;
  if (!active || !sheet) return null;
  const index = steps.findIndex((s) => s.id === step);
  const previous = steps[index - 1];
  const next = steps[index + 1];

  return (
    <View accessibilityLabel={`Level-up to ${level}`} style={styles.ribbon}>
      <Text accessibilityRole="header" style={styles.title}>
        Level-up to {level}
      </Text>
      <Text style={styles.ach}>{achievementText(level)}</Text>
      <View accessibilityLabel="Level-up steps" style={styles.steps}>
        {steps.map((s, i) => (
          <Button
            key={s.id}
            onPress={() => goTo(s.id)}
            variant={s.id === step ? "primary" : "outline"}
          >
            {`${s.done ? "✓ " : ""}${i + 1}. ${s.label}`}
          </Button>
        ))}
      </View>
      <StepBody lu={lu} sheet={sheet} />
      {step === "finish" && issues.length > 0 ? (
        <View style={styles.problems}>
          <Text accessibilityRole="header" style={styles.sub}>
            Still to do
          </Text>
          {issues.map((issue) => (
            <Button key={issue.message} onPress={() => goTo(issue.target)} variant="outline">
              {issue.message}
            </Button>
          ))}
        </View>
      ) : null}
      <View style={styles.nav}>
        {previous ? (
          <Button onPress={() => goTo(previous.id)} variant="outline">
            Back
          </Button>
        ) : null}
        {next && step !== "finish" ? (
          <Button onPress={() => goTo(next.id)} variant="outline">
            Next
          </Button>
        ) : null}
        <Button onPress={cancel} variant="outline">
          Cancel
        </Button>
        {step === "finish" ? (
          <Button disabled={problems.length > 0 || pending} onPress={() => void finish()}>
            Finish level-up
          </Button>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ribbon: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  title: { color: colors.ink, fontFamily: type.displayBold.fontFamily, fontSize: 20 },
  ach: { color: colors.body, fontFamily: type.sans.fontFamily, fontSize: 14 },
  steps: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  stepBody: { gap: space[2] },
  stepHint: { color: colors.body, fontFamily: type.sans.fontFamily, fontSize: 14 },
  input: {
    backgroundColor: colors.parchment,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  summary: { gap: 4 },
  summaryLine: { color: colors.body, fontFamily: type.sans.fontFamily, fontSize: 14 },
  problems: { gap: space[2] },
  sub: { color: colors.ink, fontFamily: type.sans.fontFamily, fontSize: 16, fontWeight: "600" },
  nav: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  error: { color: colors.danger, fontFamily: type.sans.fontFamily, fontSize: 14 },
  muted: { color: colors.mutedText, fontFamily: type.sans.fontFamily, fontSize: 13 },
});
