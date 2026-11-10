import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useMutation, useQuery } from "convex/react";

import { rallyDieStress } from "../../../../../../src/lib/domain/class-features/held-dice";
import { classActions, hopeFeature } from "../../../../../../src/lib/domain/class-features/hooks";
import {
  CLASS_FEATURES,
  CLASS_STATE_LABELS,
  classFeaturesAvailable,
} from "../../../../../../src/lib/domain/class-features/index";
import type {
  FeatureInput,
  FeatureMeta,
} from "../../../../../../src/lib/domain/class-features/types";
import {
  currentPhase,
  holdsSlayer,
  holdsTide,
  slayerCapacity,
  slayerDice,
  tideCapacity,
  tideTokens,
} from "../../../../../../src/lib/domain/session-features";
import { costLabel, inputMissing } from "../../../../../../src/lib/party/features";
import type { CharacterSheet } from "../../../../../../src/lib/validation/characters";
import { api } from "../../../convex";
import type { Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { hit, radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import type { SheetSlotProps } from "../contract";
import type { SheetData } from "../types";
import { useFeatureIntent } from "./intent";
import { parseFeatureSheet } from "./parse-sheet";
import {
  ChipList,
  FeatureError,
  FeatureField,
  FeatureLabel,
  FeatureNote,
  FeatureRow,
  FeatureSection,
  FeatureStatus,
} from "./ui";

const TRAIT_LABEL = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

type PartyMember = { _id: Id<"characters">; status: string; sheet: { name: string } };

function AllyPicker({
  party,
  self,
  allowSelf,
  value,
  onChange,
  label,
}: {
  party: PartyMember[] | undefined;
  self: Id<"characters">;
  allowSelf: boolean;
  value: Id<"characters"> | "";
  onChange: (v: Id<"characters"> | "") => void;
  label: string;
}) {
  const writes = useWritesEnabled();
  const allies = (party ?? []).filter((c) => c._id !== self && c.status === "active");
  const noneLabel = allowSelf ? "Yourself" : "Choose an ally";
  return (
    <View style={styles.pickerField}>
      <FeatureLabel>{label}</FeatureLabel>
      <View accessibilityLabel={label} style={styles.optionList}>
        <Option
          selected={value === ""}
          label={noneLabel}
          disabled={!writes || party === undefined}
          onPress={() => onChange("")}
        />
        {allies.map((c) => (
          <Option
            key={c._id}
            selected={value === c._id}
            label={c.sheet.name}
            disabled={!writes || party === undefined}
            onPress={() => onChange(c._id)}
          />
        ))}
      </View>
    </View>
  );
}

function Option({
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
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.option, selected ? styles.optionOn : null]}
    >
      <Text style={selected ? styles.optionTextOn : styles.optionText}>
        {selected ? "●" : "○"} {label}
      </Text>
    </Pressable>
  );
}

function HeldDicePicker({
  sheet,
  input,
  value,
  onChange,
}: {
  sheet: CharacterSheet;
  input: Extract<FeatureInput, { kind: "heldDice" }>;
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const writes = useWritesEnabled();
  const held = (sheet.heldDice ?? []).filter((d) => d.kind === input.heldKind);
  if (held.length === 0) return <FeatureNote>None held.</FeatureNote>;
  return (
    <View style={styles.pickerField}>
      <FeatureLabel>{`${input.label} (default: the first)`}</FeatureLabel>
      {held.map((d, i) => {
        const on = value.includes(i);
        return (
          <Option
            key={d.id}
            label={`d${d.sides}${d.value !== undefined ? `: ${d.value}` : ""}`}
            selected={on}
            disabled={!writes}
            onPress={() => onChange(on ? value.filter((x) => x !== i) : [...value, i])}
          />
        );
      })}
    </View>
  );
}

function DamageDicePicker({
  characterId,
  value,
  onChange,
}: {
  characterId: Id<"characters">;
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const writes = useWritesEnabled();
  const roll = useQuery(api.classFeatures.lastRoll, { characterId });
  if (roll === undefined) return <FeatureNote>Loading your latest roll…</FeatureNote>;
  if (roll === null || roll.kind !== "damage") {
    return <FeatureNote>Roll damage first: your latest roll is not a damage roll.</FeatureNote>;
  }
  return (
    <View style={styles.pickerField}>
      <FeatureLabel>{`Dice to reroll (total ${roll.total})`}</FeatureLabel>
      {roll.dice.map((d, i) =>
        d.role === "damage" && !d.dropped ? (
          <Option
            key={i}
            label={`d${d.sides}: ${d.value}`}
            selected={value.includes(i)}
            disabled={!writes}
            onPress={() =>
              onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i])
            }
          />
        ) : null,
      )}
    </View>
  );
}

