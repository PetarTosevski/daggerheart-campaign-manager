import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { filterAdversaries, NO_FILTERS, typeLabel } from "../../../../../src/lib/adversaries/catalogue";
import { BP_ADJUSTMENTS, battlePoints } from "../../../../../src/lib/domain/encounters/budget";
import { api, type Id } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { useWritesEnabled } from "../../shell/offline";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";

import { AddToEncounterForm } from "./add-sheet";
import { useVisibleAdversaries } from "./catalogue";
import { Chip, ErrorLine, Stepper } from "./controls";
import { customTarget } from "./custom";
import { useAct } from "./intent";
import { advStyles } from "./styles";
import { STATUS_LABEL, type AddTarget, type EncounterList, type EncounterView } from "./types";

const MAX_PCS = 12;
const PICK_LIMIT = 20;

/** The builder's "+ Add adversary": search the SRD catalogue and the campaign's custom adversaries, then how many. */
function AddAdversarySheet({
  campaignId,
  encounterId,
  encounters,
  open,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  encounterId: string;
  encounters: EncounterList;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} open={open} title="Add adversary">
      {open ? <AddAdversaryPicker campaignId={campaignId} encounterId={encounterId} encounters={encounters} onClose={onClose} /> : null}
    </Sheet>
  );
}

function AddAdversaryPicker({
  campaignId,
  encounterId,
  encounters,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  encounterId: string;
  encounters: EncounterList;
  onClose: () => void;
}) {
  const campaign = useCampaign();
  const visible = useVisibleAdversaries(campaign.options.hopeAndFear, campaign.frameId);
  const customs = useQuery(api.customAdversaries.list, { campaignId });
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<AddTarget | null>(null);
  const hits = useMemo(() => filterAdversaries(visible, { ...NO_FILTERS, query }).slice(0, PICK_LIMIT), [visible, query]);
  const q = query.trim().toLowerCase();
  const customHits = (customs ?? []).filter((c) => q === "" || c.name.toLowerCase().includes(q)).slice(0, PICK_LIMIT);

  if (target) {
    return <AddToEncounterForm campaignId={campaignId} encounterId={encounterId} encounters={encounters} onClose={onClose} target={target} />;
  }
  return (
    <View style={advStyles.section}>
      <TextInput
        accessibilityLabel="Find an adversary"
        autoCorrect={false}
        onChangeText={setQuery}
        placeholder="Search the catalogue"
        style={advStyles.input}
        value={query}
      />
      {customHits.length > 0 ? <Text style={advStyles.label}>Custom</Text> : null}
      {customHits.map((c) => (
        <Pressable accessibilityRole="button" key={c._id} onPress={() => setTarget(customTarget(c))} style={advStyles.listRow}>
          <Text style={[advStyles.rowName, advStyles.grow]}>{c.name}</Text>
          <Text style={advStyles.muted}>
            T{c.tier} {c.type}
          </Text>
        </Pressable>
      ))}
      <Text style={advStyles.label}>Catalogue</Text>
      {hits.map((def) => (
        <Pressable
          accessibilityRole="button"
          key={def.id}
          onPress={() => setTarget({ source: { kind: "srd", adversaryId: def.id }, name: def.name, type: def.type, tier: def.tier })}
          style={advStyles.listRow}
        >
          <Text style={[advStyles.rowName, advStyles.grow]}>{def.name}</Text>
          <Text style={advStyles.muted}>
            T{def.tier} {typeLabel(def)}
          </Text>
        </Pressable>
      ))}
      {hits.length === 0 && customHits.length === 0 ? <Text style={advStyles.muted}>No adversary matches.</Text> : null}
    </View>
  );
}

