import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import { useState } from "react";
import { Text, View } from "react-native";

import { BRUSHES } from "../../../../../../src/components/combat-map/editor/edit-model";
import { errorMessage } from "../../../../../../src/lib/convex-errors";

import { api, type Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { withOptimistic } from "../../adversaries/use-tracker";
import { Panel, QueryLoading } from "../../dashboard/chrome";

import { Chip, ChipRow, dockText } from "../chip";
import { useCombatGm } from "./context";
import { useGmMapTools, type FogTool } from "./map-tools";
import { gmStyles } from "./styles";

const FOG_TOOLS: { tool: FogTool; label: string }[] = [
  { tool: "off", label: "Off" },
  { tool: "reveal", label: "Reveal" },
  { tool: "hide", label: "Hide" },
  { tool: "erase", label: "Erase" },
];

/** Doors in reading order, "Door 1" / "Gate 2" by kind (a solid door blocks sight, a gate does not). */
function doorNames(doors: readonly { _id: string; x: number; y: number; solid: boolean }[]): Map<string, string> {
  const names = new Map<string, string>();
  let door = 0;
  let gate = 0;
  for (const d of [...doors].sort((a, b) => a.y - b.y || a.x - b.x)) {
    names.set(d._id, d.solid ? `Door ${++door}` : `Gate ${++gate}`);
  }
  return names;
}

/**
 * The GM's vision tools on the phone (R10-R12, map-movement M2; dcm-gdzi.17):
 * - View as: the GM's own view, or exactly what one PC's player gets (`previewAs`, drawn on the map with their fog);
 * - Fog brush: Reveal / Hide / Erase with a 1-3 square brush, painted by dragging on the map (one `paintFog` per stroke);
 * - Doors: every door and gate on the map, open or closed (`toggleDoor`, the wanted state);
 * - Reveal: a token shown to, or hidden from, each PC after a successful roll (`revealTo` / `unrevealTo`).
 * Every write is an intent with an optimistic update; a refusal shows as an alert, never an unhandled rejection.
 */
export function CombatGmVision() {
  const { campaignId, layout, tokens, doors } = useCombatGm();
  const tools = useGmMapTools();
  const writes = useWritesEnabled();
  const mapId = layout._id;
  const [selectedTokenId, setSelectedTokenId] = useState<Id<"combatTokens"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleDoor = withOptimistic(useMutation(api.combatVision.toggleDoor), (store, { objectId, open }) => {
    const row = store.getQuery(api.combatVision.doors, { campaignId, mapId });
    if (row) store.setQuery(api.combatVision.doors, { campaignId, mapId }, { ...row, doors: row.doors.map((d) => (d._id === objectId ? { ...d, open } : d)) });
  });
  const reveal = (shown: boolean) => (store: OptimisticLocalStore, { tokenId, characterId }: { tokenId: string; characterId: string }) => {
    const list = store.getQuery(api.combatTokensReads.list, { campaignId, mapId });
    if (!list) return;
    store.setQuery(
      api.combatTokensReads.list,
      { campaignId, mapId },
      list.map((t) => {
        if (t._id !== tokenId) return t;
        const now = (t.revealedTo ?? []).filter((c) => c !== characterId);
        return { ...t, revealedTo: shown ? [...now, characterId as Id<"characters">] : now };
      }),
    );
  };
  const revealTo = withOptimistic(useMutation(api.combatVision.revealTo), reveal(true));
  const unrevealTo = withOptimistic(useMutation(api.combatVision.unrevealTo), reveal(false));

  async function run(call: () => Promise<unknown>) {
    setError(null);
    try {
      await call();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const pcs = (tokens ?? []).filter((t): t is typeof t & { characterId: Id<"characters"> } => t.kind === "pc" && t.characterId !== undefined);
  const others = (tokens ?? []).filter((t) => t.kind !== "pc");
  const selected = others.find((t) => t._id === selectedTokenId) ?? null;
  const doorList = doors?.mapId === mapId ? doors.doors : [];
  const names = doorNames(doorList);
  const previewName = pcs.find((p) => p.characterId === tools?.previewId)?.name ?? "PC";

  return (
    <Panel title="Vision & fog">
      <QueryLoading label="Loading vision tools" value={tokens} />
      {tokens === undefined || tools === null ? null : (
        <>
          <Text style={gmStyles.muted}>View the map as:</Text>
          <ChipRow label="View as">
            <Chip label="GM view" onPress={() => tools.setPreviewId(null)} selected={tools.previewId === null} />
            {pcs.map((p) => (
              <Chip key={p.characterId} label={p.name} onPress={() => tools.setPreviewId(p.characterId)} selected={tools.previewId === p.characterId} />
            ))}
          </ChipRow>
          {tools.previewId ? (
            <Text style={gmStyles.muted} testID={tools.preview ? "combat-preview-loaded" : undefined}>
              {tools.preview === undefined ? `Loading ${previewName}'s view…` : tools.preview === null ? `${previewName} has no token on this map.` : `Previewing ${previewName}: their fog and only the tokens they see.`}
            </Text>
          ) : null}

          <Text style={gmStyles.muted}>Fog brush (drag on the map to paint; pinch to zoom):</Text>
          <ChipRow label="Fog brush">
            {FOG_TOOLS.map((f) => (
              <Chip
                accessibilityLabel={`Fog brush ${f.label}`}
                disabled={!writes && f.tool !== "off"}
                key={f.tool}
                label={f.label}
                onPress={() => tools.setFogTool(f.tool)}
                selected={tools.fogTool === f.tool}
              />
            ))}
          </ChipRow>
          {tools.fogTool !== "off" ? (
            <ChipRow label="Brush size">
              {BRUSHES.map((b) => (
                <Chip accessibilityLabel={`Brush ${b} squares`} key={b} label={`${b}×${b}`} onPress={() => tools.setBrush(b)} selected={tools.brush === b} />
              ))}
            </ChipRow>
          ) : null}
          {tools.fogTool !== "off" && tools.previewId ? <Text style={gmStyles.muted}>Back to the GM view to paint.</Text> : null}

          <Text style={gmStyles.muted}>Doors and gates:</Text>
          {doorList.length === 0 ? (
            <Text style={gmStyles.muted}>No doors on this map.</Text>
          ) : (
            <ChipRow label="Doors">
              {doorList.map((d) => (
                <Chip
                  accessibilityLabel={`${names.get(d._id)}: ${d.open ? "close" : "open"}`}
                  disabled={!writes}
                  hint={d.open ? "open" : "closed"}
                  key={d._id}
                  label={names.get(d._id) ?? "Door"}
                  onPress={() => void run(() => toggleDoor({ campaignId, objectId: d._id, open: !d.open }))}
                  selected={d.open}
                />
              ))}
            </ChipRow>
          )}

          <Text style={gmStyles.muted}>Reveal a token to a PC (after a successful roll):</Text>
          {others.length === 0 ? (
            <Text style={gmStyles.muted}>No other tokens on the map.</Text>
          ) : (
            <ChipRow label="Tokens to reveal">
              {others.map((t) => (
                <Chip key={t._id} label={t.name} onPress={() => setSelectedTokenId(selected?._id === t._id ? null : t._id)} selected={selected?._id === t._id} />
              ))}
            </ChipRow>
          )}
          {selected ? (
            <View style={gmStyles.row}>
              {pcs.map((p) => {
                const shown = (selected.revealedTo ?? []).includes(p.characterId);
                return (
                  <Chip
                    accessibilityLabel={shown ? `Hide ${selected.name} from ${p.name}` : `Reveal ${selected.name} to ${p.name}`}
                    disabled={!writes}
                    hint={shown ? "revealed" : "not revealed"}
                    key={p.characterId}
                    label={p.name}
                    onPress={() =>
                      void run(() =>
                        shown
                          ? unrevealTo({ campaignId, tokenId: selected._id, characterId: p.characterId })
                          : revealTo({ campaignId, tokenId: selected._id, characterId: p.characterId }),
                      )
                    }
                    selected={shown}
                  />
                );
              })}
            </View>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={dockText.error}>
              {error}
            </Text>
          ) : null}
        </>
      )}
    </Panel>
  );
}
