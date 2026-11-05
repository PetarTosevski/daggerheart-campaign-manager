import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useQuery } from "convex/react";

import {
  REWARD_GROUP_LABEL,
  RELIC_VALUE,
  SCRAP_CATEGORIES,
  SCRAP_REWARD_TABLE,
  SCRAP_TABLES,
  type FightDifficulty,
  type RewardGroup,
} from "../../../../../../../../src/lib/domain/frames/motherboard";
import { TRAIT_LABEL, traitIdSchema } from "../../../../../../../../src/lib/frames/extras/common";
import {
  AUGMENTS,
  augmentDefense,
  augmentSlots,
  getAugment,
  IKONIS_RANGES,
  ikonisDamage,
  type Ikonis,
  type MotherboardState,
} from "../../../../../../../../src/lib/frames/extras/motherboard";
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
  FeatureStatus,
} from "../../ui";
import { Pips } from "./pips";

type Props = {
  characterId: Id<"characters">;
  state: MotherboardState;
  level: number;
  tier: number;
  canEdit: boolean;
};

const DIFFICULTY_LABEL: Record<FightDifficulty, string> = {
  easy: "Easy",
  standard: "Standard",
  difficult: "Difficult",
  veryDifficult: "Very difficult",
};

/** Motherboard module (Core pp.301–303): Ikonis, augments, quantum and scrap. */
export function MotherboardPanel(props: Props) {
  return (
    <FeatureSection
      accessibilityLabel="Motherboard Ikonis Module"
      testID="motherboard"
      title="Ikonis Module"
    >
      <FeatureNote>Your Ikonis, its augments, and the scrap and quantum that build them.</FeatureNote>
      <IkonisCard {...props} />
      <WalletCard {...props} />
      <AugmentsCard {...props} />
    </FeatureSection>
  );
}

function InstalledLine({ installed }: { installed: readonly string[] }) {
  const names = installed.map((id) => getAugment(id)?.name ?? id);
  const defense = augmentDefense(installed);
  const parts = [
    defense.armorScore ? `+${defense.armorScore} Armor Score` : "",
    defense.evasion ? `${defense.evasion} Evasion` : "",
  ].filter(Boolean);
  const base =
    names.length > 0 ? `Installed augments: ${names.join(", ")}` : "No augments installed.";
  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return <FeatureNote>{`${base}${suffix}`}</FeatureNote>;
}

function IkonisCard({ characterId, state, level, canEdit }: Props) {
  const save = useIntent(api.characterExtras.saveIkonis);
  const [draft, setDraft] = useState<Ikonis>(state.ikonis);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.ikonis);
  const damage = ikonisDamage(state.ikonis, level);
  const ro = !canEdit;
  return (
    <View style={styles.block}>
      <Text style={styles.plaque}>{state.ikonis.name || "Ikonis"}</Text>
      <FeatureNote>Two-handed. Bonded: gain a bonus to your damage rolls equal to your level.</FeatureNote>
      {damage ? (
        <Text style={styles.strong}>
          {state.ikonis.trait ? `${TRAIT_LABEL[state.ikonis.trait]} · ` : ""}
          {state.ikonis.range} · {damage}
        </Text>
      ) : null}
      <InstalledLine installed={state.installed} />
      <FeatureField
        label="Name"
        value={draft.name}
        onChangeText={(v) => setDraft({ ...draft, name: v })}
        maxLength={80}
      />
      <FeatureLabel>Trait</FeatureLabel>
      <CheckOption
        label="None"
        checked={draft.trait === null}
        onPress={() => setDraft({ ...draft, trait: null })}
      />
      {traitIdSchema.options.map((t) => (
        <CheckOption
          key={t}
          label={TRAIT_LABEL[t]}
          checked={draft.trait === t}
          onPress={() => setDraft({ ...draft, trait: t })}
        />
      ))}
      <FeatureLabel>Range and damage</FeatureLabel>
      {IKONIS_RANGES.map((r) => (
        <CheckOption
          key={r.range}
          label={`${r.range} – ${r.damage}`}
          checked={draft.range === r.range}
          onPress={() => setDraft({ ...draft, range: r.range })}
        />
      ))}
      <FeatureLabel>Damage type</FeatureLabel>
      <CheckOption
        label="Physical"
        checked={draft.damageType === "physical"}
        onPress={() => setDraft({ ...draft, damageType: "physical" })}
      />
      <CheckOption
        label="Tech"
        checked={draft.damageType === "tech"}
        onPress={() => setDraft({ ...draft, damageType: "tech" })}
      />
      <FeatureField
        label="Description"
        value={draft.description}
        onChangeText={(v) => setDraft({ ...draft, description: v })}
        multiline
        maxLength={2000}
      />
      {canEdit ? (
        <Button
          accessibilityLabel="Save Ikonis"
          disabled={!dirty || save.pending || ro}
          onPress={() => void save.fire({ characterId, ikonis: draft })}
          variant="solid"
        >
          Save Ikonis
        </Button>
      ) : null}
      <FeatureError error={save.error} />
    </View>
  );
}

