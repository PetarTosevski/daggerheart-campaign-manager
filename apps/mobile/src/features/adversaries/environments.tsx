import { useMutation, useQuery } from "convex/react";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { moreLabel, PAGE_FIRST, PAGE_MORE, toggleChip, type CatalogueTier } from "../../../../../src/lib/adversaries/catalogue";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import {
  environmentCountLine,
  environmentsFor,
  environmentTierLine,
  featureCountdownLabels,
  filterEnvironments,
  groupEnvironmentsByTier,
  NO_ENVIRONMENT_FILTERS,
  type EnvironmentFilters,
} from "../../../../../src/lib/domain/environments";
import { FEAR_HIDDEN_LABEL, fearShown } from "../../../../../src/components/combat-map/hud/fear/hidden";
import { MAX_FEAR } from "../../../../../src/lib/domain/fear";
import { ADVERSARIES } from "../../../../../src/lib/srd/adversaries";
import { ENVIRONMENTS } from "../../../../../src/lib/srd/environments";
import { ENVIRONMENT_TYPES, type AdversaryDef, type EnvironmentDef, type EnvironmentFeature } from "../../../../../src/lib/srd/types";
import { api, type Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { Button } from "../../ui/button";
import { Loading } from "../../ui/loading";

import { Chip } from "./controls";
import { newKey } from "./intent";
import { FeatureText, StatBlock } from "./stat-block";
import { advStyles } from "./styles";
import { withOptimistic } from "./use-tracker";

const TIERS: readonly CatalogueTier[] = [1, 2, 3, 4];
const ADVERSARY_BY_ID = new Map<string, AdversaryDef>(ADVERSARIES.map((a) => [a.id, a]));
const KIND_LABEL = { passive: "Passive", action: "Action", reaction: "Reaction" } as const;

type Status = { environmentId: string; text: string; error: boolean };

/** Spend a feature's Fear and start its countdown (Private) on the dashboard (EF1). */
function useEnvironmentActions(campaignId: Id<"campaigns">) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const spend = withOptimistic(useMutation(api.environmentActions.spendFear), (store, { environmentId, featureName }) => {
    const fear = store.getQuery(api.campaigns.fear, { campaignId });
    const cost = ENVIRONMENTS.find((e) => e.id === environmentId)?.features.find((f) => f.name === featureName)?.fearCost;
    if (fear === undefined || fear === null || cost === undefined || fear < cost) return;
    store.setQuery(api.campaigns.fear, { campaignId }, fear - cost);
  });
  const start = useMutation(api.environmentActions.startCountdown);

  async function run(environment: EnvironmentDef, feature: EnvironmentFeature, action: "spend" | "start", label?: string) {
    setPending(`${environment.id}/${feature.name}`);
    setStatus(null);
    const args = { campaignId, environmentId: environment.id, featureName: feature.name, idempotencyKey: newKey() };
    try {
      if (action === "spend") {
        const { spent } = await spend(args);
        setStatus({ environmentId: environment.id, text: `Spent ${spent} Fear: ${feature.name}`, error: false });
      } else {
        const { name, startingValue } = await start(label === undefined ? args : { ...args, label });
        setStatus({ environmentId: environment.id, text: `Countdown started on the dashboard: ${name} at ${startingValue} (private)`, error: false });
      }
    } catch (caught) {
      setStatus({ environmentId: environment.id, text: errorMessage(caught), error: true });
    } finally {
      setPending(null);
    }
  }

  return {
    statusFor: (environmentId: string) => (status?.environmentId === environmentId ? status : null),
    pending: (environment: EnvironmentDef, feature: EnvironmentFeature) => pending === `${environment.id}/${feature.name}`,
    spendFear: (environment: EnvironmentDef, feature: EnvironmentFeature) => run(environment, feature, "spend"),
    startCountdown: (environment: EnvironmentDef, feature: EnvironmentFeature, label: string) => run(environment, feature, "start", label),
  };
}

type EnvironmentActions = ReturnType<typeof useEnvironmentActions>;

