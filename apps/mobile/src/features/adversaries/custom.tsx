import { useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { blank } from "../../../../../src/lib/adversaries/custom";
import { api, type Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { Button } from "../../ui/button";
import { Loading } from "../../ui/loading";

import { ErrorLine } from "./controls";
import { CustomEditor } from "./editor";
import { useAct, useIntent } from "./intent";
import { StatBlock } from "./stat-block";
import { advStyles } from "./styles";
import type { AddTarget, CustomAdversary } from "./types";

export function customTarget(custom: CustomAdversary): AddTarget {
  return { source: { kind: "custom", customId: custom._id }, name: custom.name, type: custom.type, tier: custom.tier };
}

/**
 * The campaign's custom adversaries under the catalogue (D8 A5): a list, the selected stat block with Add to
 * encounter, Edit and Delete, and "+ New custom adversary" (a blank Tier 1 Standard with the improvised statistics).
 */
export function CustomAdversaries({
  campaignId,
  selectedId,
  editingId,
  onSelect,
  onEdit,
  onAdd,
}: {
  campaignId: Id<"campaigns">;
  selectedId: string | null;
  editingId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  onAdd: (target: AddTarget) => void;
}) {
  const writes = useWritesEnabled();
  const customs = useQuery(api.customAdversaries.list, { campaignId });
  const create = useIntent(api.customAdversaries.create);
  const remove = useAct(api.customAdversaries.remove);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function newCustom() {
    const created = await create.fire({ campaignId, adversary: blank(1, "Standard") });
    if (created) {
      onSelect(created.customId);
      onEdit(created.customId);
    }
  }

  async function deleteCustom(custom: CustomAdversary) {
    if (confirming !== custom._id) {
      setConfirming(custom._id);
      return;
    }
    setConfirming(null);
    const done = await remove.act({ campaignId, customId: custom._id });
    if (done !== undefined) onSelect(null);
  }

  return (
    <View style={advStyles.section}>
      <Text accessibilityRole="header" style={advStyles.h2}>
        Custom adversaries
      </Text>
      <Text style={advStyles.muted}>Your own stat blocks: duplicate one from the catalogue, or start from a blank block.</Text>
      <Button disabled={!writes || create.pending} onPress={() => void newCustom()} variant="outline">
        + New custom adversary
      </Button>
      <ErrorLine message={create.error ?? remove.error} />
      {customs === undefined ? (
        <Loading label="Loading custom adversaries" />
      ) : customs.length === 0 ? (
        <Text style={advStyles.muted}>No custom adversaries yet.</Text>
      ) : (
        customs.map((custom) => {
          const open = custom._id === selectedId;
          return (
            <View key={custom._id} style={advStyles.section}>
              <Pressable
                accessibilityLabel={custom.name}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => {
                  onSelect(open ? null : custom._id);
                  onEdit(null);
                }}
                style={[advStyles.listRow, open ? advStyles.listRowOn : null]}
              >
                <View style={advStyles.grow}>
                  <Text style={advStyles.rowName}>{custom.name}</Text>
                  <Text style={advStyles.muted}>
                    Tier {custom.tier} {custom.type} · Custom
                  </Text>
                </View>
              </Pressable>
              {open && editingId === custom._id ? (
                <CustomEditor campaignId={campaignId} custom={custom} key={custom._id} onDone={() => onEdit(null)} />
              ) : open ? (
                <StatBlock
                  actions={
                    <>
                      <Button accessibilityLabel={`Add ${custom.name} to an encounter`} onPress={() => onAdd(customTarget(custom))} variant="outline">
                        + Add to encounter
                      </Button>
                      <Button disabled={!writes} onPress={() => onEdit(custom._id)} variant="outline">
                        Edit
                      </Button>
                      <Button disabled={!writes || remove.pending} onPress={() => void deleteCustom(custom)} variant="danger">
                        {confirming === custom._id ? "Tap again to delete" : "Delete"}
                      </Button>
                    </>
                  }
                  block={custom}
                  subtitle="Custom"
                />
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}
