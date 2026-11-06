import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useMemo, useState, type ComponentType } from "react";
import { ScrollView, Text, View } from "react-native";

import { cardHolders, type SharedCardsMode } from "../../../../../../src/lib/domain/characters";
import { FRAME_OF } from "../../../../../../src/lib/frames/extras/common";
import { isTypedWizardPatch, wizardFromDraft } from "../../../../../../src/lib/party/wizard-draft";
import {
  canReach,
  emptyWizard,
  incompleteSteps,
  missingByStep,
  normalizeWizard,
  portraitAsset,
  sharedCardsMissing,
  STEP_COUNT,
  STEP_TITLES,
  stillNeeded,
  toCharacterDraft,
  type WizardState,
} from "../../../../../../src/lib/party/wizard-logic";
import { getDomainCard } from "../../../../../../src/lib/srd";
import { api } from "../../../convex";
import type { Id } from "../../../convex";
import { useCampaign } from "../../../shell/campaign-provider";
import { useWritesEnabled } from "../../../shell/offline";
import { Button } from "../../../ui/button";
import { Loading } from "../../../ui/loading";
import { useIntent } from "../../trackers/intent";
import { useAccountDraft } from "./account-draft";
import { ClassStep, HeritageStep, InfoStep, TraitsStep } from "./steps-1-4";
import { BackgroundStep, ConnectionsStep, DomainCardsStep, EquipmentStep, ExperiencesStep } from "./steps-5-9";
import { wizardStyles as s } from "./styles";
import type { SharedCards, StepProps } from "./wizard-ui";

const STEPS: ComponentType<StepProps>[] = [
  ClassStep,
  HeritageStep,
  TraitsStep,
  InfoStep,
  EquipmentStep,
  BackgroundStep,
  ExperiencesStep,
  DomainCardsStep,
  ConnectionsStep,
];

/** Who holds which card, from `charactersReads.listByCampaign` (vault and loadout); empty under `allow`. */
function partyCardHolders(
  mode: SharedCardsMode,
  party: readonly { _id: string; sheet: { name: string; domainCards: { owned: readonly string[]; loadout: readonly string[] } } }[],
): ReadonlyMap<string, readonly string[]> {
  if (mode === "allow") return new Map();
  return cardHolders(party.map((row) => ({ id: row._id, name: row.sheet.name, cards: [...row.sheet.domainCards.owned, ...row.sheet.domainCards.loadout] })));
}

/**
 * The 9-step character creation wizard (Core ch. 1). Its unsent draft lives on the account (`useAccountDraft`, config
 * U6f) like the website's, so the wizard opens once the draft has loaded and starts from it.
 */
export function CharacterWizard() {
  const campaign = useCampaign();
  const draft = useAccountDraft({ kind: "characterWizard", campaignId: campaign._id });
  if (draft.stored === undefined) return <Loading label="Loading character creation" />;
  return <Wizard draft={draft} initial={wizardFromDraft(draft.stored)} />;
}

