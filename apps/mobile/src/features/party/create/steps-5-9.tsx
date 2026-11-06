import { Text, TextInput, View } from "react-native";

import { TRAIT_LABEL, traitIdSchema } from "../../../../../../src/lib/frames/extras/common";
import { IKONIS_RANGES, IKONIS_TRAINING_CLASS_ID } from "../../../../../../src/lib/frames/extras/motherboard";
import { EXPERIENCE_SUGGESTIONS, getClass, getDomain, getSubclass, getWeapon, type Armor, type Weapon } from "../../../../../../src/lib/srd";
import { sharedCardNote, STARTING_EXPERIENCE_VALUE } from "../../../../../../src/lib/domain/characters";
import { PURPOSEFUL_DESIGN_BONUS } from "../../../../../../src/lib/domain/dice";

import {
  armorFor,
  classItemsFor,
  domainCardOptions,
  gearSummary,
  hasPurposefulDesign,
  POTIONS,
  primaryWeaponsFor,
  secondaryWeaponsFor,
  suggestedLoadout,
  toggleCard,
  toggleExperience,
} from "./wizard-logic";
import { Button } from "../../../ui/button";
import { wizardStyles as s } from "./styles";
import { traitLabel } from "./steps-1-4";
import { Choice, Group, type StepProps as BaseStepProps } from "./wizard-ui";

function WeaponLines({ w }: { w: Weapon }) {
  return (
    <>
      <Text style={s.choiceTitle}>{w.name}</Text>
      <Text style={s.hint}>
        {w.trait === "choice" ? "Any trait" : traitLabel(w.trait as never)} · {w.range}
      </Text>
      <Text style={s.hint}>
        {w.damage} · {w.burden}
      </Text>
    </>
  );
}

function ArmorLines({ a }: { a: Armor }) {
  return (
    <>
      <Text style={s.choiceTitle}>{a.name}</Text>
      <Text style={s.hint}>
        Thresholds {a.baseThresholds.major}/{a.baseThresholds.severe} · Armor {a.baseScore}
      </Text>
    </>
  );
}