function FeatureActions({
  environment,
  feature,
  fear,
  actions,
}: {
  environment: EnvironmentDef;
  feature: EnvironmentFeature;
  /** null: the GM's Fear is hidden from this caller; no spend is offered against a pool it cannot see. */
  fear: number | null;
  actions: EnvironmentActions;
}) {
  const writes = useWritesEnabled();
  const cost = feature.fearCost;
  const countdowns = featureCountdownLabels(feature);
  if (cost === undefined && countdowns.length === 0) return null;
  const busy = actions.pending(environment, feature);
  const short = cost !== undefined && fear !== null && fear < cost;
  return (
    <View style={advStyles.row}>
      {cost !== undefined ? (
        <Button disabled={!writes || fear === null || short || busy} onPress={() => void actions.spendFear(environment, feature)} variant="outline">
          {`Spend ${cost} Fear`}
        </Button>
      ) : null}
      {countdowns.map((label) => (
        <Button
          disabled={!writes || busy}
          key={label}
          onPress={() => void actions.startCountdown(environment, feature, label)}
          variant="outline"
        >
          {countdowns.length === 1 ? "Start countdown" : `Start ${label}`}
        </Button>
      ))}
      {short ? <Text style={advStyles.muted}>{fear === 0 ? "No Fear to spend." : `You hold ${fear} Fear.`}</Text> : null}
    </View>
  );
}