function FeatureCard({
  feature,
  parsed,
  character,
  campaignId,
  canEdit,
  blocked,
  party,
  variant,
}: {
  feature: FeatureMeta;
  parsed: CharacterSheet;
  character: SheetSlotProps["character"];
  campaignId: Id<"campaigns">;
  canEdit: boolean;
  blocked: string | null;
  party: PartyMember[] | undefined;
  variant: "hope" | "row";
}) {
  const applyFeature = useMutation(api.classFeatures.use);
  const { run, busy, error } = useFeatureIntent();
  const [target, setTarget] = useState<Id<"characters"> | "">("");
  const [choice, setChoice] = useState("");
  const [amount, setAmount] = useState("");
  const [dieIndexes, setDieIndexes] = useState<number[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const cost = costLabel(feature);
  const short = feature.cost?.hope !== undefined && parsed.hope < feature.cost.hope;
  const needsTarget = feature.target === "ally" && feature.key !== "witchsCharm";
  const inputs = feature.inputs ?? [];
  const missing =
    (needsTarget && target === "") ||
    inputs.some((i) => inputMissing(i, { choice, amount, dieIndexes, target }));
  const usable = canEdit && feature.use !== undefined;
  const message = canEdit
    ? (blocked ?? done ?? (short ? `Needs ${feature.cost?.hope} Hope.` : null))
    : done;
  const disabled = busy || blocked !== null || short || missing;

  async function submit() {
    setDone(null);
    const params = {
      ...(target ? { targetId: target } : {}),
      ...(choice.trim() ? { choice: choice.trim() } : {}),
      ...(amount !== "" ? { amount: Number(amount) } : {}),
      ...(dieIndexes.length ? { dieIndexes } : {}),
    };
    const ok = await run(async (idempotencyKey) => {
      const r = await applyFeature({
        characterId: character._id,
        featureKey: feature.key,
        params,
        idempotencyKey,
      });
      setDone(r.summary);
    });
    if (ok) {
      setDieIndexes([]);
      setChoice("");
      setAmount("");
    }
  }

  function renderInput(input: FeatureInput, i: number) {
    const key = `${feature.key}-${i}`;
    switch (input.kind) {
      case "text":
        return (
          <View key={key} style={styles.pickerField}>
            <FeatureLabel>{input.label}</FeatureLabel>
            <FeatureField
              label={input.label}
              value={choice}
              onChangeText={(v) => setChoice(v)}
              maxLength={60}
            />
          </View>
        );
      case "select": {
        const options = input.options(parsed);
        return (
          <View key={key} style={styles.pickerField}>
            <FeatureLabel>{input.label}</FeatureLabel>
            <View style={styles.optionList}>
              <Option
                label={input.empty}
                selected={choice === ""}
                disabled={!canEdit}
                onPress={() => setChoice("")}
              />
              {options.map((o) => (
                <Option
                  key={o.value}
                  label={o.label}
                  selected={choice === o.value}
                  disabled={!canEdit}
                  onPress={() => setChoice(o.value)}
                />
              ))}
            </View>
          </View>
        );
      }
      case "number":
        return (
          <View key={key} style={styles.pickerField}>
            <FeatureLabel>{input.label}</FeatureLabel>
            <FeatureField
              label={input.label}
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, "").slice(0, 3))}
              keyboardType="number-pad"
              maxLength={3}
            />
          </View>
        );
      case "heldDice":
        return (
          <HeldDicePicker key={key} sheet={parsed} input={input} value={dieIndexes} onChange={setDieIndexes} />
        );
      case "rollDice":
        return (
          <DamageDicePicker
            key={key}
            characterId={character._id}
            value={dieIndexes}
            onChange={setDieIndexes}
          />
        );
      case "ally":
        return (
          <AllyPicker
            key={key}
            party={party}
            self={character._id}
            allowSelf={!input.required}
            value={target}
            onChange={setTarget}
            label={input.label}
          />
        );
    }
  }

  const pickers =
    usable && (feature.target === "ally" || inputs.length > 0) ? (
      <View style={styles.pickers}>
        {feature.target === "ally" ? (
          <AllyPicker
            party={party}
            self={character._id}
            allowSelf={!needsTarget}
            value={target}
            onChange={setTarget}
            label="Target"
          />
        ) : null}
        {inputs.map(renderInput)}
      </View>
    ) : null;

  const useLabel = `Use ${feature.name}${cost ? ` · ${cost}` : ""}`;
  void campaignId;

  if (variant === "hope") {
    if (!usable) return null;
    return (
      <View accessibilityLabel={feature.name} style={styles.hopeCard}>
        {pickers}
        <Button
          accessibilityLabel={useLabel}
          disabled={disabled}
          onPress={() => void submit()}
          variant="solid"
        >
          {`✦ ${useLabel}`}
        </Button>
        {feature.automation === "assist" ? (
          <FeatureNote>Reminder: the Hope is spent here; apply the effect at the table.</FeatureNote>
        ) : null}
        <FeatureStatus message={message} />
        <FeatureError error={error} />
      </View>
    );
  }

  return (
    <FeatureRow
      title={feature.name}
      cost={cost ?? (feature.automation === "assist" ? "reminder" : undefined)}
      text={feature.text}
    >
      {pickers}
      {usable ? (
        <Button
          accessibilityLabel={useLabel}
          disabled={disabled}
          onPress={() => void submit()}
          variant="solid"
        >
          {`Use ${feature.name}`}
        </Button>
      ) : null}
      <FeatureStatus message={message} />
      <FeatureError error={error} />
    </FeatureRow>
  );
}