function IkonisFields({ state, update }: Pick<BaseStepProps, "state" | "update">) {
  const ik = state.ikonis;
  const set = (patch: Partial<typeof ik>) => update({ ikonis: { ...ik, ...patch } });
  return (
    <Group legend="Ikonis">
      <Text style={s.hint}>
        Two-handed bonded weapon.{" "}
        {state.classId === IKONIS_TRAINING_CLASS_ID ? "Ikonis Training includes a Force augment." : "Starts with two augment slots."}
      </Text>
      <TextInput accessibilityLabel="Ikonis name" onChangeText={(name) => set({ name })} style={s.input} value={ik.name} />
      <View style={s.chipRow}>
        {traitIdSchema.options.map((t) => (
          <Choice
            key={t}
            checked={ik.trait === t}
            label={`Ikonis trait ${TRAIT_LABEL[t]}`}
            onPress={() => set({ trait: t })}
          >
            <Text>{TRAIT_LABEL[t]}</Text>
          </Choice>
        ))}
      </View>
      <View style={s.chipRow}>
        {IKONIS_RANGES.map((r) => (
          <Choice
            key={r.range}
            checked={ik.range === r.range}
            label={`Range ${r.range}`}
            onPress={() => set({ range: r.range })}
          >
            <Text>
              {r.range}: {r.damage}
            </Text>
          </Choice>
        ))}
      </View>
      <View style={s.chipRow}>
        {(["physical", "tech"] as const).map((damageType) => (
          <Choice
            key={damageType}
            checked={ik.damageType === damageType}
            label={`Damage type ${damageType}`}
            onPress={() => set({ damageType })}
          >
            <Text>{damageType}</Text>
          </Choice>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Ikonis description"
        multiline
        onChangeText={(description) => set({ description })}
        style={[s.input, s.textArea]}
        value={ik.description}
      />
    </Group>
  );
}

export function EquipmentStep({ state, update, opts }: BaseStepProps) {
  const cls = state.classId ? getClass(state.classId) : undefined;
  const sub = state.subclassId ? getSubclass(state.subclassId) : undefined;
  const primary = state.primaryWeaponId ? getWeapon(state.primaryWeaponId) : undefined;
  const twoHanded = primary?.burden === "two-handed";
  const loadout = suggestedLoadout(state, opts);
  const items = classItemsFor(cls);
  return (
    <View style={{ gap: 16 }}>
      {loadout ? (
        <Button
          onPress={() =>
            update(
              opts.ikonis
                ? { armorId: loadout.armorId }
                : { primaryWeaponId: loadout.primaryWeaponId, secondaryWeaponId: loadout.secondaryWeaponId, armorId: loadout.armorId },
            )
          }
          variant="outline"
        >
          {`Use suggested ${opts.ikonis ? "armor" : "loadout"}`}
        </Button>
      ) : null}
      {opts.ikonis ? <IkonisFields state={state} update={update} /> : null}
      {!opts.ikonis && sub?.spellcastTrait ? (
        <Text style={s.hint}>Spellcast trait: {traitLabel(sub.spellcastTrait as never)}.</Text>
      ) : null}
      {!opts.ikonis ? (
        <Group legend="Primary weapon">
          <View style={{ gap: 8 }}>
            {primaryWeaponsFor(state, opts).map((w) => (
              <Choice
                key={w.id}
                checked={state.primaryWeaponId === w.id}
                label={w.name}
                onPress={() =>
                  update({ primaryWeaponId: w.id, ...(w.burden === "two-handed" ? { secondaryWeaponId: null } : {}) })
                }
              >
                <WeaponLines w={w} />
              </Choice>
            ))}
          </View>
        </Group>
      ) : null}
      {!opts.ikonis ? (
        <Group legend="Secondary weapon">
          <Choice
            checked={!state.secondaryWeaponId}
            disabled={twoHanded}
            label="None"
            onPress={() => update({ secondaryWeaponId: null })}
          >
            <Text>None</Text>
          </Choice>
          {secondaryWeaponsFor(opts).map((w) => (
            <Choice
              key={w.id}
              checked={state.secondaryWeaponId === w.id}
              disabled={twoHanded}
              label={w.name}
              onPress={() => update({ secondaryWeaponId: w.id })}
            >
              <WeaponLines w={w} />
            </Choice>
          ))}
        </Group>
      ) : null}
      <Group legend="Armor">
        {armorFor(opts).map((a) => (
          <Choice key={a.id} checked={state.armorId === a.id} label={a.name} onPress={() => update({ armorId: a.id })}>
            <ArmorLines a={a} />
          </Choice>
        ))}
      </Group>
      <Text accessibilityLiveRegion="polite" style={s.hint}>
        {gearSummary(state)}
      </Text>
      <Group legend="Potion">
        <View style={s.chipRow}>
          {POTIONS.map((p) => (
            <Choice
              key={p.name}
              checked={state.potion === p.name}
              label={p.name}
              onPress={() => update({ potion: p.name })}
            >
              <Text>
                {p.name} ({p.effect})
              </Text>
            </Choice>
          ))}
        </View>
      </Group>
      {items.length > 0 ? (
        <Group legend="Class item">
          <View accessibilityRole="radiogroup" style={s.chipRow}>
            {items.map((item) => (
              <Choice
                key={item}
                checked={state.classItem === item}
                label={item}
                onPress={() => update({ classItem: item })}
              >
                <Text>{item}</Text>
              </Choice>
            ))}
          </View>
        </Group>
      ) : null}
    </View>
  );
}

function Questions({
  questions,
  answers,
  onChange,
  prefix,
}: {
  questions: readonly string[];
  answers: string[];
  onChange: (answers: string[]) => void;
  prefix: string;
}) {
  if (questions.length === 0) {
    return <Text style={s.hint}>Your class has no prompts here.</Text>;
  }
  return questions.map((q, i) => (
    <View key={q} style={{ gap: 8 }}>
      <Text style={s.lead}>{q}</Text>
      <TextInput
        accessibilityLabel={`${prefix}-${i}`}
        maxLength={2000}
        multiline
        onChangeText={(text) => {
          const next = questions.map((_, j) => answers[j] ?? "");
          next[i] = text;
          onChange(next);
        }}
        style={[s.input, s.textArea]}
        value={answers[i] ?? ""}
      />
    </View>
  ));
}

export function BackgroundStep({ state, update }: BaseStepProps) {
  const cls = state.classId ? getClass(state.classId) : undefined;
  return (
    <View style={{ gap: 16 }}>
      <Text style={s.lead}>Answer your class background questions, or leave them for play.</Text>
      <Questions
        answers={state.background}
        onChange={(background) => update({ background })}
        prefix="cc-bq"
        questions={cls?.backgroundQuestions ?? []}
      />
    </View>
  );
}

export function ConnectionsStep({ state, update }: BaseStepProps) {
  const cls = state.classId ? getClass(state.classId) : undefined;
  return (
    <View style={{ gap: 16 }}>
      <Text style={s.lead}>Suggest connections between your character and each other PC.</Text>
      <Questions
        answers={state.connections}
        onChange={(connections) => update({ connections })}
        prefix="cc-conn"
        questions={cls?.connectionQuestions ?? []}
      />
    </View>
  );
}

export function ExperiencesStep({ state, update, opts }: BaseStepProps) {
  const [a, b] = state.experiences;
  const chosen = [a.trim(), b.trim()];
  // Purposeful Design (Clank, CB p.53, DA11): the chosen Experience shows its permanent +1.
  const purposeful = hasPurposefulDesign(state, opts);
  const modifier = (i: 0 | 1) => STARTING_EXPERIENCE_VALUE + (purposeful && state.purposefulExperience === i ? PURPOSEFUL_DESIGN_BONUS : 0);
  return (
    <View style={{ gap: 16 }}>
      <Text style={s.lead}>Choose two Experiences at +2.</Text>
      <Text accessibilityLabel="First Experience" nativeID="cc-exp1" style={s.label}>
        First Experience
      </Text>
      <TextInput
        accessibilityLabel="First Experience"
        maxLength={80}
        onChangeText={(text) => update({ experiences: [text, b] })}
        placeholder="First Experience"
        style={s.input}
        value={a}
      />
      <Text accessibilityLabel={`First Experience modifier +${modifier(0)}`} style={s.hint}>
        +{modifier(0)}
      </Text>
      <Text accessibilityLabel="Second Experience" style={s.label}>
        Second Experience
      </Text>
      <TextInput
        accessibilityLabel="Second Experience"
        maxLength={80}
        onChangeText={(text) => update({ experiences: [a, text] })}
        placeholder="Second Experience"
        style={s.input}
        value={b}
      />
      <Text accessibilityLabel={`Second Experience modifier +${modifier(1)}`} style={s.hint}>
        +{modifier(1)}
      </Text>
      {purposeful ? (
        <Group legend="Purposeful Design · +1 to the Experience that best aligns with your purpose">
          <View style={s.chipRow}>
            {([0, 1] as const).map((i) => (
              <Choice
                checked={state.purposefulExperience === i}
                key={i}
                label={`Purposeful Design: ${chosen[i] || `Experience ${i + 1}`}`}
                onPress={() => update({ purposefulExperience: i })}
              >
                <Text>{chosen[i] || `Experience ${i + 1}`}</Text>
              </Choice>
            ))}
          </View>
        </Group>
      ) : null}
      {EXPERIENCE_SUGGESTIONS.map((group) => (
        <View key={group.category} style={{ gap: 8 }}>
          <Text style={s.label}>{group.category}</Text>
          <View style={s.chipRow}>
            {group.examples.map((x) => (
              <Choice
                key={x}
                checked={chosen.includes(x)}
                label={x}
                onPress={() => update({ experiences: toggleExperience(state.experiences, x) })}
                type="checkbox"
              >
                <Text>{x}</Text>
              </Choice>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function DomainCardsStep({ state, update, opts, shared }: BaseStepProps) {
  const picks = state.domainCards;
  return (
    <View style={{ gap: 16 }}>
      <Text style={s.lead}>Choose two level 1 cards from your class domains.</Text>
      <Text accessibilityLiveRegion="polite" style={s.count}>
        {picks.length} / 2 chosen
      </Text>
      {domainCardOptions(state.classId, opts).map((card) => {
        const on = picks.includes(card.id);
        // Shared domain cards (CB p.21, rule-switches OSC): Warn notes the card; Refuse also keeps it from being chosen.
        const note = shared ? sharedCardNote(shared.mode, shared.holders, card.id) : null;
        const refused = note !== null && shared?.mode === "refuse";
        const full = !on && (picks.length >= 2 || refused);
        const domain = getDomain(card.domain);
        return (
          <View key={card.id} style={[s.choice, full && { opacity: 0.5 }]}>
            <Text style={s.choiceTitle}>{card.name}</Text>
            <Text style={s.hint}>
              {domain?.name ?? card.domain} · Recall {card.recallCost}
            </Text>
            <Text style={s.lead}>{card.text}</Text>
            {note !== null ? (
              <Text style={refused ? s.error : s.hint} testID="shared-card-note">
                {refused ? `${note}; this campaign doesn't share domain cards.` : `${note}.`}
              </Text>
            ) : null}
            <Choice
              checked={on}
              disabled={full}
              label={note ? `Choose ${card.name} (${note})` : `Choose ${card.name}`}
              onPress={() => update({ domainCards: toggleCard(picks, card.id) })}
              type="checkbox"
            >
              <Text>{on ? "Chosen" : "Choose"}</Text>
            </Choice>
          </View>
        );
      })}
    </View>
  );
}
