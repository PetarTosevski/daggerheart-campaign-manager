import { Text, TextInput, View } from "react-native";

import { TRAIT_POOL } from "../../../../../../src/lib/domain/characters";
import { getAncestry, getClass, getSubclass, getTransformation, PORTRAITS, subclassesForClass, TRAIT_IDS, type TraitId } from "../../../../../../src/lib/srd";
import { pronounsFieldLabel } from "../../../../../../src/lib/validation/characters";

import {
  assignTrait,
  availableAncestries,
  availableClasses,
  availableCommunities,
  portraitOptions,
  suggestedTraits,
} from "./wizard-logic";
import { Button } from "../../../ui/button";
import { wizardStyles as s } from "./styles";
import { Choice, Group, HfMini, HopeFearTag, type StepProps } from "./wizard-ui";

const TRAITS: Record<TraitId, { label: string; verbs: string }> = {
  agility: { label: "Agility", verbs: "Sprint · Leap · Maneuver" },
  strength: { label: "Strength", verbs: "Lift · Smash · Grapple" },
  finesse: { label: "Finesse", verbs: "Control · Hide · Tinker" },
  instinct: { label: "Instinct", verbs: "Perceive · Sense · Navigate" },
  presence: { label: "Presence", verbs: "Charm · Perform · Deceive" },
  knowledge: { label: "Knowledge", verbs: "Recall · Analyze · Comprehend" },
};

export const traitLabel = (t: TraitId) => TRAITS[t].label;
export const formatModifier = (v: number) => (v > 0 ? `+${v}` : v === 0 ? "+0" : `−${Math.abs(v)}`);

export function ClassStep({ state, update, opts }: StepProps) {
  const cls = state.classId ? getClass(state.classId) : undefined;
  const sub = state.subclassId ? getSubclass(state.subclassId) : undefined;
  return (
    <View style={{ gap: 16 }}>
      <Group legend="Class">
        <View style={s.chipRow}>
          {availableClasses(opts).map((c) => (
            <Choice
              key={c.id}
              checked={state.classId === c.id}
              label={c.name}
              onPress={() =>
                update({ classId: c.id, subclassId: null, domainCards: [], classItem: null, background: [], connections: [] })
              }
            >
              <Text style={s.choiceTitle}>{c.name}</Text>
              {c.source === "hope-and-fear" ? <HopeFearTag /> : null}
              <Text style={s.hint}>
                Evasion {c.startingEvasion} · HP {c.startingHp}
              </Text>
            </Choice>
          ))}
        </View>
      </Group>
      {cls ? (
        <Group legend={`Subclass for ${cls.name}`}>
          <View style={s.chipRow}>
            {subclassesForClass(cls.id).map((subclass) => (
              <Choice
                key={subclass.id}
                checked={state.subclassId === subclass.id}
                label={subclass.name}
                onPress={() => update({ subclassId: subclass.id })}
              >
                <Text style={s.choiceTitle}>{subclass.name}</Text>
              </Choice>
            ))}
          </View>
          {sub?.description ? <Text style={s.lead}>{sub.description}</Text> : null}
        </Group>
      ) : null}
    </View>
  );
}