function NameField({ campaignId, view }: { campaignId: Id<"campaigns">; view: EncounterView }) {
  const rename = useAct(api.encounters.rename);
  const [name, setName] = useState(view.encounter.name);
  function commit() {
    const next = name.trim();
    if (next === "" || next === view.encounter.name) {
      setName(view.encounter.name);
      return;
    }
    void rename.act({ campaignId, encounterId: view.encounter._id, name: next });
  }
  return (
    <>
      <TextInput
        accessibilityLabel="Encounter name"
        maxLength={80}
        onBlur={commit}
        onChangeText={setName}
        onSubmitEditing={commit}
        style={[advStyles.input, advStyles.h2]}
        value={name}
      />
      <ErrorLine message={rename.error} />
    </>
  );
}

function NotesField({ campaignId, view }: { campaignId: Id<"campaigns">; view: EncounterView }) {
  const setNotes = useAct(api.encounters.setNotes);
  const [notes, setText] = useState(view.encounter.notes ?? "");
  function commit() {
    if (notes === (view.encounter.notes ?? "")) return;
    void setNotes.act({ campaignId, encounterId: view.encounter._id, notes });
  }
  return (
    <>
      <Text style={advStyles.label}>Notes</Text>
      <TextInput
        accessibilityLabel="Encounter notes"
        multiline
        onBlur={commit}
        onChangeText={setText}
        placeholder="Terrain, goals, what happens if the party flees…"
        style={[advStyles.input, advStyles.textarea]}
        value={notes}
      />
      <ErrorLine message={setNotes.error} />
    </>
  );
}

/**
 * The selected encounter in the builder (D8 A3): name, status with Start / End / Delete, the Battle Points panel (party
 * size, the six adjustments of CB p.197 with the suggested ones marked), the adversaries in order, and notes.
 */