function EnvironmentBlock({
  environment,
  fear,
  actions,
  onOpenAdversary,
}: {
  environment: EnvironmentDef;
  fear: number | null;
  actions: EnvironmentActions;
  onOpenAdversary: (adversaryId: string) => void;
}) {
  const status = actions.statusFor(environment.id);
  const refs = environment.potentialAdversaries.flatMap((r): { name: string; adversaryId?: string; group: string | null }[] =>
    r.members ? r.members.map((m) => ({ name: m.name, adversaryId: m.adversaryId, group: r.name })) : [{ name: r.name, adversaryId: r.adversaryId, group: null }],
  );
  return (
    <View accessibilityLabel={`${environment.name} stat block`} style={advStyles.paper}>
      <Text accessibilityRole="header" style={advStyles.h2}>
        {environment.name}
      </Text>
      <Text style={advStyles.label}>{environmentTierLine(environment)}</Text>
      <Text accessibilityLabel={fear === null ? `GM Fear: ${FEAR_HIDDEN_LABEL}` : `GM Fear ${fear} of ${MAX_FEAR}`} style={advStyles.fear}>
        GM Fear {fearShown(fear)}/{MAX_FEAR}
      </Text>
      <Text style={advStyles.serifItalic}>{environment.description}</Text>
      <Text style={advStyles.stat}>
        <Text style={advStyles.statStrong}>Impulses: </Text>
        {environment.impulses}
      </Text>
      <Text style={advStyles.stat}>
        <Text style={advStyles.statStrong}>Difficulty: </Text>
        {String(environment.difficulty)}
      </Text>
      {refs.length > 0 ? (
        <>
          <Text style={advStyles.label}>Potential adversaries</Text>
          <View style={advStyles.row}>
            {refs.map((ref, i) =>
              ref.adversaryId && ADVERSARY_BY_ID.has(ref.adversaryId) ? (
                <Chip key={`${ref.name}-${i}`} label={ref.name} on={false} onPress={() => onOpenAdversary(ref.adversaryId!)} />
              ) : (
                <Text key={`${ref.name}-${i}`} style={advStyles.muted}>
                  {ref.group ? `${ref.group}: ${ref.name}` : ref.name}
                </Text>
              ),
            )}
          </View>
        </>
      ) : null}
      <Text style={advStyles.label}>Features</Text>
      {environment.features.map((feature) => (
        <View key={feature.name} style={advStyles.section}>
          <Text style={advStyles.h3}>
            {feature.countdown ? `${feature.name} (${feature.countdown})` : feature.name} - {KIND_LABEL[feature.kind]}
          </Text>
          <FeatureText text={feature.text} />
          {feature.questions ? <Text style={advStyles.serifItalic}>{feature.questions}</Text> : null}
          <FeatureActions actions={actions} environment={environment} feature={feature} fear={fear} />
        </View>
      ))}
      {status ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole={status.error ? "alert" : "text"} style={status.error ? advStyles.error : advStyles.status}>
          {status.text}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The Environment tab (D8 EV1, EF1): the SRD environments this campaign sees with search and tier/type chips, the
 * selected stat block with Fear spends and countdown starts, and its Potential Adversaries opened above the list
 * with the catalogue's actions.
 */
export function EnvironmentsTab({
  campaignId,
  hopeAndFear,
  frameId,
  selectedId,
  onSelect,
  renderAdversaryActions,
}: {
  campaignId: Id<"campaigns">;
  hopeAndFear: boolean;
  frameId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  renderAdversaryActions: (def: AdversaryDef) => ReactNode;
}) {
  const fear = useQuery(api.campaigns.fear, { campaignId });
  const actions = useEnvironmentActions(campaignId);
  const visible = useMemo(() => environmentsFor(ENVIRONMENTS, { hopeAndFear, frameId }), [hopeAndFear, frameId]);
  const [filters, setFilters] = useState<EnvironmentFilters>(NO_ENVIRONMENT_FILTERS);
  const [limit, setLimit] = useState(PAGE_FIRST);
  const [opened, setOpened] = useState<{ adversaryId: string; from: string } | null>(null);
  const shown = useMemo(() => filterEnvironments(visible, filters), [visible, filters]);
  const groups = groupEnvironmentsByTier(shown, limit);
  const more = moreLabel(shown.length, limit);
  const openedDef = opened ? ADVERSARY_BY_ID.get(opened.adversaryId) : undefined;

  function setFilter(next: Partial<EnvironmentFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setLimit(PAGE_FIRST);
  }

  if (fear === undefined) return <Loading label="Loading environments" />;

  return (
    <View style={advStyles.section}>
      {opened && openedDef ? (
        <View style={advStyles.section}>
          <Text style={advStyles.muted}>From {opened.from}</Text>
          <StatBlock actions={renderAdversaryActions(openedDef)} block={openedDef} />
          <Button onPress={() => setOpened(null)} variant="outline">
            Close adversary
          </Button>
        </View>
      ) : null}
      <TextInput
        accessibilityLabel="Search environments"
        autoCorrect={false}
        onChangeText={(query) => setFilter({ query })}
        placeholder="Search environments"
        style={advStyles.input}
        value={filters.query}
      />
      <Text style={advStyles.muted}>{environmentCountLine(visible, shown.length)}</Text>
      <View style={advStyles.row}>
        {TIERS.map((tier) => (
          <Chip key={tier} label={`Tier ${tier}`} on={filters.tier === tier} onPress={() => setFilter({ tier: toggleChip(filters.tier, tier) })} />
        ))}
      </View>
      <View style={advStyles.row}>
        {ENVIRONMENT_TYPES.map((type) => (
          <Chip key={type} label={type} on={filters.type === type} onPress={() => setFilter({ type: toggleChip(filters.type, type) })} />
        ))}
      </View>
      {shown.length === 0 ? <Text style={advStyles.muted}>No environment matches.</Text> : null}
      {groups.map((group) => (
        <View key={group.tier} style={advStyles.section}>
          <View>
            <Text accessibilityRole="header" style={advStyles.h3}>
              {group.title}
            </Text>
            <Text style={advStyles.muted}>{group.sub}</Text>
          </View>
          {group.entries.map((environment) => {
            const open = environment.id === selectedId;
            return (
              <View key={environment.id} style={advStyles.section}>
                <Pressable
                  accessibilityLabel={environment.name}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => onSelect(open ? null : environment.id)}
                  style={[advStyles.listRow, open ? advStyles.listRowOn : null]}
                >
                  <View style={advStyles.grow}>
                    <Text style={advStyles.rowName}>{environment.name}</Text>
                    <Text style={advStyles.muted}>{environmentTierLine(environment)}</Text>
                  </View>
                </Pressable>
                {open ? (
                  <EnvironmentBlock
                    actions={actions}
                    environment={environment}
                    fear={fear}
                    onOpenAdversary={(adversaryId) => setOpened({ adversaryId, from: environment.name })}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
      {more ? (
        <Button onPress={() => setLimit((n) => n + PAGE_MORE)} variant="outline">
          {more}
        </Button>
      ) : null}
    </View>
  );
}
