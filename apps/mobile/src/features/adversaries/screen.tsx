import { useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { fromSrd } from "../../../../../src/lib/adversaries/custom";
import { countLine } from "../../../../../src/lib/adversaries/catalogue";
import type { AdversaryDef } from "../../../../../src/lib/srd/types";
import { api } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { useWritesEnabled } from "../../shell/offline";
import { sectionLabel } from "../../shell/sections";
import { Button } from "../../ui/button";
import { Loading } from "../../ui/loading";

import { AddToEncounterSheet } from "./add-sheet";
import { Catalogue, useVisibleAdversaries } from "./catalogue";
import { ErrorLine, SlotBoundary } from "./controls";
import { CustomAdversaries } from "./custom";
import { EncountersTab } from "./encounters";
import { EnvironmentsTab } from "./environments";
import { useIntent } from "./intent";
import { advStyles } from "./styles";
import type { AddTarget } from "./types";

const TABS = [
  { id: "catalogue", label: "Catalogue" },
  { id: "encounters", label: "Encounters" },
  { id: "environment", label: "Environment" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Ended encounters listed at first, and per "Show more". */
const ENDED_PAGE = 20;

function srdTarget(def: AdversaryDef): AddTarget {
  return { source: { kind: "srd", adversaryId: def.id }, name: def.name, type: def.type, tier: def.tier };
}

/**
 * Adversaries (D8), GM only: the route renders this after `campaigns.get` says the caller is the GM, so a player
 * never subscribes. Catalogue (SRD stat blocks, then custom adversaries), Encounters (builder with the tracker
 * inline) and Environment tabs. One `encounters.list` serves the builder and every "Add to encounter".
 */
export function AdversariesView() {
  const campaign = useCampaign();
  const campaignId = campaign._id;
  const { hopeAndFear } = campaign.options;
  const writes = useWritesEnabled();
  const [tab, setTab] = useState<TabId>("catalogue");
  const [endedLimit, setEndedLimit] = useState(ENDED_PAGE);
  const encounters = useQuery(api.encounters.list, { campaignId, endedLimit });
  const [adding, setAdding] = useState<AddTarget | null>(null);
  const [selectedCustom, setSelectedCustom] = useState<string | null>(null);
  const [editingCustom, setEditingCustom] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const duplicate = useIntent(api.customAdversaries.create);
  const visible = useVisibleAdversaries(hopeAndFear, campaign.frameId);

  async function duplicateAndEdit(def: AdversaryDef) {
    const { basedOn, ...adversary } = fromSrd(def);
    const created = await duplicate.fire({ campaignId, adversary, basedOn });
    if (!created) return;
    setTab("catalogue");
    setSelectedCustom(created.customId);
    setEditingCustom(created.customId);
  }

  function renderActions(def: AdversaryDef) {
    return (
      <>
        <Button accessibilityLabel={`Add ${def.name} to an encounter`} onPress={() => setAdding(srdTarget(def))} variant="outline">
          + Add to encounter
        </Button>
        <Button disabled={!writes || duplicate.pending} onPress={() => void duplicateAndEdit(def)} variant="outline">
          Duplicate & edit
        </Button>
      </>
    );
  }

  const blurb = hopeAndFear
    ? "Adversary and environment stat blocks from the Core Rulebook and Hope & Fear, with encounters and their Battle Points. Only you can see this page."
    : "Adversary and environment stat blocks from the Core Rulebook, with encounters and their Battle Points. Only you can see this page.";

  return (
    <ScrollView contentContainerStyle={advStyles.stack} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={advStyles.title}>
        {sectionLabel("adversaries")}
      </Text>
      <Text style={advStyles.muted}>{countLine(visible, visible.length)}</Text>
      <Text style={advStyles.body}>{blurb}</Text>

      <View accessibilityLabel="Adversary views" accessibilityRole="tablist" style={advStyles.tabRow}>
        {TABS.map((t) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.id }}
            key={t.id}
            onPress={() => setTab(t.id)}
            style={[advStyles.tab, tab === t.id ? advStyles.tabOn : null]}
          >
            <Text style={[advStyles.tabText, tab === t.id ? advStyles.tabTextOn : null]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorLine message={duplicate.error} />

      {tab === "catalogue" ? (
        <>
          <SlotBoundary label="The catalogue">
            <Catalogue frameId={campaign.frameId} hopeAndFear={hopeAndFear} renderActions={renderActions} />
          </SlotBoundary>
          <SlotBoundary label="Custom adversaries">
            <CustomAdversaries
              campaignId={campaignId}
              editingId={editingCustom}
              onAdd={setAdding}
              onEdit={setEditingCustom}
              onSelect={setSelectedCustom}
              selectedId={selectedCustom}
            />
          </SlotBoundary>
        </>
      ) : tab === "encounters" ? (
        <SlotBoundary label="Encounters">
          {encounters === undefined ? (
            <Loading label="Loading encounters" />
          ) : (
            <EncountersTab campaignId={campaignId} encounters={encounters} onMoreEnded={() => setEndedLimit((n) => n + ENDED_PAGE)} />
          )}
        </SlotBoundary>
      ) : (
        <SlotBoundary label="Environments">
          <EnvironmentsTab
            campaignId={campaignId}
            frameId={campaign.frameId}
            hopeAndFear={hopeAndFear}
            onSelect={setEnvironmentId}
            renderAdversaryActions={renderActions}
            selectedId={environmentId}
          />
        </SlotBoundary>
      )}
      <AddToEncounterSheet campaignId={campaignId} encounters={encounters} onClose={() => setAdding(null)} target={adding} />
    </ScrollView>
  );
}