export function EncounterDetail({
  campaignId,
  view,
  encounters,
  onOpenTracker,
  onDeleted,
}: {
  campaignId: Id<"campaigns">;
  view: EncounterView;
  encounters: EncounterList;
  onOpenTracker: () => void;
  onDeleted: () => void;
}) {
  const campaign = useCampaign();
  const writes = useWritesEnabled();
  const { encounter, instances } = view;
  const start = useAct(api.encounters.start);
  const end = useAct(api.encounters.end);
  const remove = useAct(api.encounters.remove);
  const budget = useAct(api.encounters.setBudget);
  const reorder = useAct(api.encounters.reorder);
  const removeInstance = useAct(api.encounters.removeInstance);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const encounterId = encounter._id;
  const bp = battlePoints({
    pcs: encounter.pcs,
    adjustments: encounter.adjustments,
    entries: instances.map((i) => ({ type: i.type, tier: i.tier, summoned: i.summoned, minionCount: i.minionCount })),
    partyTier: campaign.tier,
  });
  const error = start.error ?? end.error ?? remove.error ?? budget.error ?? reorder.error ?? removeInstance.error;

  async function deleteEncounter() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const done = await remove.act({ campaignId, encounterId });
    if (done !== undefined) onDeleted();
  }

  return (
    <View accessibilityLabel="Encounter detail" style={advStyles.card}>
      <NameField campaignId={campaignId} key={`name-${encounterId}`} view={view} />
      <View style={advStyles.row}>
        <View style={advStyles.badge}>
          <Text style={advStyles.badgeText}>{STATUS_LABEL[encounter.status]}</Text>
        </View>
        {encounter.status === "running" ? (
          <Button disabled={!writes || end.pending} onPress={() => void end.act({ campaignId, encounterId })} variant="outline">
            End encounter
          </Button>
        ) : (
          <Button disabled={!writes || start.pending} onPress={() => void start.act({ campaignId, encounterId })} variant="solid">
            {encounter.status === "ended" ? "Start again" : "Start encounter"}
          </Button>
        )}
        <Button onPress={onOpenTracker} variant="outline">
          Open tracker
        </Button>
        <Button disabled={!writes || remove.pending} onPress={() => void deleteEncounter()} variant="danger">
          {confirmDelete ? "Tap again to delete" : "Delete"}
        </Button>
      </View>
      <ErrorLine message={error} />

      <Text style={advStyles.label}>Battle Points</Text>
      <Text style={advStyles.h3}>{bp.verdict}</Text>
      <Text style={advStyles.stat}>
        Spent {bp.spent} of {bp.budget} BP{bp.minionGroups > 0 ? ` · ${bp.minionGroups} Minion group${bp.minionGroups === 1 ? "" : "s"}` : ""}
      </Text>
      <View
        accessibilityLabel="Battle Points spent"
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: bp.budget, now: bp.spent }}
        style={advStyles.meter}
      >
        <View style={[advStyles.meterFill, bp.state === "over" ? advStyles.meterOver : null, { width: `${bp.percent}%` }]} />
      </View>
      <Text style={advStyles.label}>Player characters</Text>
      <Stepper
        downDisabled={!writes || encounter.pcs <= 1}
        label="Player characters"
        onDown={() => void budget.act({ campaignId, encounterId, change: { kind: "pcs", delta: -1 } })}
        onUp={() => void budget.act({ campaignId, encounterId, change: { kind: "pcs", delta: 1 } })}
        upDisabled={!writes || encounter.pcs >= MAX_PCS}
        value={String(encounter.pcs)}
      />
      <View style={advStyles.row}>
        {BP_ADJUSTMENTS.map((a) => {
          const on = encounter.adjustments.includes(a.id);
          return (
            <Chip
              disabled={!writes}
              hint={bp.hints.includes(a.id)}
              key={a.id}
              label={`${a.label} (${a.delta > 0 ? "+" : ""}${a.delta})`}
              on={on}
              onPress={() => void budget.act({ campaignId, encounterId, change: { kind: "adjustment", adjustment: a.id, on: !on } })}
              role="switch"
            />
          );
        })}
      </View>
      {bp.hints.length > 0 ? <Text style={advStyles.muted}>Dashed adjustments are suggested by the adversaries in this encounter.</Text> : null}

      <View style={advStyles.between}>
        <Text style={advStyles.label}>Adversaries</Text>
        <Button disabled={!writes} onPress={() => setAdding(true)} variant="outline">
          + Add adversary
        </Button>
      </View>
      {instances.length === 0 ? <Text style={advStyles.muted}>No adversaries yet. Add them here or from a stat block in the Catalogue.</Text> : null}
      {instances.map((instance, i) => (
        <View key={instance._id} style={advStyles.listRow}>
          <View style={advStyles.grow}>
            <Text style={advStyles.rowName}>{instance.label}</Text>
            <Text style={advStyles.muted}>
              {instance.name === null ? "Deleted custom adversary" : `Tier ${instance.tier ?? "?"} ${instance.type ?? ""}`}
              {instance.minionCount !== undefined ? ` · ${instance.minionCount} Minions` : ""}
              {instance.summoned ? " · Summoned" : ""}
            </Text>
          </View>
          <Button
            accessibilityLabel={`Move ${instance.label} up`}
            disabled={!writes || i === 0}
            onPress={() => void reorder.act({ campaignId, instanceId: instance._id, direction: "up" })}
            variant="outline"
          >
            ↑
          </Button>
          <Button
            accessibilityLabel={`Move ${instance.label} down`}
            disabled={!writes || i === instances.length - 1}
            onPress={() => void reorder.act({ campaignId, instanceId: instance._id, direction: "down" })}
            variant="outline"
          >
            ↓
          </Button>
          <Button
            accessibilityLabel={`Remove ${instance.label}`}
            disabled={!writes}
            onPress={() => void removeInstance.act({ campaignId, instanceId: instance._id })}
            variant="danger"
          >
            ×
          </Button>
        </View>
      ))}
      <NotesField campaignId={campaignId} key={`notes-${encounterId}`} view={view} />
      <AddAdversarySheet campaignId={campaignId} encounterId={encounterId} encounters={encounters} onClose={() => setAdding(false)} open={adding} />
    </View>
  );
}
