import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { HORIZON_FRAME, type MapState } from "../../../../../../src/lib/world/map-state";
import { type TerrainCode } from "../../../../../../src/lib/world/terrain";
import { tokenTypes } from "../../../../../../src/lib/world/token-types";
import type { Id } from "../../../convex";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import type { WorldMapData } from "../contract";
import { EditMap } from "./edit-map";
import { MapImageControl } from "./map-image-control";
import { useMapActions } from "./map-actions";
import { WorldPalette } from "./palette";
import { TerrainToolbar } from "./terrain-toolbar";
import { TokenPanel } from "./token-panel";

export function GmMapTools({
  campaignId,
  isCustomFrame,
  data,
}: {
  campaignId: Id<"campaigns">;
  isCustomFrame: boolean;
  data: WorldMapData;
}) {
  const actions = useMapActions(campaignId);
  const state = data.state as MapState;
  const horizon = data.frameId === HORIZON_FRAME;
  const types = useMemo(() => tokenTypes(state), [state]);

  const [placing, setPlacing] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [painting, setPainting] = useState(false);
  const [brush, setBrush] = useState<TerrainCode>("r");
  const [brushSize, setBrushSize] = useState(2);

  const togglePaint = () => {
    if (horizon) return;
    setPainting((p) => !p);
    setPlacing(null);
    setMovingId(null);
  };

  // The edit map fills the space; the panels scroll underneath it, never around it (a drag on the map is a pan or
  // a paint stroke, not a page scroll).
  return (
    <View style={styles.stack}>
      {actions.error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {actions.error}
        </Text>
      ) : null}
      <EditMap
        actions={actions}
        brush={brush}
        brushSize={brushSize}
        data={data}
        movingId={movingId}
        onMoved={() => setMovingId(null)}
        onPlaced={() => setPlacing(null)}
        painting={painting}
        placing={placing}
      />
      <ScrollView contentContainerStyle={styles.panels} keyboardShouldPersistTaps="handled" style={styles.panelScroll}>
        {!horizon ? (
          <TerrainToolbar
            brush={brush}
            brushSize={brushSize}
            onBrush={setBrush}
            onBrushSize={setBrushSize}
            onReset={() => void actions.resetTerrain()}
            onTogglePaint={togglePaint}
            painting={painting}
          />
        ) : (
          <Text style={styles.note}>Hex crawl maps use the hex editor on the website for now. Tokens and map art still work here.</Text>
        )}
        <WorldPalette
          actions={actions}
          onPick={(id) => {
            setPlacing(id);
            setPainting(false);
            setMovingId(null);
          }}
          placing={placing}
          types={types}
        />
        <TokenPanel
          actions={actions}
          movingId={movingId}
          onMovePick={setMovingId}
          onSelect={setSelectedId}
          selectedId={selectedId}
          tokens={state.tokens}
          types={types}
        />
        <MapImageControl campaignId={campaignId} hasUpload={Boolean(state.customMap)} isCustom={isCustomFrame} scaleKm={state.scaleKm} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    flex: 1,
    gap: space[3],
  },
  panelScroll: {
    flexGrow: 0,
    maxHeight: "45%",
  },
  panels: {
    gap: space[3],
  },
  note: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
});
