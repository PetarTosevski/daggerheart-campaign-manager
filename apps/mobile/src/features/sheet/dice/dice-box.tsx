import { useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { BRAWLERS_STRIKE } from "../../../../../../src/lib/domain/class-features/classes/brawler";
import { rollOptions, weaponOverrides } from "../../../../../../src/lib/domain/class-features/hooks";
import { CLASS_FEATURES } from "../../../../../../src/lib/domain/class-features/index";
import type { FeatureScope, RollPrompt } from "../../../../../../src/lib/domain/class-features/types";
import { TYPED_MODIFIER_MAX, weaponDice } from "../../../../../../src/lib/domain/dice";
import { ikonisWeapon } from "../../../../../../src/lib/domain/dice/ikonis";
import type { RollRecord } from "../../../../../../src/lib/domain/duality";
import { holdsSlayer, holdsTide, slayerDice, tideTokens } from "../../../../../../src/lib/domain/session-features";
import { consequence, earlierText, outcomeText, outcomeTone, partsText, poolLabel, signed } from "../../../../../../src/lib/party/roll-copy";
import { WEAPONS } from "../../../../../../src/lib/srd/equipment";
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
import { slayerResultSuffix, traitRollLabel } from "./roll-copy";
import { RollPrompts } from "./roll-prompts";
import { diceSheet, isUnavailable } from "./sheet-parse";
import { SlayerOffer } from "./slayer";
import { TagTeam } from "./tag-team";

type Mode = "action" | "reaction" | "damage";
type Result = {
  id: number;
  entryId: Id<"actionLog">;
  roll: RollRecord;
  prompts: RollPrompt[];
  label: string;
  fearGained?: number;
  slayer: number;
};

const SIDES = [4, 6, 8, 10, 12, 20] as const;
const ADVANTAGE_LIMIT = 6;
const HISTORY = 6;

const MODES = [
  ["action", "Action"],
  ["reaction", "Reaction"],
  ["damage", "Damage"],
] as const;

function toInt(raw: string): number | undefined {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function DiceBox({
  campaignId,
  character,
  hopeAndFear,
}: {
  campaignId: Id<"campaigns">;
  character: SheetCharacter;
  hopeAndFear: boolean;
}) {
  const writes = useWritesEnabled();
  const view = character.sheet;
  const sheet = useMemo(() => diceSheet(character), [character]);
  const unavailable = isUnavailable(character);

  const [mode, setMode] = useState<Mode>("action");
  const [trait, setTrait] = useState<TraitId>("agility");
  const [modifier, setModifier] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [experienceIds, setExperienceIds] = useState<string[]>([]);
  const [edge, setEdge] = useState(0);
  const [help, setHelp] = useState(0);
  const [attack, setAttack] = useState(false);
  const [ikonisAttack, setIkonisAttack] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [source, setSource] = useState("primary");
  const [customCount, setCustomCount] = useState("1");
  const [customSides, setCustomSides] = useState<number>(6);
  const [critical, setCritical] = useState(false);
  const [slayerSpend, setSlayerSpend] = useState(0);
  const [tideSpend, setTideSpend] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<Result[]>([]);
  const seq = useRef(0);
  const [optionsOpen, setOptionsOpen] = useState(true);

  const actionRoll = useIntent(api.rolls.actionRoll);
  const damageRoll = useIntent(api.rolls.damageRoll);
  const pendingRoll = actionRoll.pending || damageRoll.pending;
  const error = actionRoll.error ?? damageRoll.error;

  const fear = useQuery(api.campaigns.fear, { campaignId });
  const extras = useQuery(api.characterExtras.get, { characterId: character._id });
  const choices = useQuery(api.rolls.pendingChoices, { characterId: character._id });

  const motherboard = extras?.motherboard ?? null;
  const scope: FeatureScope = { hopeAndFear, ikonis: motherboard !== null };
  const ikonis = motherboard && sheet ? ikonisWeapon(motherboard.ikonis, motherboard.installed, sheet.level, sheet.proficiency) : null;
  const overrides = sheet ? weaponOverrides(sheet, CLASS_FEATURES, scope) : [];
  const allOptions = sheet ? rollOptions(sheet, mode, CLASS_FEATURES, scope) : [];
  const strikeOverride = overrides.some((o) => o.key === "brawlersStrike");
  const weapons = [
    { key: "primary", id: view.primaryWeaponId },
    { key: "secondary", id: view.secondaryWeaponId ?? "" },
  ].flatMap(({ key, id }) => {
    const w = id ? WEAPONS.find((x) => x.id === id) : undefined;
    if (!w || (w.id === BRAWLERS_STRIKE && strikeOverride)) return [];
    try {
      const { dice, flat } = weaponDice(w.damage, view.proficiency, w.id === BRAWLERS_STRIKE);
      return [{ key, label: `${key === "primary" ? "Primary" : "Secondary"}: ${w.name} (${poolLabel(dice, flat)})`, dice }];
    } catch {
      return [];
    }
  });
  const ikonisLabel = ikonis ? `Ikonis: ${ikonis.label} (${poolLabel(ikonis.dice, ikonis.flat)})` : "";
  const sources = [...weapons.map((w) => w.key), ...(ikonis ? ["ikonis"] : []), ...overrides.map((o) => o.key), "custom"];
  const damageSourceKey = sources.includes(source) ? source : sources[0]!;
  const magicSource =
    mode === "damage" &&
    ((damageSourceKey === "primary" || damageSourceKey === "secondary"
      ? WEAPONS.find((w) => w.id === (damageSourceKey === "primary" ? view.primaryWeaponId : view.secondaryWeaponId))?.damageType
      : overrides.find((o) => o.key === damageSourceKey)?.damageType) === "magic");
  const options = allOptions.filter((o) => !(o.physicalOnly && magicSource));
  const useIkonis = mode === "action" && ikonisAttack && ikonis !== null;
  const rollTrait = useIkonis && ikonis.trait ? ikonis.trait : trait;
  const slayerPool = sheet ? slayerDice(sheet) : 0;
  const showSlayer = sheet !== null && holdsSlayer(sheet) && slayerPool > 0 && (mode === "damage" || (mode === "action" && (attack || useIkonis)));
  const slayerCount = showSlayer ? Math.min(slayerSpend, slayerPool) : 0;
  const tideHeld = sheet ? tideTokens(sheet) : 0;
  const showTide = sheet !== null && holdsTide(sheet) && mode === "action";
  const tideCount = showTide ? Math.min(tideSpend, tideHeld) : 0;

  function damageRollLabel(): string {
    const name =
      weapons.find((w) => w.key === damageSourceKey)?.label ??
      (damageSourceKey === "ikonis"
        ? ikonisLabel
        : (overrides.find((o) => o.key === damageSourceKey)?.label ?? `${toInt(customCount) ?? 0}d${customSides}`));
    const auto = options.filter((o) => o.auto).map((o) => ` · ${o.label}`).join("");
    return `${name}${auto}${critical ? " · critical" : ""}`;
  }

  function show(entryId: Id<"actionLog">, roll: RollRecord, prompts: RollPrompt[], label: string, slayer: number, fearGained?: number) {
    seq.current += 1;
    const entry: Result = {
      id: seq.current,
      entryId,
      roll,
      prompts,
      label: label + slayerResultSuffix(roll, slayer),
      slayer,
      ...(fearGained !== undefined ? { fearGained } : {}),
    };
    setResult(entry);
    setHistory((h) => [entry, ...h].slice(0, HISTORY));
  }

  async function roll() {
    if (!writes) return;
    setResult(null);
    const mod = toInt(modifier) ?? 0;
    const picked = chosen.filter((k) => options.some((o) => o.key === k));
    if (mode === "damage") {
      const label = damageRollLabel();
      const damageSource =
        damageSourceKey === "primary" || damageSourceKey === "secondary"
          ? { kind: "weapon" as const, slot: damageSourceKey === "primary" ? ("primary" as const) : ("secondary" as const) }
          : damageSourceKey === "custom"
            ? { kind: "dice" as const, dice: [{ count: toInt(customCount) ?? 0, sides: customSides }] }
            : damageSourceKey === "ikonis"
              ? { kind: "ikonis" as const }
              : { kind: "override" as const, key: damageSourceKey };
      const out = await damageRoll.fire({
        characterId: character._id,
        source: damageSource,
        critical,
        modifier: mod,
        options: picked,
        ...(slayerCount > 0 ? { slayerDice: slayerCount } : {}),
      });
      if (out) {
        setSlayerSpend(0);
        show(out.entryId, out.roll, [], label, slayerCount);
      }
      return;
    }
    const diff = toInt(difficulty);
    const label = traitRollLabel(rollTrait, view.traits[rollTrait], mode, diff, tideCount);
    const out = await actionRoll.fire({
      characterId: character._id,
      kind: mode,
      trait: rollTrait,
      modifier: mod,
      ...(diff !== undefined ? { difficulty: diff } : {}),
      experienceIds,
      advantage: Math.max(0, edge),
      disadvantage: Math.max(0, -edge),
      help: mode === "reaction" ? 0 : help,
      attack: mode === "action" && (attack || useIkonis),
      options: picked,
      ...(useIkonis ? { ikonis: true } : {}),
      ...(slayerCount > 0 ? { slayerDice: slayerCount } : {}),
      ...(tideCount > 0 ? { tideTokens: tideCount } : {}),
    });
    if (out) {
      setSlayerSpend(0);
      setTideSpend(0);
      show(out.entryId, out.roll, out.prompts, label, slayerCount, out.fearGained);
    }
  }

  const hopeCost = experienceIds.length;
  const notEnoughHope = mode !== "damage" && hopeCost > view.hope;
  const modifierTooBig = Math.abs(toInt(modifier) ?? 0) > TYPED_MODIFIER_MAX;
  const canRoll = !(unavailable || pendingRoll || notEnoughHope || modifierTooBig || !writes);
  const earlier = history.slice(1);
  const tone = result ? outcomeTone(result.roll) : "dmg";

  return (
    <View accessibilityLabel="Dice" accessibilityRole="region" style={styles.box}>
      {unavailable ? (
        <Text accessibilityRole="text" style={styles.note}>
          {view.name} can’t roll right now (dead, away or unconscious).
        </Text>
      ) : null}

      <View accessibilityLabel="Roll type" accessibilityRole="radiogroup" style={styles.modes}>
        {MODES.map(([key, label]) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: mode === key }}
            key={key}
            onPress={() => setMode(key)}
            style={mode === key ? styles.modeOn : styles.mode}
          >
            <Text style={mode === key ? styles.modeLabelOn : styles.modeLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {mode === "damage" ? (
        <View style={styles.stack}>
          <Text style={styles.fieldLabel}>Damage source</Text>
          <View style={styles.chips}>
            {weapons.map((w) => (
              <Button key={w.key} onPress={() => setSource(w.key)} variant={damageSourceKey === w.key ? "solid" : "outline"}>
                {w.label}
              </Button>
            ))}
            {ikonis ? (
              <Button onPress={() => setSource("ikonis")} variant={damageSourceKey === "ikonis" ? "solid" : "outline"}>
                {ikonisLabel}
              </Button>
            ) : null}
            {overrides.map((o) => (
              <Button key={o.key} onPress={() => setSource(o.key)} variant={damageSourceKey === o.key ? "solid" : "outline"}>
                {o.label}
              </Button>
            ))}
            <Button onPress={() => setSource("custom")} variant={damageSourceKey === "custom" ? "solid" : "outline"}>
              Other dice
            </Button>
          </View>
          {damageSourceKey === "custom" ? (
            <View style={styles.row}>
              <LabeledInput label="Dice count" onChangeText={setCustomCount} value={customCount} />
              <View style={styles.sidePick}>
                <Text style={styles.fieldLabel}>Die</Text>
                <View style={styles.chips}>
                  {SIDES.map((s) => (
                    <Button key={s} onPress={() => setCustomSides(s)} variant={customSides === s ? "solid" : "outline"}>
                      {`d${s}`}
                    </Button>
                  ))}
                </View>
              </View>
            </View>
          ) : null}
          <LabeledInput label="Mod" onChangeText={(t) => setModifier(t.replace(/[^0-9+-]/g, "").slice(0, 3))} value={modifier} />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: critical }} onPress={() => setCritical((c) => !c)} style={styles.checkRow}>
            <Text style={styles.checkLabel}>Critical hit (+max dice)</Text>
          </Pressable>
          <Button disabled={!canRoll} onPress={() => void roll()} variant="solid">
            {pendingRoll ? "Rolling…" : "Roll damage"}
          </Button>
        </View>
      ) : (
        <View style={styles.stack}>
          <Text style={styles.fieldLabel}>Trait</Text>
          <View style={styles.chips}>
            {TRAIT_IDS.map((t) => (
              <Button
                disabled={useIkonis && ikonis?.trait !== null && ikonis.trait !== t}
                key={t}
                onPress={() => setTrait(t)}
                variant={rollTrait === t ? "solid" : "outline"}
              >
                {`${traitLabel(t)} ${signed(view.traits[t])}`}
              </Button>
            ))}
          </View>
          <LabeledInput label="Mod" onChangeText={(t) => setModifier(t.replace(/[^0-9+-]/g, "").slice(0, 3))} value={modifier} />
          <LabeledInput label="Difficulty" onChangeText={(t) => setDifficulty(t.replace(/[^0-9]/g, "").slice(0, 2))} placeholder="—" value={difficulty} />
          <AdvantageStepper limit={ADVANTAGE_LIMIT} onChange={setEdge} value={edge} />
          <Button disabled={!canRoll} onPress={() => void roll()} variant="primary">
            {pendingRoll ? "Rolling…" : "Roll Hope & Fear"}
          </Button>
        </View>
      )}

      {fear !== undefined ? (
        <Text style={styles.fear}>
          GM Fear <Text style={styles.fearVal}>{fear}</Text>
        </Text>
      ) : null}

      {notEnoughHope || modifierTooBig ? (
        <Text style={styles.note}>
          {notEnoughHope ? "Not enough Hope for those Experiences. " : ""}
          {modifierTooBig ? `The modifier goes from −${TYPED_MODIFIER_MAX} to +${TYPED_MODIFIER_MAX}.` : ""}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Pressable accessibilityRole="button" onPress={() => setOptionsOpen((o) => !o)} style={styles.optionsToggle}>
        <Text style={styles.optionsTitle}>Roll options {optionsOpen ? "▾" : "▸"}</Text>
      </Pressable>
      {optionsOpen ? (
        <View style={styles.options}>
          {mode !== "damage" && view.experiences.length > 0 ? (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>Experiences (1 Hope each)</Text>
              {view.experiences.map((e) => {
                const on = experienceIds.includes(e.id);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    key={e.id}
                    onPress={() => setExperienceIds((ids) => (on ? ids.filter((id) => id !== e.id) : [...ids, e.id]))}
                    style={on ? styles.chipOn : styles.chip}
                  >
                    <Text style={styles.chipText}>
                      {e.name} (+{e.value})
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {mode === "action" ? (
            <View style={styles.group}>
              <Toggle checked={attack} label="Attack roll" onChange={setAttack} />
              {ikonis ? (
                <Toggle
                  checked={ikonisAttack}
                  label={`Ikonis attack (${ikonis.label}${ikonis.attack ? `, +${ikonis.attack}` : ""}${ikonis.advantage ? ", advantage" : ""})`}
                  onChange={setIkonisAttack}
                />
              ) : null}
              <CountStepper label="Help dice" max={ADVANTAGE_LIMIT} onChange={setHelp} value={help} />
            </View>
          ) : null}
          {showSlayer || showTide ? (
            <View style={styles.group}>
              {showSlayer ? (
                <View style={styles.sessionItem}>
                  <CountStepper label="Slayer Dice to spend" max={slayerPool} onChange={setSlayerSpend} value={slayerCount} />
                  <Text style={styles.held}>{slayerPool} held</Text>
                </View>
              ) : null}
              {showTide ? (
                <View style={styles.sessionItem}>
                  <CountStepper label="Tide tokens to spend" max={tideHeld} onChange={setTideSpend} value={tideCount} />
                  <Text style={styles.held}>{tideHeld} held (+1 each)</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {options.length > 0 ? (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>Features</Text>
              {options.map((o) =>
                o.auto ? (
                  <Text key={o.key} style={styles.autoChip}>
                    {o.label} (always)
                  </Text>
                ) : (
                  <Toggle
                    checked={chosen.includes(o.key)}
                    key={o.key}
                    label={`${o.label}${o.cost?.hope ? ` (${o.cost.hope} Hope)` : ""}`}
                    onChange={(on) => setChosen((ks) => (on ? [...ks, o.key] : ks.filter((k) => k !== o.key)))}
                  />
                ),
              )}
            </View>
          ) : null}
          <TagTeam campaignId={campaignId} character={character} disabled={unavailable} pending={choices?.tagTeam ?? null} />
        </View>
      ) : null}

      {result ? (
        <View accessibilityLabel="Last roll" accessibilityRole="summary" style={styles.result}>
          <RollResult dice={result.roll.dice} />
          <Text style={styles.total}>{result.roll.total}</Text>
          <Text style={[styles.outcome, tone === "hope" ? styles.hope : tone === "fear" ? styles.fearOut : tone === "crit" ? styles.crit : null]}>
            {outcomeText(result.roll)}
            {result.roll.manual ? " · manual" : ""}
          </Text>
          <Text style={styles.resultLine}>
            {result.label}
            {partsText(result.roll) ? ` (${partsText(result.roll)})` : ""}
          </Text>
          {consequence(result.roll, result.fearGained, fear === null) ? (
            <Text style={styles.consequence}>{consequence(result.roll, result.fearGained, fear === null)}</Text>
          ) : null}
          <RollPrompts characterId={character._id} prompts={result.prompts} />
        </View>
      ) : null}

      {choices?.slayer && !pendingRoll ? (
        <SlayerOffer characterId={character._id} entryId={choices.slayer.entryId} prompt={choices.slayer.prompt} />
      ) : null}

      {earlier.length > 0 ? (
        <View style={styles.earlier}>
          <Text style={styles.groupLabel}>Earlier</Text>
          {earlier.map((r) => (
            <Text key={r.id} style={styles.earlierLine}>
              {earlierText(r.roll)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={checked ? styles.chipOn : styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

function CountStepper({ label, value, min = 0, max, onChange }: { label: string; value: number; min?: number; max: number; onChange: (n: number) => void }) {
  return (
    <View accessibilityLabel={label} accessibilityRole="adjustable" style={styles.stepper}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <Button accessibilityLabel={`Decrease ${label}`} disabled={value <= min} onPress={() => onChange(value - 1)} variant="outline">
          −
        </Button>
        <Text accessibilityLiveRegion="polite" style={styles.stepVal}>
          {value}
        </Text>
        <Button accessibilityLabel={`Increase ${label}`} disabled={value >= max} onPress={() => onChange(value + 1)} variant="outline">
          +
        </Button>
      </View>
    </View>
  );
}

function AdvantageStepper({ value, limit, onChange }: { value: number; limit: number; onChange: (n: number) => void }) {
  const text = value === 0 ? "Normal" : value > 0 ? `Advantage ×${value}` : `Disadvantage ×${-value}`;
  return (
    <View accessibilityLabel="Advantage or disadvantage" accessibilityRole="adjustable" style={styles.stepper}>
      <Text style={styles.fieldLabel}>Adv / Dis</Text>
      <View style={styles.stepperRow}>
        <Button accessibilityLabel="More disadvantage" disabled={value <= -limit} onPress={() => onChange(value - 1)} variant="outline">
          −
        </Button>
        <Text accessibilityLiveRegion="polite" style={styles.stepVal}>
          {text}
        </Text>
        <Button accessibilityLabel="More advantage" disabled={value >= limit} onPress={() => onChange(value + 1)} variant="outline">
          +
        </Button>
      </View>
    </View>
  );
}

function LabeledInput({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (text: string) => void; placeholder?: string }) {
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType={label === "Mod" ? "numbers-and-punctuation" : "number-pad"}
        onChangeText={onChangeText}
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
  stack: {
    gap: space[2],
  },
  row: {
    gap: space[2],
  },
  modes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  mode: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[3],
  },
  modeOn: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[3],
  },
  modeLabel: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  modeLabelOn: {
    color: colors.hope,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 15,
    fontWeight: type.sansSemibold.fontWeight,
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
  sidePick: {
    gap: space[1],
  },
  checkRow: {
    minHeight: 44,
    justifyContent: "center",
  },
  checkLabel: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  fear: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  fearVal: {
    color: colors.fear,
    fontFamily: type.sansSemibold.fontFamily,
    fontWeight: type.sansSemibold.fontWeight,
  },
  note: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  optionsToggle: {
    minHeight: 44,
    justifyContent: "center",
  },
  optionsTitle: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 15,
    fontWeight: type.sansSemibold.fontWeight,
  },
  options: {
    gap: space[3],
  },
  group: {
    gap: space[2],
  },
  groupLabel: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    textTransform: "uppercase",
  },
  chip: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[3],
  },
  chipOn: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[3],
  },
  chipText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  autoChip: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  sessionItem: {
    gap: space[1],
  },
  held: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  stepper: {
    gap: space[1],
  },
  stepperRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[2],
  },
  stepVal: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minWidth: space[12],
    textAlign: "center",
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
  result: {
    gap: space[2],
  },
  total: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 32,
    fontWeight: type.displayBold.fontWeight,
  },
  outcome: {
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 16,
    fontWeight: type.sansSemibold.fontWeight,
  },
  hope: {
    color: colors.hope,
  },
  fearOut: {
    color: colors.fear,
  },
  crit: {
    color: colors.brand,
  },
  resultLine: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  consequence: {
    color: colors.mutedText,
    fontFamily: type.serifItalic.fontFamily,
    fontSize: 14,
    fontStyle: "italic",
  },
  earlier: {
    gap: space[1],
  },
  earlierLine: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
});
