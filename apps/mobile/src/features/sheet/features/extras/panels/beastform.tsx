import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  EVOLVED,
  HYBRID,
  resolveBeastform,
  type BeastformState,
} from "../../../../../../../../src/lib/frames/extras/beastform";
import { TRAIT_LABEL, traitIdSchema } from "../../../../../../../../src/lib/frames/extras/common";
import { BEASTFORMS } from "../../../../../../../../src/lib/srd/beastforms";
import type { TraitId } from "../../../../../../../../src/lib/srd/types";
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
  FeatureLabel,
  FeatureNote,
  FeatureSection,
} from "../../ui";

const TRAITS = traitIdSchema.options;
const TIERS = [1, 2, 3, 4] as const;
const TIER_LEVELS: Record<(typeof TIERS)[number], string> = {
  1: "Level 1",
  2: "Level 2–4",
  3: "Level 5–7",
  4: "Level 8–10",
};
const plain = (maxTier: number) =>
  BEASTFORMS.filter((b) => b.tier <= maxTier && !EVOLVED[b.id] && !HYBRID[b.id]);

function statLine(
  form: { traitBonus?: { trait: TraitId; bonus: number } | null; evasionBonus?: number | null; attack?: { range: string; trait: TraitId; damage: string } | null },
  evolutionTrait?: TraitId | null,
): string {
  return [
    form.traitBonus ? `${TRAIT_LABEL[form.traitBonus.trait]} +${form.traitBonus.bonus}` : null,
    form.evasionBonus ? `Evasion +${form.evasionBonus}` : null,
    form.attack ? `${form.attack.range} ${TRAIT_LABEL[form.attack.trait]} ${form.attack.damage}` : null,
    evolutionTrait ? `Evolution: ${TRAIT_LABEL[evolutionTrait]} +1` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

export function BeastformPanel({
  characterId,
  state,
  tier,
  canEdit,
}: {
  characterId: Id<"characters">;
  state: BeastformState;
  tier: number;
  canEdit: boolean;
}) {
  const set = useIntent(api.characterExtras.setBeastform);
  const [draft, setDraft] = useState<BeastformState>({ formId: null });
  const active = resolveBeastform(state);
  const chosen = draft.formId ? BEASTFORMS.find((b) => b.id === draft.formId) : undefined;
  const evolved = chosen ? EVOLVED[chosen.id] : undefined;
  const hybrid = chosen ? HYBRID[chosen.id] : undefined;
  const sources = (draft.hybrid?.sources ?? [])
    .map((id) => BEASTFORMS.find((b) => b.id === id))
    .filter((b): b is NonNullable<typeof b> => !!b);

  const pickForm = (formId: string | null) =>
    setDraft({ formId, ...(draft.evolutionTrait && formId ? { evolutionTrait: draft.evolutionTrait } : {}) });
  const setHybrid = (patch: Partial<NonNullable<BeastformState["hybrid"]>>) =>
    setDraft({
      ...draft,
      hybrid: { sources: [], advantages: [], features: [], ...draft.hybrid, ...patch },
    });
  const toggle = (list: string[], item: string) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  return (
    <View style={styles.stack}>
      <FeatureNote>
        Mark a Stress to magically transform into a creature of your tier or lower. While transformed you can’t use weapons or cast spells from domain cards.
      </FeatureNote>

      {active ? (
        <View style={styles.current}>
          <FeatureLabel>Current form</FeatureLabel>
          <Text style={styles.formName}>{active.name}</Text>
          <Text style={styles.examples}>{`(${active.examples})`}</Text>
          <Text style={styles.stat}>{statLine(active, active.evolutionTrait)}</Text>
          {active.advantages.length ? (
            <Text style={styles.stat}>{`Advantage on: ${active.advantages.join(", ")}`}</Text>
          ) : null}
          {active.features.map((f) => (
            <Text key={f.name} style={styles.featText}>
              <Text style={styles.strong}>{f.name}: </Text>
              {f.text}
            </Text>
          ))}
          {canEdit ? (
            <Button
              accessibilityLabel="Drop beastform"
              disabled={set.pending}
              onPress={() => void set.fire({ characterId, state: { formId: null } })}
              variant="outline"
            >
              Drop beastform
            </Button>
          ) : null}
        </View>
      ) : (
        <FeatureNote>Not transformed.</FeatureNote>
      )}
      <FeatureError error={set.error} />

      {TIERS.map((t) => {
        const locked = t > tier;
        return (
          <View key={t} style={styles.tier}>
            <Text style={styles.plaque}>{`Tier ${t} (${TIER_LEVELS[t]})`}</Text>
            {locked ? <FeatureNote>Unlocks at a higher tier</FeatureNote> : null}
            {BEASTFORMS.filter((b) => b.tier === t).map((b) => {
              const on = draft.formId === b.id;
              return (
                <View
                  key={b.id}
                  style={[styles.form, (on || active?.form.id === b.id) ? styles.formOn : null]}
                >
                  <Text style={styles.formName}>{b.name}</Text>
                  <Text style={styles.examples}>{`(${b.examples})`}</Text>
                  {statLine(b) ? <Text style={styles.stat}>{statLine(b)}</Text> : null}
                  {b.advantages.length ? (
                    <Text style={styles.stat}>{`Gain advantage on: ${b.advantages.join(", ")}`}</Text>
                  ) : null}
                  {b.features.map((f) => (
                    <Text key={f.name} style={styles.featText}>
                      <Text style={styles.strong}>{f.name}: </Text>
                      {f.text}
                    </Text>
                  ))}
                  {canEdit && !locked ? (
                    <Button
                      accessibilityLabel={`Choose ${b.name}`}
                      onPress={() => pickForm(on ? null : b.id)}
                      variant={on ? "primary" : "solid"}
                    >
                      {on ? "Chosen" : "Choose"}
                    </Button>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      })}

      {chosen && canEdit ? (
        <FeatureSection accessibilityLabel="Beastform options" title="Form options">
          {evolved ? (
            <View style={styles.block}>
              <FeatureLabel>Upgraded form</FeatureLabel>
              {plain(Math.max(...evolved.baseTiers)).map((b) => (
                <CheckOption
                  key={b.id}
                  label={`${b.name} (Tier ${b.tier})`}
                  checked={draft.baseFormId === b.id}
                  onPress={() =>
                    setDraft({ ...draft, baseFormId: draft.baseFormId === b.id ? undefined : b.id })
                  }
                />
              ))}
            </View>
          ) : null}

          {hybrid ? (
            <View style={styles.block}>
              <FeatureLabel>{`Combine ${hybrid.sources} forms, ${hybrid.advantages} advantages, ${hybrid.features} features`}</FeatureLabel>
              {plain(hybrid.maxTier).map((b) => {
                const picked = draft.hybrid?.sources.includes(b.id) ?? false;
                return (
                  <CheckOption
                    key={b.id}
                    label={b.name}
                    checked={picked}
                    onPress={() =>
                      setHybrid({
                        sources: toggle(draft.hybrid?.sources ?? [], b.id),
                        advantages: [],
                        features: [],
                      })
                    }
                  />
                );
              })}
              {sources.length ? (
                <>
                  <FeatureLabel>Advantages</FeatureLabel>
                  {[...new Set(sources.flatMap((s) => s.advantages))].map((adv) => {
                    const picked = draft.hybrid?.advantages.includes(adv) ?? false;
                    return (
                      <CheckOption
                        key={adv}
                        label={adv}
                        checked={picked}
                        onPress={() =>
                          setHybrid({ advantages: toggle(draft.hybrid?.advantages ?? [], adv) })
                        }
                      />
                    );
                  })}
                  <FeatureLabel>Features</FeatureLabel>
                  {[...new Set(sources.flatMap((s) => s.features.map((f) => f.name)))].map((name) => {
                    const picked = draft.hybrid?.features.includes(name) ?? false;
                    return (
                      <CheckOption
                        key={name}
                        label={name}
                        checked={picked}
                        onPress={() =>
                          setHybrid({ features: toggle(draft.hybrid?.features ?? [], name) })
                        }
                      />
                    );
                  })}
                </>
              ) : null}
            </View>
          ) : null}

          <View style={styles.block}>
            <FeatureLabel>Evolution trait (spent 3 Hope)</FeatureLabel>
            <CheckOption
              label="None"
              checked={!draft.evolutionTrait}
              onPress={() => setDraft({ ...draft, evolutionTrait: undefined })}
            />
            {TRAITS.map((t) => (
              <CheckOption
                key={t}
                label={`${TRAIT_LABEL[t]} +1`}
                checked={draft.evolutionTrait === t}
                onPress={() =>
                  setDraft({ ...draft, evolutionTrait: draft.evolutionTrait === t ? undefined : (t as TraitId) })
                }
              />
            ))}
          </View>

          <View style={styles.block}>
            <Button
              accessibilityLabel="Transform"
              disabled={set.pending}
              onPress={() => void set.fire({ characterId, state: draft })}
              variant="solid"
            >
              Transform
            </Button>
            <Button accessibilityLabel="Cancel" onPress={() => pickForm(null)} variant="outline">
              Cancel
            </Button>
            <FeatureNote>Mark the Stress (or spend 3 Hope for Evolution) on your sheet.</FeatureNote>
          </View>
        </FeatureSection>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  current: {
    borderColor: colors.brand,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[1],
    padding: space[3],
  },
  tier: { gap: space[2] },
  plaque: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 17,
    fontWeight: type.displayBold.fontWeight,
  },
  form: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[1],
    padding: space[3],
  },
  formOn: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
  },
  formName: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 16,
    fontWeight: type.displayBold.fontWeight,
  },
  examples: {
    color: colors.mutedText,
    fontFamily: type.serifItalic.fontFamily,
    fontSize: 14,
    fontStyle: "italic",
  },
  stat: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  featText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  strong: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontWeight: type.sansSemibold.fontWeight,
  },
  block: { gap: space[2] },
});