function WalletCard({ characterId, state, canEdit }: Props) {
  const gather = useIntent(api.characterExtras.gatherScrap);
  const trade = useIntent(api.characterExtras.tradeScrap);
  const addRelic = useIntent(api.characterExtras.addRelic);
  const sellRelic = useIntent(api.characterExtras.sellRelic);
  const correct = useIntent(api.characterExtras.correctWallet);
  const [dice, setDice] = useState({ shards: 0, metals: 0, components: 0 });
  const [qty, setQty] = useState(1);
  const [relicName, setRelicName] = useState("");
  const [quantum, setQuantum] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const error =
    gather.error ?? trade.error ?? addRelic.error ?? sellRelic.error ?? correct.error;

  const applyPreset = (group: RewardGroup, difficulty: FightDifficulty) => {
    setDice({ ...SCRAP_REWARD_TABLE[group][difficulty] });
  };

  return (
    <View style={styles.block}>
      <Text style={styles.plaque}>Scrap & Quantum</Text>
      <FeatureNote>
        Each piece of scrap is worth its value, buying or selling. 10 quantum = 1 handful of gold.
      </FeatureNote>
      <FeatureLabel>Quantum</FeatureLabel>
      <Text style={styles.big}>{state.quantum}</Text>
      {canEdit ? (
        <View style={styles.block}>
          <FeatureField
            label="Correct quantum"
            value={quantum}
            onChangeText={(v) => setQuantum(v.replace(/[^0-9]/g, "").slice(0, 7))}
            keyboardType="number-pad"
          />
          <Button
            accessibilityLabel="Correct quantum"
            disabled={quantum === "" || correct.pending}
            onPress={async () => {
              await correct.fire({ characterId, correction: { quantum: Number(quantum) } });
              setQuantum("");
            }}
            variant="outline"
          >
            Correct
          </Button>
          <FeatureLabel>Trade quantity</FeatureLabel>
          <FeatureField
            label="Trade quantity"
            value={String(qty)}
            onChangeText={(v) => setQty(Math.max(1, Number(v.replace(/[^0-9]/g, "")) || 1))}
            keyboardType="number-pad"
          />
        </View>
      ) : null}

      {SCRAP_CATEGORIES.map((c) => (
        <View key={c} style={styles.block}>
          <FeatureLabel>{`${SCRAP_TABLES[c].label} (d${SCRAP_TABLES[c].die})`}</FeatureLabel>
          {SCRAP_TABLES[c].items.map((item) => {
            const n = state.scrap[item.name] ?? 0;
            return (
              <View key={item.name} style={styles.scrapRow}>
                <Text style={styles.scrapMeta}>{item.value}</Text>
                <Text style={styles.scrapName}>{item.name}</Text>
                <Text style={[styles.scrapNum, n === 0 ? styles.scrapNumZero : null]}>{n}</Text>
                {canEdit ? (
                  <>
                    <Button
                      accessibilityLabel={`Buy ${qty} ${item.name}`}
                      disabled={trade.pending || state.quantum < item.value * qty}
                      onPress={() =>
                        void trade.fire({
                          characterId,
                          name: item.name,
                          quantity: qty,
                          direction: "buy",
                        })
                      }
                      variant="solid"
                    >
                      Buy
                    </Button>
                    <Button
                      accessibilityLabel={`Sell ${qty} ${item.name}`}
                      disabled={trade.pending || n < qty}
                      onPress={() =>
                        void trade.fire({
                          characterId,
                          name: item.name,
                          quantity: qty,
                          direction: "sell",
                        })
                      }
                      variant="outline"
                    >
                      Sell
                    </Button>
                  </>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}

      <View style={styles.block}>
        <FeatureLabel>{`Relics (${RELIC_VALUE} quantum each)`}</FeatureLabel>
        {state.relics.length === 0 ? <FeatureNote>No relics.</FeatureNote> : null}
        {state.relics.map((r) => (
          <View key={r.id} style={styles.scrapRow}>
            <Text style={styles.scrapName}>{r.name}</Text>
            {canEdit ? (
              <Button
                accessibilityLabel={`Sell ${r.name}`}
                disabled={sellRelic.pending}
                onPress={() => void sellRelic.fire({ characterId, relicId: r.id })}
                variant="outline"
              >
                Sell
              </Button>
            ) : null}
          </View>
        ))}
        {canEdit ? (
          <>
            <FeatureField
              label="Relic name"
              value={relicName}
              onChangeText={setRelicName}
              maxLength={80}
            />
            <Button
              accessibilityLabel="Add relic"
              disabled={!relicName.trim() || addRelic.pending}
              onPress={async () => {
                await addRelic.fire({ characterId, name: relicName });
                setRelicName("");
              }}
              variant="solid"
            >
              Add relic
            </Button>
          </>
        ) : null}
      </View>

      {canEdit ? (
        <View style={styles.block}>
          <FeatureLabel>Gather scrap preset</FeatureLabel>
          {(Object.keys(SCRAP_REWARD_TABLE) as RewardGroup[]).flatMap((g) =>
            (Object.keys(SCRAP_REWARD_TABLE[g]) as FightDifficulty[]).map((d) => (
              <Button
                key={`${g}:${d}`}
                accessibilityLabel={`${REWARD_GROUP_LABEL[g]}, ${DIFFICULTY_LABEL[d]} fight`}
                onPress={() => applyPreset(g, d)}
                variant="outline"
              >
                {`${REWARD_GROUP_LABEL[g]}, ${DIFFICULTY_LABEL[d]}`}
              </Button>
            )),
          )}
          {SCRAP_CATEGORIES.map((c) => (
            <View key={c} style={styles.block}>
              <FeatureLabel>{`${SCRAP_TABLES[c].label} d${SCRAP_TABLES[c].die}`}</FeatureLabel>
              <FeatureField
                label={`${SCRAP_TABLES[c].label} dice`}
                value={String(dice[c])}
                onChangeText={(v) =>
                  setDice({
                    ...dice,
                    [c]: Math.max(0, Math.min(10, Number(v.replace(/[^0-9]/g, "")) || 0)),
                  })
                }
                keyboardType="number-pad"
              />
            </View>
          ))}
          <Button
            accessibilityLabel="Roll scrap"
            disabled={gather.pending || dice.shards + dice.metals + dice.components === 0}
            onPress={async () => {
              const got = await gather.fire({ characterId, ...dice });
              if (got) {
                setNotice(
                  `Rolled ${got
                    .map((g: { roll: number; item: { name: string } }) => `${g.roll} → ${g.item.name}`)
                    .join(", ")}.`,
                );
              }
            }}
            variant="solid"
          >
            Roll scrap
          </Button>
        </View>
      ) : null}
      <FeatureStatus message={notice} />
      <FeatureError error={error} />
    </View>
  );
}

function AugmentsCard({ characterId, state, tier, canEdit }: Props) {
  const craft = useIntent(api.characterExtras.craftAugment);
  const salvage = useIntent(api.characterExtras.salvageAugment);
  const install = useIntent(api.characterExtras.installAugments);
  const downtime =
    useQuery(api.characterExtras.augmentSwapOpen, canEdit ? { characterId } : "skip") ?? false;
  const slots = augmentSlots(tier);
  const built = new Set(state.built.map((b) => b.id));
  const error = craft.error ?? salvage.error ?? install.error;

  const affordable = (recipe: Record<string, number>) =>
    Object.entries(recipe).every(([name, n]) =>
      name === "Relic" ? state.relics.length >= n : (state.scrap[name] ?? 0) >= n,
    );

  return (
    <View style={styles.block}>
      <Text style={styles.plaque}>Augments</Text>
      <FeatureLabel>{`Installed ${state.installed.length} / ${slots}`}</FeatureLabel>
      <Pips
        label="Augment slots"
        marked={state.installed.length}
        total={slots}
        disabled
        onSet={() => undefined}
      />
      <FeatureNote>
        Two slots at Tier 1, one more each tier. Craft, install and salvage during downtime.
      </FeatureNote>
      {canEdit && !downtime ? (
        <FeatureNote>Swap installed augments while the party rests (downtime).</FeatureNote>
      ) : null}
      {AUGMENTS.map((aug) => {
        const isBuilt = built.has(aug.id);
        const installed = state.installed.includes(aug.id);
        const locked = tier < aug.precompileTier;
        return (
          <View
            key={aug.id}
            style={[
              styles.augment,
              installed ? styles.augmentOn : null,
              locked ? styles.augmentLocked : null,
            ]}
          >
            <Text style={styles.strong}>{aug.name}</Text>
            <Text style={styles.scrapName}>{aug.text}</Text>
            {aug.precompileTier > 1 ? (
              <Text style={styles.scrapMeta}>{`Precompile: Tier ${aug.precompileTier}`}</Text>
            ) : null}
            <Text style={styles.scrapMeta}>
              {Object.entries(aug.recipe)
                .map(([name, n]) => `${n} ${name}`)
                .join(", ")}
            </Text>
            {canEdit ? (
              isBuilt ? (
                <View style={styles.rowButtons}>
                  <Button
                    accessibilityLabel={installed ? `Uninstall ${aug.name}` : `Install ${aug.name}`}
                    disabled={
                      !downtime ||
                      install.pending ||
                      (!installed && state.installed.length >= slots)
                    }
                    onPress={() =>
                      void install.fire({
                        characterId,
                        augmentIds: installed
                          ? state.installed.filter((id) => id !== aug.id)
                          : [...state.installed, aug.id],
                      })
                    }
                    variant={installed ? "primary" : "solid"}
                  >
                    {installed ? "Uninstall" : "Install"}
                  </Button>
                  <Button
                    accessibilityLabel={`Salvage ${aug.name}`}
                    disabled={salvage.pending}
                    onPress={() => void salvage.fire({ characterId, augmentId: aug.id })}
                    variant="outline"
                  >
                    Salvage
                  </Button>
                </View>
              ) : (
                <Button
                  accessibilityLabel={`Craft ${aug.name}`}
                  disabled={locked || craft.pending || !affordable(aug.recipe)}
                  onPress={() => void craft.fire({ characterId, augmentId: aug.id })}
                  variant="solid"
                >
                  Craft
                </Button>
              )
            ) : isBuilt ? (
              <Text style={styles.scrapMeta}>{installed ? "Installed" : "Built"}</Text>
            ) : null}
          </View>
        );
      })}
      <FeatureError error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[2] },
  plaque: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
    fontWeight: type.displayBold.fontWeight,
  },
  strong: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 15,
    fontWeight: type.sansSemibold.fontWeight,
  },
  big: {
    color: colors.hope,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
  scrapRow: {
    alignItems: "center",
    borderBottomColor: colors.line2,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: space[2],
    paddingVertical: space[2],
  },
  scrapMeta: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    minWidth: 24,
  },
  scrapName: {
    color: colors.body,
    flex: 1,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  scrapNum: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 15,
    fontWeight: type.sansSemibold.fontWeight,
    minWidth: 32,
    textAlign: "right",
  },
  scrapNumZero: { color: colors.subtle },
  augment: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[1],
    padding: space[3],
  },
  augmentOn: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
  },
  augmentLocked: { opacity: 0.5 },
  rowButtons: { flexDirection: "row", gap: space[2] },
});
