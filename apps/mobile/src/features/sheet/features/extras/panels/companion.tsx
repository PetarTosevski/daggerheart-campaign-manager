import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  COMPANION_EXPERIENCE_VALUE,
  companionStats,
  TRAINING,
  type CompanionState,
  type TrainingId,
} from "../../../../../../../../src/lib/frames/extras/companion";
import { api } from "../../../../../convex";
import type { Id } from "../../../../../convex";
import { colors } from "../../../../../theme/colors";
import { type } from "../../../../../theme/fonts";
import { radius, space } from "../../../../../theme/spacing";
import { Button } from "../../../../../ui/button";
import { useIntent } from "../../intent";
import {
  CheckOption,
  FeatureError,
  FeatureField,
  FeatureLabel,
  FeatureNote,
  FeatureSection,
} from "../../ui";
import { CorruptionPanel } from "./corruption";
import { Pips } from "./pips";

export function CompanionPanel({
  characterId,
  state,
  level,
  canEdit,
}: {
  characterId: Id<"characters">;
  state: CompanionState;
  level: number;
  canEdit: boolean;
}) {
  const save = useIntent(api.characterExtras.saveCompanion);
  // Only the fields edited here (dcm-gdzi.20): everything else, Stress included, always reads the saved state, so a
  // Stress pip saved meanwhile is never written back by Save.
  const [edits, setEdits] = useState<Partial<Omit<CompanionState, "stress">>>({});
  const draft: CompanionState = { ...state, ...edits };
  const stats = companionStats(draft, level);
  const saved = companionStats(state, level);
  const dirty = (Object.keys(edits) as (keyof typeof edits)[]).some((k) => JSON.stringify(edits[k]) !== JSON.stringify(state[k]));
  const ro = !canEdit;
  const patch = (p: Partial<Omit<CompanionState, "stress">>) => setEdits((current) => ({ ...current, ...p }));

  async function saveEdits() {
    const done = await save.fire({ characterId, state: { ...state, ...edits } });
    if (done !== undefined) setEdits({});
  }

  const setTraining = (id: TrainingId, n: number) => {
    const training = { ...draft.training, [id]: n };
    if (n === 0) delete training[id];
    const vicious =
      id === "vicious"
        ? [...draft.vicious.slice(0, n), ...Array<"die">(Math.max(0, n - draft.vicious.length)).fill("die")]
        : draft.vicious;
    patch({ training, vicious });
  };

  return (
    <View style={styles.stack}>
      <FeatureSection accessibilityLabel="Companion identity" title="Companion">
        <FeatureField label="Name" value={draft.name} onChangeText={(v) => patch({ name: v })} maxLength={80} />
        <FeatureField label="Animal" value={draft.kind} onChangeText={(v) => patch({ kind: v })} maxLength={80} />
      </FeatureSection>

      <FeatureSection accessibilityLabel="Attack and damage" title="Attack & Damage">
        <FeatureField
          label="Attack"
          value={draft.attack.name}
          onChangeText={(v) => patch({ attack: { ...draft.attack, name: v } })}
          maxLength={80}
        />
        <Text style={styles.line}>
          <Text style={styles.labelInline}>Range: </Text>
          {stats.range}
        </Text>
        <Text style={styles.line}>
          <Text style={styles.labelInline}>Damage: </Text>
          {`d${stats.damageDie}`}
        </Text>
        <FeatureLabel>Damage type</FeatureLabel>
        <CheckOption
          label="Physical"
          checked={draft.attack.damageType === "phy"}
          onPress={() => patch({ attack: { ...draft.attack, damageType: "phy" } })}
        />
        <CheckOption
          label="Magic"
          checked={draft.attack.damageType === "mag"}
          onPress={() => patch({ attack: { ...draft.attack, damageType: "mag" } })}
        />
        <FeatureNote>
          When you command your companion to attack, their damage roll uses your Proficiency and their damage die.
        </FeatureNote>
      </FeatureSection>

      <FeatureSection accessibilityLabel="Companion defense" title="Defense">
        <FeatureLabel>{`Stress ${state.stress} / ${saved.stressMax}`}</FeatureLabel>
        <Pips
          label="Companion Stress"
          marked={state.stress}
          total={saved.stressMax}
          disabled={ro || save.pending}
          onSet={(stress) => void save.fire({ characterId, state: { ...state, stress } })}
        />
        <Text style={styles.evasion}>{`${stats.evasion} Evasion`}</Text>
        {saved.out ? (
          <Text style={styles.warn}>
            Your companion has dropped out of the scene; they return with 1 Stress cleared at your next long rest.
          </Text>
        ) : null}
      </FeatureSection>

      <FeatureSection accessibilityLabel="Companion experiences" title="Experiences">
        <FeatureLabel>{`${draft.experiences.length} / ${stats.experienceLimit}`}</FeatureLabel>
        {draft.experiences.map((exp, i) => (
          <View key={i} style={styles.expRow}>
            <View style={styles.expName}>
              <FeatureField
                label={`Experience ${i + 1}`}
                value={exp.name}
                onChangeText={(v) =>
                  patch({
                    experiences: draft.experiences.map((x, j) => (j === i ? { ...x, name: v } : x)),
                  })
                }
                maxLength={80}
              />
            </View>
            <View style={styles.expValue}>
              <FeatureField
                label={`Experience ${i + 1} modifier`}
                value={String(exp.value)}
                onChangeText={(v) =>
                  patch({
                    experiences: draft.experiences.map((x, j) =>
                      j === i ? { ...x, value: Number(v.replace(/[^0-9-]/g, "")) || 0 } : x,
                    ),
                  })
                }
                keyboardType="number-pad"
              />
            </View>
            {canEdit ? (
              <Button
                accessibilityLabel={`Remove Experience ${i + 1}`}
                onPress={() => patch({ experiences: draft.experiences.filter((_, j) => j !== i) })}
                variant="outline"
              >
                Remove
              </Button>
            ) : null}
          </View>
        ))}
        {canEdit && draft.experiences.length < stats.experienceLimit ? (
          <Button
            accessibilityLabel="Add Experience"
            onPress={() =>
              patch({
                experiences: [...draft.experiences, { name: "", value: COMPANION_EXPERIENCE_VALUE }],
              })
            }
            variant="solid"
          >
            {`Add Experience (+${COMPANION_EXPERIENCE_VALUE})`}
          </Button>
        ) : null}
      </FeatureSection>

      <FeatureSection accessibilityLabel="Companion training" title="Training">
        <FeatureLabel>{`${stats.trainingUsed} / ${stats.trainingCap}`}</FeatureLabel>
        {TRAINING.map((t) => {
          const n = draft.training[t.id] ?? 0;
          return (
            <View key={t.id} style={styles.trainingRow}>
              <Text style={styles.trainingTitle}>
                <Text style={styles.strong}>{t.name}: </Text>
                {t.text}
              </Text>
              <View style={styles.trainingPips}>
                {Array.from({ length: t.max }, (_, k) => {
                  const on = k < n;
                  const atCap = n >= stats.trainingCap && !on;
                  const unreachable = k > n;
                  return (
                    <Button
                      key={k}
                      accessibilityLabel={`${t.name} ${k + 1}`}
                      disabled={ro || atCap || unreachable || (on && k !== n - 1)}
                      onPress={() => setTraining(t.id, on ? n - 1 : n + 1)}
                      variant={on ? "primary" : "outline"}
                    >
                      {on ? "●" : "○"}
                    </Button>
                  );
                })}
              </View>
              {t.id === "vicious" && n > 0 ? (
                <View style={styles.block}>
                  {draft.vicious.map((step, k) => (
                    <View key={k} style={styles.optionRow}>
                      <CheckOption
                        label={`Vicious ${k + 1}: Damage die`}
                        checked={step === "die"}
                        onPress={() =>
                          patch({
                            vicious: draft.vicious.map((x, j) => (j === k ? "die" : x)),
                          })
                        }
                      />
                      <CheckOption
                        label={`Vicious ${k + 1}: Range`}
                        checked={step === "range"}
                        onPress={() =>
                          patch({
                            vicious: draft.vicious.map((x, j) => (j === k ? "range" : x)),
                          })
                        }
                      />
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
        <FeatureLabel>Expert/Advanced Training options</FeatureLabel>
        {[0, 1, 3].map((n) => (
          <CheckOption
            key={n}
            label={n === 0 ? "None" : n === 1 ? "+1 (Expert Training)" : "+3 (Expert and Advanced Training)"}
            checked={draft.bonusTraining === n}
            onPress={() => patch({ bonusTraining: n })}
          />
        ))}
      </FeatureSection>

      <FeatureSection accessibilityLabel="Special gifts" title="Special Gifts">
        <FeatureField
          label="Special gifts"
          value={draft.gifts}
          onChangeText={(v) => patch({ gifts: v })}
          multiline
          maxLength={2000}
        />
      </FeatureSection>

      <FeatureSection accessibilityLabel="Companion inventory" title="Inventory">
        <FeatureField
          label="Companion inventory"
          value={draft.inventory}
          onChangeText={(v) => patch({ inventory: v })}
          multiline
          maxLength={2000}
        />
      </FeatureSection>

      {canEdit ? (
        <View style={styles.actions}>
          <Button
            accessibilityLabel="Save companion"
            disabled={!dirty || save.pending}
            onPress={() => void saveEdits()}
            variant="solid"
          >
            Save companion
          </Button>
          <Button
            accessibilityLabel="Discard changes"
            disabled={!dirty}
            onPress={() => setEdits({})}
            variant="outline"
          >
            Discard changes
          </Button>
        </View>
      ) : null}
      <FeatureError error={save.error} />

      <CorruptionPanel characterId={characterId} />

    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  line: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  labelInline: {
    color: colors.mutedText,
    fontFamily: type.sansMedium.fontFamily,
    fontWeight: type.sansMedium.fontWeight,
  },
  evasion: {
    color: colors.hope,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: type.displayBold.fontWeight,
  },
  warn: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  expRow: {
    flexDirection: "row",
    gap: space[2],
    alignItems: "flex-end",
  },
  expName: { flex: 2 },
  expValue: { width: 80 },
  trainingRow: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  trainingTitle: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  trainingPips: {
    flexDirection: "row",
    gap: space[2],
  },
  strong: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontWeight: type.sansSemibold.fontWeight,
  },
  block: { gap: space[2] },
  optionRow: { gap: space[1] },
  actions: { gap: space[2] },
});