function Effects({
  parsed,
  character,
  canEdit,
}: {
  parsed: CharacterSheet;
  character: SheetSlotProps["character"];
  canEdit: boolean;
}) {
  const endEffect = useMutation(api.classFeatures.endEffect);
  const gotHit = useMutation(api.classFeatures.gotHit);
  const { run, busy, error } = useFeatureIntent();
  const effects = parsed.effects ?? [];
  if (effects.length === 0) return null;
  const hitEffects = effects.filter((e) => e.until === "hit");
  return (
    <View style={styles.effects}>
      <FeatureLabel>Active effects</FeatureLabel>
      <View accessibilityLabel="Active effects">
        {effects.map((e) => (
          <View key={e.id} style={styles.effectRow}>
            <Text style={styles.effectText}>
              <Text style={styles.effectSource}>{e.source}: </Text>
              {e.text}
            </Text>
            {canEdit ? (
              <Button
                accessibilityLabel={`End ${e.source}`}
                disabled={busy}
                onPress={() =>
                  void run((idempotencyKey) =>
                    endEffect({ characterId: character._id, effectId: e.id, idempotencyKey }),
                  )
                }
                variant="outline"
              >
                End
              </Button>
            ) : null}
          </View>
        ))}
      </View>
      {canEdit && hitEffects.length > 0 ? (
        <View style={styles.hitRow}>
          <Button
            accessibilityLabel="Got hit"
            disabled={busy}
            onPress={() =>
              void run((idempotencyKey) =>
                gotHit({ characterId: character._id, idempotencyKey }),
              )
            }
            variant="outline"
          >
            Got hit
          </Button>
          <FeatureNote>
            {`An attack succeeded against you: ends ${hitEffects.map((e) => e.source).join(", ")}.`}
          </FeatureNote>
        </View>
      ) : null}
      <FeatureError error={error} />
    </View>
  );
}

function stateEntries(parsed: CharacterSheet): [string, string][] {
  const state = parsed.classState ?? {};
  return (Object.keys(CLASS_STATE_LABELS) as (keyof typeof CLASS_STATE_LABELS)[]).flatMap(
    (k): [string, string][] => {
      const value = state[k];
      if (value === undefined) return [];
      const text =
        typeof value === "object" && !Array.isArray(value)
          ? "focus" in value
            ? `${value.focus} Focus${value.active ? ` · ${value.active}` : ""}`
            : `${value.value} / d${value.max}`
          : Array.isArray(value)
            ? value.join(", ") || "none"
            : typeof value === "boolean"
              ? value
                ? "yes"
                : "no"
              : String(value);
      return [[CLASS_STATE_LABELS[k], text]];
    },
  );
}

function sessionChips(parsed: CharacterSheet, hopeAndFear: boolean): string[] {
  const chips: string[] = [];
  const slayer = slayerDice(parsed);
  if (holdsSlayer(parsed) && slayer > 0) {
    chips.push(`Slayer Dice ${slayer}/${slayerCapacity(parsed)}`);
  }
  const tide = tideTokens(parsed);
  if (holdsTide(parsed) && tide > 0) {
    chips.push(`Tide tokens ${tide}/${tideCapacity(parsed)}`);
  }
  const die = parsed.sessionFeatures?.moonDie;
  const phase = currentPhase(parsed, { hopeAndFear, ikonis: false });
  if (die !== undefined && phase) chips.push(`Moon die ${die}: ${phase.name}`);
  return chips;
}

function blockedReason(parsed: CharacterSheet, character: SheetSlotProps["character"]): string | null {
  if (character.status === "dead") return "Dead characters can't use features.";
  if (character.status === "away") return "Away characters can't use features.";
  if ((parsed.conditions ?? []).includes("unconscious")) {
    return "Unconscious: can't use features until an ally clears a Hit Point or the party finishes a long rest.";
  }
  return null;
}

