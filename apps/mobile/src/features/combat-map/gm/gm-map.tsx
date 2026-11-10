import { Rect } from "@shopify/react-native-skia";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { brushSquares } from "../../../../../../src/components/combat-map/editor/edit-model";
import { decodeCells } from "../../../../../../src/components/combat-map/map-view/cells";
import { errorMessage } from "../../../../../../src/lib/convex-errors";

import { api, type Id } from "../../../convex";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";
import { withOptimistic } from "../../adversaries/use-tracker";

import type { CombatMapLayout } from "../contract";
import { FOG_COLOURS } from "../fog-paint";
import { CombatMapStage } from "../map-canvas";
import type { MapToken } from "../tokens-layer";
import type { MapHandlers } from "../use-map-view";
import { fogRuns, withFogStroke } from "./fog-brush";
import { useGmMapTools } from "./map-tools";

const NO_TOKENS: readonly MapToken[] = [];

function rgba(c: readonly number[]): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(c[3] ?? 255) / 255})`;
}

/** The website's mark colours (vision-layer.tsx): reveal squares lit, hide squares dark violet. */
const MARK_COLOUR = { reveal: "rgba(255, 240, 200, 0.18)", hide: "rgba(20, 0, 30, 0.55)" } as const;

/**
 * The GM's live map (dcm-gdzi.10, .17): every token (`combatTokensReads.list`), and
 * - the GM's own view: the night or dim tint over the map (as the website's board) and the fog brush marks; with a
 *   brush tool on, a drag paints a stroke (one `combatVision.paintFog` per stroke, shown at once);
 * - a preview (R12): exactly what that PC's player gets, their fog and only the tokens they see.
 */
export function GmLiveMap({ campaignId, layout }: { campaignId: Id<"campaigns">; layout: CombatMapLayout }) {
  const tokens = useQuery(api.combatTokensReads.list, { campaignId, mapId: layout._id });
  const light = useQuery(api.campaigns.timeOfDay, { campaignId })?.light;
  const tools = useGmMapTools();
  const preview = tools?.previewId ? (tools.preview ?? null) : null;
  const brushing = tools !== null && preview === null && tools.fogTool !== "off";
  const paintFog = withOptimistic(useMutation(api.combatVision.paintFog), (store, args) => {
    const live = store.getQuery(api.combatMaps.live, { campaignId });
    if (!live || live._id !== args.mapId) return;
    store.setQuery(api.combatMaps.live, { campaignId }, { ...live, cells: withFogStroke(live.cells, live.w, args.squares, args.mark) as typeof live.cells });
  });
  const stroke = useRef<Set<number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runs = useMemo(() => fogRuns(decodeCells(layout.cells, layout.w, layout.h).fog), [layout.cells, layout.w, layout.h]);
  const previewTokens = useMemo(() => (preview ? [...preview.pcs, ...preview.others] : null), [preview]);

  const { w, h } = layout;
  const tint = preview === null ? (light === "night" ? FOG_COLOURS.gmNight : light === "dim" ? FOG_COLOURS.gmDim : null) : null;

  async function send(squares: number[]) {
    if (!tools || tools.fogTool === "off" || squares.length === 0) return;
    setError(null);
    try {
      await paintFog({ campaignId, mapId: layout._id, squares, mark: tools.fogTool });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const handlers: MapHandlers | undefined =
    brushing && tools
      ? (toSquare) => ({
          onDragStart: (p) => {
            const at = toSquare(p.x, p.y);
            stroke.current = new Set(brushSquares(at.x, at.y, tools.brush, w, h));
            return true;
          },
          onDragMove: (p) => {
            const at = toSquare(p.x, p.y);
            for (const q of brushSquares(at.x, at.y, tools.brush, w, h)) stroke.current?.add(q);
          },
          onDragEnd: () => {
            const squares = stroke.current;
            stroke.current = null;
            if (squares) void send([...squares]);
          },
        })
      : undefined;

  const paintOver =
    preview === null ? (
      <>
        {tint ? <Rect color={rgba(tint)} height={h} width={w} x={0} y={0} /> : null}
        {runs.map((r) => (
          <Rect color={MARK_COLOUR[r.mark]} height={1} key={`${r.x},${r.y}`} width={r.w} x={r.x} y={r.y} />
        ))}
      </>
    ) : null;

  const badge = preview
    ? `Previewing ${preview.pcs.find((t) => t._id === preview.tokenId)?.name ?? "a PC"}`
    : brushing && tools
      ? `Fog brush: ${tools.fogTool} · drag to paint`
      : null;

  return (
    <CombatMapStage
      fog={preview ? (tools?.previewFog ?? null) : null}
      handlers={handlers}
      label={`Battle map ${layout.name}`}
      layout={layout}
      overlay={
        badge || error ? (
          <View pointerEvents="none" style={styles.badge} testID="combat-gm-map-badge">
            {badge ? <Text style={styles.badgeText}>{badge}</Text> : null}
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
          </View>
        ) : null
      }
      paintOver={paintOver}
      pad={0}
      tokens={previewTokens ?? tokens ?? NO_TOKENS}
    />
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "rgba(11, 18, 20, 0.85)",
    borderRadius: radius.pill,
    left: space[2],
    maxWidth: "60%",
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    position: "absolute",
    top: space[2],
  },
  badgeText: { color: colors.parchment, fontFamily: type.sans.fontFamily, fontSize: 12 },
  error: { color: colors.danger, fontFamily: type.sans.fontFamily, fontSize: 12 },
});