function Wizard({ draft, initial }: { draft: ReturnType<typeof useAccountDraft>; initial: WizardState }) {
  const campaign = useCampaign();
  const campaignId = campaign._id;
  const router = useRouter();
  const writes = useWritesEnabled();
  const isGm = campaign.role === "gm";
  const ikonis = campaign.frameId === FRAME_OF.motherboard;
  const opts = useMemo(() => ({ hopeAndFear: campaign.options.hopeAndFear, ikonis }), [campaign.options.hopeAndFear, ikonis]);
  const roster = useQuery(api.members.roster, isGm ? { campaignId } : "skip");
  const party = useQuery(api.charactersReads.listByCampaign, { campaignId });
  const rules = useQuery(api.ruleSettings.get, { campaignId });
  const create = useIntent(api.characters.create);

  const [raw, setRaw] = useState<WizardState>(initial);
  const state = useMemo(() => normalizeWizard(raw, opts), [raw, opts]);
  // Shared domain cards (CB p.21, rule-switches OSC): Warn notes a card another character holds, Refuse holds step 8.
  const mode = rules?.modes.sharedDomainCards;
  const shared = useMemo<SharedCards | undefined>(
    () => (mode === undefined || party === undefined ? undefined : { mode, holders: partyCardHolders(mode, party) }),
    [mode, party],
  );
  const missing = useMemo(() => {
    const base = missingByStep(state, opts);
    if (!shared) return base;
    const refused = sharedCardsMissing(state.domainCards, shared.mode, shared.holders, (id) => getDomainCard(id)?.name ?? id);
    return refused.length === 0 ? base : { ...base, 8: [...(base[8] ?? []), ...refused] };
  }, [state, opts, shared]);
  const step = state.step;

  if (party === undefined) {
    return <Loading label="Loading character creation" />;
  }

  // Saved from the change itself (rule 13): typing waits for a pause, a tap saves at once.
  const update = (patch: Partial<WizardState>) => {
    const next = { ...normalizeWizard(raw, opts), ...patch };
    setRaw(next);
    draft.save(next, { typed: isTypedWizardPatch(patch) });
  };
  const startOver = () => {
    setRaw(emptyWizard());
    draft.clear();
  };
  // Cancel keeps the draft (the website's rule): a typed change still waiting for its pause goes out now.
  const cancel = () => {
    draft.flush();
    router.back();
  };

  const owners = roster
    ? [{ userId: roster.gm.userId, name: `${roster.gm.name} (you)` }, ...roster.players.map((p) => ({ userId: p.userId, name: p.name }))]
    : [];
  const ownerId = isGm && owners.some((o) => o.userId === state.ownerId) ? (state.ownerId as Id<"users">) : undefined;
  const playerId = isGm ? (ownerId !== roster?.gm.userId ? ownerId : undefined) : undefined;
  const blocker = party.find(
    (c) => c.status === "active" && (isGm ? playerId !== undefined && c.ownerId === playerId : c.mine),
  );

  const stepMissing = missing[step] ?? [];
  const stepOk = stepMissing.length === 0;
  const allOk = canReach(STEP_COUNT + 1, missing);
  const goTo = (n: number) => update({ step: Math.min(STEP_COUNT, Math.max(1, n)) });

  async function submit() {
    if (!allOk || blocker || create.pending || !writes) return;
    const result = await create.fire({
      campaignId,
      draft: toCharacterDraft(state, portraitAsset(state)),
      ...(ownerId ? { ownerId } : {}),
      ...(ikonis ? { ikonis: state.ikonis } : {}),
    });
    if (result) {
      draft.clear();
      router.replace(`/campaign/${campaignId}/party/${result.characterId}`);
    }
  }

  const Step = STEPS[step - 1];
  const nextTip = stillNeeded(stepMissing);
  const createTip = allOk ? "" : `Finish the earlier steps first: ${incompleteSteps(missing).join(", ")}`;
  const hasDraft = JSON.stringify(raw) !== JSON.stringify({ ...emptyWizard(), step: raw.step });

  return (
    <ScrollView contentContainerStyle={s.content} style={s.screen}>
      <View style={s.paper}>
        <Text style={s.kicker}>
          Create character · Step {step} of {STEP_COUNT}
        </Text>
        <Text accessibilityRole="header" style={s.title}>
          {STEP_TITLES[step - 1]}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          {hasDraft ? (
            <Button onPress={startOver} variant="outline">
              Start over
            </Button>
          ) : null}
          <Button onPress={cancel} variant="outline">
            Cancel
          </Button>
        </View>

        {isGm ? (
          <View style={{ gap: 8 }}>
            <Text nativeID="cc-owner-label" style={s.label}>
              Character for
            </Text>
            <View accessibilityLabel="Character for" accessibilityRole="menu" style={s.chipRow}>
              <ChoiceOwner
                checked={!ownerId}
                label={roster ? `${roster.gm.name} (you)` : "You"}
                onPress={() => update({ ownerId: null })}
              />
              {owners.slice(1).map((o) => (
                <ChoiceOwner
                  key={o.userId}
                  checked={ownerId === o.userId}
                  label={o.name}
                  onPress={() => update({ ownerId: o.userId })}
                />
              ))}
            </View>
          </View>
        ) : null}

        {blocker ? (
          <Text accessibilityRole="alert" nativeID="cc-blocked" style={s.blocked} testID="wizard-blocked">
            {blocker.sheet.name} is still active, and a player has one active character at a time. Send {blocker.sheet.name}{" "}
            away from the Party page before creating another.
          </Text>
        ) : null}

        <View accessibilityRole="tablist" style={s.stepRow}>
          {STEP_TITLES.map((title, i) => {
            const n = i + 1;
            const reachable = n <= step || canReach(n, missing);
            const done = (missing[n] ?? []).length === 0 && n < step;
            return (
              <Button
                accessibilityLabel={`Step ${n}: ${title}${done ? " (done)" : ""}`}
                disabled={!reachable}
                key={title}
                onPress={() => goTo(n)}
                size="md"
                variant={n === step ? "primary" : "outline"}
              >
                {String(n)}
              </Button>
            );
          })}
        </View>

        <Step opts={opts} shared={shared} state={state} update={update} />

        <View style={s.footer}>
          {step > 1 ? (
            <Button onPress={() => goTo(step - 1)} variant="outline">
              ‹ Back
            </Button>
          ) : (
            <Button onPress={cancel} variant="outline">
              Cancel
            </Button>
          )}
          <View style={{ alignItems: "flex-end", flex: 1, gap: 8 }}>
            {step < STEP_COUNT ? (
              <>
                <Button disabled={!stepOk || !writes} onPress={() => stepOk && goTo(step + 1)} variant="primary">
                  {`Next: ${STEP_TITLES[step]} ›`}
                </Button>
                {nextTip ? (
                  <Text accessibilityLiveRegion="polite" nativeID="cc-next-missing" style={s.req}>
                    {nextTip}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Button
                  disabled={!allOk || Boolean(blocker) || create.pending || !writes}
                  onPress={() => void submit()}
                  variant="primary"
                >
                  {create.pending ? "Creating…" : "Create character"}
                </Button>
                {createTip ? (
                  <Text accessibilityLiveRegion="polite" nativeID="cc-missing" style={s.req}>
                    {createTip}
                  </Text>
                ) : null}
              </>
            )}
            {create.error ? (
              <Text accessibilityRole="alert" style={s.error}>
                {create.error}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function ChoiceOwner({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Button onPress={onPress} variant={checked ? "solid" : "outline"}>
      {label}
    </Button>
  );
}