/** The combined Hope-feature block and Features-box (website: `HopeFeatureBlock` + `FeaturesBox`). */
export function ClassFeaturesPanel(props: SheetSlotProps) {
  const { campaignId, character, canEdit, hopeAndFear } = props;
  const parsed = useMemo(
    () => parseFeatureSheet(character.sheet as SheetData & Record<string, unknown>),
    [character.sheet],
  );
  const hope = parsed
    ? classFeaturesAvailable(parsed.classId, hopeAndFear)
      ? hopeFeature(parsed)
      : undefined
    : undefined;
  const actions = useMemo(() => {
    if (!parsed) return [];
    const held = parsed.heldDice ?? [];
    return classActions(parsed).filter((f) =>
      f.key === rallyDieStress.key
        ? held.some((d) => d.kind === "rally")
        : [parsed.classId, parsed.multiclass?.classId].some(
            (id) =>
              id !== undefined &&
              classFeaturesAvailable(id, hopeAndFear) &&
              CLASS_FEATURES[id]?.classActions?.includes(f),
          ),
    );
  }, [parsed, hopeAndFear]);

  const needsParty =
    canEdit &&
    (hope?.target === "ally" ||
      hope?.inputs?.some((i) => i.kind === "ally") ||
      actions.some(
        (f) => f.target === "ally" || (f.inputs ?? []).some((i) => i.kind === "ally"),
      ));
  const party = useQuery(
    api.charactersReads.listByCampaign,
    needsParty ? { campaignId: campaignId as Id<"campaigns"> } : "skip",
  );

  if (!parsed) return null;
  const effects = parsed.effects ?? [];
  const conditions = parsed.conditions ?? [];
  const held = parsed.heldDice ?? [];
  const state = stateEntries(parsed);
  const session = sessionChips(parsed, hopeAndFear);
  const showHope = hope !== undefined && canEdit && hope.use !== undefined;
  const hasHopeBlock = showHope || effects.length > 0;
  const hasFeaturesBox =
    actions.length > 0 ||
    conditions.length > 0 ||
    held.length > 0 ||
    session.length > 0 ||
    state.length > 0;
  if (!hasHopeBlock && !hasFeaturesBox) return null;
  const blocked = blockedReason(parsed, character);

  return (
    <FeatureSection
      accessibilityLabel="Class features"
      testID="class-features"
      title="Class Features"
    >
      {hope && showHope ? (
        <FeatureCard
          feature={hope}
          parsed={parsed}
          character={character}
          campaignId={campaignId as Id<"campaigns">}
          canEdit={canEdit}
          blocked={blocked}
          party={party as PartyMember[] | undefined}
          variant="hope"
        />
      ) : null}
      <Effects parsed={parsed} character={character} canEdit={canEdit} />
      {actions.map((f) => (
        <FeatureCard
          key={f.key}
          feature={f}
          parsed={parsed}
          character={character}
          campaignId={campaignId as Id<"campaigns">}
          canEdit={canEdit}
          blocked={blocked}
          party={party as PartyMember[] | undefined}
          variant="row"
        />
      ))}
      <ChipList label="Conditions" items={conditions.map(TRAIT_LABEL)} />
      <ChipList
        label="Held dice"
        items={held.map(
          (d) => `${TRAIT_LABEL(d.kind)} d${d.sides}${d.value !== undefined ? `: ${d.value}` : ""}`,
        )}
      />
      <ChipList label="Session" items={session} />
      {state.length > 0 ? (
        <View style={styles.stateBlock}>
          {state.map(([label, text]) => (
            <View key={label} style={styles.stateRow}>
              <FeatureLabel>{label}</FeatureLabel>
              <Text style={styles.stateText}>{text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </FeatureSection>
  );
}

const styles = StyleSheet.create({
  pickers: { gap: space[2] },
  pickerField: { gap: space[1] },
  optionList: { gap: space[1] },
  option: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: hit.minHeight,
    justifyContent: "center",
    paddingHorizontal: space[3],
  },
  optionOn: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
  },
  optionText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  optionTextOn: {
    color: colors.hope,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 15,
    fontWeight: type.sansSemibold.fontWeight,
  },
  hopeCard: {
    borderColor: colors.brand,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  effects: { gap: space[2] },
  effectRow: {
    alignItems: "center",
    borderBottomColor: colors.line2,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: space[2],
    paddingVertical: space[2],
  },
  effectText: {
    color: colors.body,
    flex: 1,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  effectSource: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontWeight: type.sansSemibold.fontWeight,
  },
  hitRow: { gap: space[2] },
  stateBlock: { gap: space[2] },
  stateRow: { gap: space[1] },
  stateText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
});
