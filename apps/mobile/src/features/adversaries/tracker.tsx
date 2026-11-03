import { useQuery } from "convex/react";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { relentlessValue } from "../../../../../src/lib/domain/adversaries";
import { battlePoints } from "../../../../../src/lib/domain/encounters/budget";
import { MAX_DAMAGE, SEVERITY_LABEL } from "../../../../../src/lib/domain/encounters/damage";
import { spotlightCostsFear, spotlightLimit, spotlightsThisTurn, spotlightStatus, turnSpotlights } from "../../../../../src/lib/domain/encounters/spotlight";
import { MAX_FEAR } from "../../../../../src/lib/domain/fear";
import { ADVERSARIES } from "../../../../../src/lib/srd/adversaries";
import type { AdversaryDef } from "../../../../../src/lib/srd/types";
import { api, type Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { Button } from "../../ui/button";

import { Chip, ErrorLine, Stepper } from "./controls";
import { StatBlock } from "./stat-block";
import { advStyles } from "./styles";
import { STATUS_LABEL, type CustomAdversary, type EncounterInstance, type EncounterView, type StatBlockData } from "./types";
import { useTracker, type Condition, type FearReason, type TrackerActions } from "./use-tracker";

const SRD_BY_ID = new Map<string, AdversaryDef>(ADVERSARIES.map((a) => [a.id, a]));
const CONDITIONS: readonly { id: Condition; label: string }[] = [
  { id: "hidden", label: "Hidden" },
  { id: "restrained", label: "Restrained" },
  { id: "vulnerable", label: "Vulnerable" },
  { id: "distracted", label: "Distracted" },
];
/** Why the GM spends Fear (CB p.154). */
const REASONS: readonly { id: FearReason; label: string }[] = [
  { id: "move", label: "Additional GM move" },
  { id: "feature", label: "Fear feature" },
  { id: "experience", label: "Experience" },
  { id: "interrupt", label: "Interrupt" },
];

type Block = { data: StatBlockData; relentless: number | "X" | null };

function blockFor(instance: EncounterInstance, customs: readonly CustomAdversary[]): Block | null {
  if (instance.source.kind === "srd") {
    const def = SRD_BY_ID.get(instance.source.adversaryId);
    return def ? { data: def, relentless: relentlessValue(def) } : null;
  }
  const { customId } = instance.source;
  const custom = customs.find((c) => c._id === customId);
  if (!custom) return null;
  const x = custom.features.map((f) => /^Relentless \((.+)\)$/.exec(f.name)?.[1]).find((v) => v !== undefined);
  return { data: custom, relentless: x === undefined ? null : /^\d+$/.test(x) ? Number(x) : "X" };
}

function SpendFear({ fear, running, actions }: { fear: number; running: boolean; actions: TrackerActions }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(1);
  const n = Math.min(amount, Math.max(1, fear));
  if (!open) {
    return (
      <Button disabled={!running || fear === 0} onPress={() => setOpen(true)} variant="outline">
        Spend Fear
      </Button>
    );
  }
  return (
    <View accessibilityLabel="Spend Fear" style={advStyles.paper}>
      <Text style={advStyles.body}>
        You hold {fear} Fear. Spend it to interrupt the players, make an additional GM move, use a Fear feature or add an Experience.
      </Text>
      <Stepper
        downDisabled={n <= 1}
        label="Fear to spend"
        onDown={() => setAmount(n - 1)}
        onUp={() => setAmount(n + 1)}
        upDisabled={n >= fear}
        value={`${n} Fear`}
      />
      <View style={advStyles.row}>
        {REASONS.map((r) => (
          <Button
            disabled={fear < n}
            key={r.id}
            onPress={() =>
              void actions.spendFear(n, r.id).then((result) => {
                if (result) {
                  setAmount(1);
                  setOpen(false);
                }
              })
            }
            variant="outline"
          >
            {r.label}
          </Button>
        ))}
      </View>
      <Button onPress={() => setOpen(false)} variant="outline">
        Cancel
      </Button>
    </View>
  );
}

function TopBar({ view, fear, partyTier, actions }: { view: EncounterView; fear: number; partyTier: number; actions: TrackerActions }) {
  const { encounter, instances } = view;
  const running = encounter.status === "running";
  const bp = battlePoints({
    pcs: encounter.pcs,
    adjustments: encounter.adjustments,
    entries: instances.map((i) => ({ type: i.type, tier: i.tier, summoned: i.summoned, minionCount: i.minionCount })),
    partyTier,
  });
  return (
    <View style={advStyles.card}>
      <View style={advStyles.between}>
        <Text accessibilityRole="header" style={[advStyles.h2, advStyles.grow]}>
          {encounter.name}
        </Text>
        <View style={advStyles.badge}>
          <Text style={advStyles.badgeText}>{STATUS_LABEL[encounter.status]}</Text>
        </View>
      </View>
      <View style={advStyles.between}>
        <Text style={advStyles.h3}>GM turn {encounter.gmTurn}</Text>
        <Button disabled={!running} onPress={() => void actions.endGmTurn()} variant="outline">
          End GM turn
        </Button>
      </View>
      <Text accessibilityLabel={`GM Fear ${fear} of ${MAX_FEAR}`} style={advStyles.fear}>
        GM Fear {fear}/{MAX_FEAR}
      </Text>
      <SpendFear actions={actions} fear={fear} running={running} />
      <Text style={advStyles.stat}>
        Spent {bp.spent} of {bp.budget} BP
      </Text>
    </View>
  );
}

function DamageRow({ instance, actions }: { instance: EncounterInstance; actions: TrackerActions }) {
  const [amount, setAmount] = useState("");
  const [resistant, setResistant] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [defeats, setDefeats] = useState<number | null>(null);
  const value = Number(amount);
  const valid = /^\d+$/.test(amount.trim()) && value >= 0 && value <= MAX_DAMAGE;

  async function apply() {
    const done = await actions.applyDamage(instance._id, value, resistant);
    if (!done) return;
    setAmount("");
    if (done.suggestedDefeats !== null) {
      setDefeats(done.suggestedDefeats);
      setResult(`${done.taken} damage: defeat ${done.suggestedDefeats} Minion${done.suggestedDefeats === 1 ? "" : "s"}?`);
    } else {
      setDefeats(null);
      setResult(`${done.taken} damage · ${SEVERITY_LABEL[done.severity]} · ${done.marked} HP marked`);
    }
  }

  async function confirmDefeats() {
    if (defeats === null || defeats <= 0) return;
    const done = await actions.defeatMinions(instance._id, defeats);
    if (done) {
      setDefeats(null);
      setResult(done.defeated ? "The group is defeated." : `${done.remaining} Minions left.`);
    }
  }

  return (
    <View style={advStyles.section}>
      <View style={advStyles.row}>
        <TextInput
          accessibilityLabel={`Damage to ${instance.label}`}
          keyboardType="number-pad"
          onChangeText={setAmount}
          placeholder="Damage"
          style={[advStyles.input, advStyles.grow]}
          value={amount}
        />
        <Button disabled={!valid} onPress={() => void apply()} variant="solid">
          Apply
        </Button>
      </View>
      <Chip label="Resistant (half damage)" on={resistant} onPress={() => setResistant((r) => !r)} role="switch" />
      {result ? (
        <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={advStyles.status}>
          {result}
        </Text>
      ) : null}
      {defeats !== null && defeats > 0 ? (
        <Button onPress={() => void confirmDefeats()} variant="outline">
          {`Defeat ${defeats}`}
        </Button>
      ) : null}
    </View>
  );
}

function InstanceCard({
  instance,
  block,
  gmTurn,
  nextCostsFear,
  actions,
}: {
  instance: EncounterInstance;
  block: Block | null;
  gmTurn: number;
  nextCostsFear: boolean;
  actions: TrackerActions;
}) {
  const [showBlock, setShowBlock] = useState(false);
  const { hpMax, stressMax, difficulty, major, severe } = instance.stats;
  const spot = spotlightStatus(spotlightsThisTurn(instance, gmTurn), spotlightLimit(block?.relentless ?? null));
  const minion = instance.minionCount !== undefined;
  return (
    <View accessibilityLabel={instance.label} style={[advStyles.card, instance.defeated ? advStyles.defeated : null]}>
      <View style={advStyles.between}>
        <View style={advStyles.grow}>
          <Text style={advStyles.rowName}>{instance.label}</Text>
          <Text style={advStyles.muted}>
            {instance.name === null ? "Deleted custom adversary" : `Tier ${instance.tier ?? "?"} ${instance.type ?? ""}`}
            {instance.summoned ? " · Summoned" : ""}
            {minion ? ` · ${hpMax - instance.hp} of ${hpMax} Minions` : ""}
          </Text>
        </View>
        {instance.defeated ? (
          <View style={advStyles.badge}>
            <Text style={advStyles.badgeText}>Defeated</Text>
          </View>
        ) : null}
      </View>
      <Text style={advStyles.stat}>
        Difficulty {difficulty} · Thresholds {major ?? "None"}/{severe ?? "None"}
      </Text>
      <Text style={advStyles.label}>HP</Text>
      <Stepper
        downDisabled={instance.hp <= 0}
        label={`${instance.label} HP`}
        onDown={() => void actions.markHp(instance._id, -1)}
        onUp={() => void actions.markHp(instance._id, 1)}
        upDisabled={instance.hp >= hpMax}
        value={`${instance.hp}/${hpMax}`}
      />
      {stressMax > 0 ? (
        <>
          <Text style={advStyles.label}>Stress</Text>
          <Stepper
            downDisabled={instance.stress <= 0}
            label={`${instance.label} Stress`}
            onDown={() => void actions.markStress(instance._id, -1)}
            onUp={() => void actions.markStress(instance._id, 1)}
            value={`${instance.stress}/${stressMax}`}
          />
        </>
      ) : null}
      <DamageRow actions={actions} instance={instance} />
      <View style={advStyles.row}>
        {CONDITIONS.map((c) => (
          <Chip
            accessibilityLabel={`${c.label} on ${instance.label}`}
            key={c.id}
            label={c.label}
            on={instance.conditions.includes(c.id)}
            onPress={() => void actions.toggleCondition(instance._id, c.id)}
            role="switch"
          />
        ))}
      </View>
      {instance.tags.length > 0 ? <Text style={advStyles.muted}>{instance.tags.join(" · ")}</Text> : null}
      <View style={advStyles.between}>
        <Text style={[advStyles.stat, spot.over ? advStyles.error : null]}>{spot.label}</Text>
        <Button
          accessibilityLabel={`Spotlight ${instance.label}${nextCostsFear ? " (1 Fear)" : ""}`}
          disabled={instance.defeated}
          onPress={() => void actions.spotlight(instance._id)}
          variant="outline"
        >
          {nextCostsFear ? "Spotlight · 1 Fear" : "Spotlight"}
        </Button>
      </View>
      {block ? (
        <Button onPress={() => setShowBlock((s) => !s)} variant="pill">
          {showBlock ? "Hide stat block" : "Stat block"}
        </Button>
      ) : null}
      {block && showBlock ? <StatBlock block={block.data} /> : null}
    </View>
  );
}

/**
 * The live encounter tracker (D8 A4) for a running encounter: GM turn, Fear and Battle Points on top, then one card
 * per adversary with HP, Stress, damage through thresholds, Minion defeats, conditions and the spotlight.
 */
export function Tracker({ campaignId, view, fear, partyTier }: { campaignId: Id<"campaigns">; view: EncounterView; fear: number; partyTier: number }) {
  const { encounter, instances } = view;
  const writes = useWritesEnabled();
  const actions = useTracker(campaignId, encounter._id);
  const hasCustom = instances.some((i) => i.source.kind === "custom");
  const customs = useQuery(api.encounterTracking.customBlocks, hasCustom ? { campaignId, encounterId: encounter._id } : "skip");
  const nextCostsFear = spotlightCostsFear(turnSpotlights(instances, encounter.gmTurn));

  return (
    <View accessibilityLabel="Encounter tracker" pointerEvents={writes ? "auto" : "none"} style={advStyles.section}>
      <TopBar actions={actions} fear={fear} partyTier={partyTier} view={view} />
      <ErrorLine message={actions.error} />
      {instances.length === 0 ? (
        <Text style={advStyles.muted}>This encounter has no adversaries yet. Add them in the builder.</Text>
      ) : (
        instances.map((instance) => (
          <InstanceCard
            actions={actions}
            block={blockFor(instance, customs ?? [])}
            gmTurn={encounter.gmTurn}
            instance={instance}
            key={instance._id}
            nextCostsFear={nextCostsFear}
          />
        ))
      )}
    </View>
  );
}