export function HeritageStep({ state, update, opts }: StepProps) {
  const ancestries = availableAncestries(opts);
  const communities = availableCommunities(opts);
  const shapeshifter = getTransformation("shapeshifter");
  const form = state.shapeForm ? getAncestry(state.shapeForm) : undefined;
  const mixed = state.ancestryMode === "mixed";

  return (
    <View style={{ gap: 16 }}>
      <Text style={s.lead}>
        Your heritage combines ancestry (lineage) and community (culture). Each grants features.
      </Text>
      <Group legend="Ancestry">
        <View style={s.chipRow}>
          {ancestries.map((a) => (
            <Choice
              key={a.id}
              checked={state.ancestryMode === "single" && state.ancestryId === a.id}
              label={a.name}
              onPress={() => update({ ancestryMode: "single", ancestryId: a.id })}
            >
              <Text style={s.choiceTitle}>{a.name}</Text>
              {a.source === "hope-and-fear" ? <HfMini /> : null}
            </Choice>
          ))}
          {opts.hopeAndFear && shapeshifter ? (
            <Choice
              checked={state.ancestryMode === "shapeshifter"}
              label="Shapeshifter"
              onPress={() => update({ ancestryMode: "shapeshifter" })}
            >
              <Text style={s.choiceTitle}>Shapeshifter</Text>
            </Choice>
          ) : null}
        </View>
      </Group>
      {mixed || state.ancestryMode === null ? (
        <Choice
          checked={mixed}
          label="Mixed ancestry"
          onPress={() => update({ ancestryMode: mixed ? null : "mixed" })}
          type="checkbox"
        >
          <Text style={s.choiceTitle}>Mixed ancestry</Text>
        </Choice>
      ) : null}
      {mixed ? (
        <Group legend="Mixed ancestries">
          <View style={s.chipRow}>
            {ancestries.map((a) => (
              <Choice
                key={`first-${a.id}`}
                checked={state.mixedFirst === a.id}
                label={`First ${a.name}`}
                onPress={() => update({ mixedFirst: a.id })}
              >
                <Text>{a.name}</Text>
              </Choice>
            ))}
          </View>
          <View style={s.chipRow}>
            {ancestries.map((a) => (
              <Choice
                key={`second-${a.id}`}
                checked={state.mixedSecond === a.id}
                disabled={state.mixedFirst === a.id}
                label={`Second ${a.name}`}
                onPress={() => update({ mixedSecond: a.id })}
              >
                <Text>{a.name}</Text>
              </Choice>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Mixed ancestry name"
            onChangeText={(mixedName) => update({ mixedName })}
            placeholder="Name for the mixed ancestry (optional)"
            style={s.input}
            value={state.mixedName}
          />
        </Group>
      ) : null}
      {state.ancestryMode === "shapeshifter" ? (
        <Group legend="Shapeshifter form">
          <View style={s.chipRow}>
            {ancestries.map((a) => (
              <Choice
                key={`form-${a.id}`}
                checked={state.shapeForm === a.id}
                label={a.name}
                onPress={() => update({ shapeForm: a.id, shapeFeature: null })}
              >
                <Text>{a.name}</Text>
              </Choice>
            ))}
          </View>
          {form ? (
            <View style={s.chipRow}>
              {form.features.map((f) => (
                <Choice
                  key={f.name}
                  checked={state.shapeFeature === f.name}
                  label={f.name}
                  onPress={() => update({ shapeFeature: f.name })}
                >
                  <Text style={s.choiceTitle}>{f.name}</Text>
                  <Text style={s.hint}>{f.text}</Text>
                </Choice>
              ))}
            </View>
          ) : null}
        </Group>
      ) : null}
      <Group legend="Community">
        <View style={s.chipRow}>
          {communities.map((c) => (
            <Choice
              key={c.id}
              checked={state.communityId === c.id}
              label={c.name}
              onPress={() => update({ communityId: c.id })}
            >
              <Text style={s.choiceTitle}>{c.name}</Text>
              {c.source === "hope-and-fear" ? <HfMini /> : null}
            </Choice>
          ))}
        </View>
      </Group>
    </View>
  );
}

export function TraitsStep({ state, update }: StepProps) {
  const values = [2, 1, 0, -1];
  const used = (v: number) => TRAIT_IDS.filter((t) => state.traits[t] === v).length;
  const copies = (v: number) => TRAIT_POOL.filter((x) => x === v).length;
  const suggestion = suggestedTraits(state.classId);
  return (
    <View style={{ gap: 16 }}>
      <Text style={s.lead}>
        Assign +2, +1, +1, +0, +0, −1 to your six traits in any order.
      </Text>
      {suggestion ? (
        <Button onPress={() => update({ traits: suggestion })} variant="outline">
          Use suggested
        </Button>
      ) : null}
      {TRAIT_IDS.map((t) => {
        const value = state.traits[t];
        return (
          <View key={t} accessibilityRole="radiogroup" style={{ gap: 8 }}>
            <Text style={s.choiceTitle}>{TRAITS[t].label}</Text>
            <Text style={s.hint}>{TRAITS[t].verbs}</Text>
            <View style={s.chipRow}>
              {values.map((v) => {
                const full = value !== v && used(v) >= copies(v);
                return (
                  <Choice
                    key={v}
                    checked={value === v}
                    disabled={full}
                    label={`${TRAITS[t].label} ${formatModifier(v)}`}
                    onPress={() => update({ traits: assignTrait(state.traits, t, v) })}
                  >
                    <Text>{formatModifier(v)}</Text>
                  </Choice>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function InfoStep({ state, update }: StepProps) {
  const portraits = portraitOptions(state).filter((p) => PORTRAITS[p.key]);
  return (
    <View style={{ gap: 16 }}>
      <Text style={s.label}>Character name</Text>
      <TextInput
        accessibilityLabel="Character name"
        maxLength={80}
        onChangeText={(name) => update({ name })}
        placeholder="Name your hero"
        style={s.input}
        value={state.name}
      />
      <Text style={s.label}>{pronounsFieldLabel(state.pronounsLabel)}</Text>
      <TextInput
        accessibilityLabel={state.pronounsLabel === "pronouns" ? "Pronouns" : "Gender"}
        maxLength={80}
        onChangeText={(pronouns) => update({ pronouns })}
        placeholder={state.pronounsLabel === "pronouns" ? "e.g. she/her (optional)" : "Optional"}
        style={s.input}
        value={state.pronouns}
      />
      <Text style={s.label}>Description (optional)</Text>
      <TextInput
        accessibilityLabel="Description"
        maxLength={2000}
        multiline
        onChangeText={(description) => update({ description })}
        style={[s.input, s.textArea]}
        value={state.description}
      />
      {portraits.length > 0 ? (
        <Group legend="Portrait">
          <View style={s.chipRow}>
            <Choice
              checked={state.portrait === "none"}
              label="No portrait"
              onPress={() => update({ portrait: "none" })}
            >
              <Text>None</Text>
            </Choice>
            {portraits.map((p) => (
              <Choice
                key={p.key}
                checked={(state.portrait ?? portraits[0]?.key) === p.key}
                label={p.label}
                onPress={() => update({ portrait: p.key })}
              >
                <Text>{p.label}</Text>
              </Choice>
            ))}
          </View>
        </Group>
      ) : null}
    </View>
  );
}
