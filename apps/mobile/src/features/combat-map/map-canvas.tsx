import { Canvas, Group, Image, Rect, useImage, type SkImage as RnSkImage } from "@shopify/react-native-skia";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { GestureDetector } from "react-native-gesture-handler";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";

import type { CombatMapLayout } from "./contract";
import { imageMapRect, OFF_MAP } from "./map-canvas-math";
import { paintFog, UNSEEN_COLOUR, type FogPicture } from "./fog-image";
import type { FogMasks } from "./fog-paint";
import { paintBase, paintKey, type BaseImage } from "./paint-layout";
import { CombatTokensLayer, type MapToken } from "./tokens-layer";
import { useMapView, type MapHandlers } from "./use-map-view";


/** Repaints the base map only when the painter's input changes (`paintKey`), never for tokens, fog or gestures. */
function useBaseImage(layout: CombatMapLayout): BaseImage | null {
  const key = paintKey(layout);
  const [painted, setPainted] = useState<{ key: string; base: BaseImage } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    void paintBase(layout).then((base) => {
      if (!cancelled) setPainted({ key, base });
    });
    return () => {
      cancelled = true;
    };
    // `key` stands for the parts of `layout` the painter reads; a new layout object with the same key paints nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === null || painted === null) return null;
  // Keep showing the previous picture until the new one is ready (no flash on a door or object change).
  return painted.base;
}

/** Rebuilds the fog image only when the masks change. */
function useFogPicture(masks: FogMasks | null, w: number, h: number): FogPicture | null {
  const [picture, setPicture] = useState<{ masks: FogMasks; fog: FogPicture } | null>(null);
  useEffect(() => {
    if (masks === null) return;
    let cancelled = false;
    void paintFog(masks, w, h).then((fog) => {
      if (!cancelled) setPicture({ masks, fog });
    });
    return () => {
      cancelled = true;
    };
  }, [masks, w, h]);
  if (masks === null || picture === null) return null;
  return picture.fog;
}

export type CombatMapStageProps = {
  label: string;
  layout: CombatMapLayout;
  tokens: readonly MapToken[];
  /** A player's fog masks (null: no fog, the GM and a player without a character on the map). */
  fog: FogMasks | null;
  /** Squares of fog margin a player may pan into (FOG_PAD_SQUARES), 0 for the GM. */
  pad: number;
  /** Taps and drags the editor takes instead of panning (given the screen-to-square conversion). */
  handlers?: MapHandlers;
  /** Drawn over the map (badges). */
  overlay?: ReactNode;
  /** Skia nodes drawn in map squares over the fog (the GM's night tint and fog marks), under the tokens. */
  paintOver?: ReactNode;
};

/**
 * The live combat map (dcm-gdzi.14): one Skia canvas draws the base map (painted once per layout change), an uploaded
 * image inside its grid, and the fog image (built once per mask change) under a group transform that follows the
 * shared pan/zoom view; tokens are an RN layer moved by the same shared value. A drag or pinch re-renders nothing.
 */
export function CombatMapStage({ label, layout, tokens, fog, pad, handlers, overlay, paintOver }: CombatMapStageProps) {
  const map = useMapView({ w: layout.w, h: layout.h, pad }, handlers);
  const base = useBaseImage(layout);
  const fogPicture = useFogPicture(fog, layout.w, layout.h);
  const imageUrl = layout.source === "image" ? (layout.image?.url ?? null) : null;
  const uploaded = useImage(imageUrl);
  const imageRect = useMemo(
    () => (uploaded && layout.image ? imageMapRect(layout.image.grid, { width: uploaded.width(), height: uploaded.height() }) : null),
    [uploaded, layout.image],
  );
  const player = pad > 0;
  const background = player && fog !== null ? UNSEEN_COLOUR : OFF_MAP;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    map.onViewport({ w: width, h: height });
  };

  const { w, h } = layout;
  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={map.gesture}>
        <View onLayout={onLayout} style={[styles.viewport, { backgroundColor: background }]} testID="combat-viewport">
          <Canvas style={StyleSheet.absoluteFill} testID="combat-map-canvas">
            <Group transform={map.transform}>
              <Rect x={0} y={0} width={w} height={h} color={OFF_MAP} />
              {base ? <Image image={base.image as unknown as RnSkImage} x={0} y={0} width={w} height={h} fit="fill" /> : null}
              {uploaded && imageRect ? (
                <Group clip={{ x: 0, y: 0, width: w, height: h }}>
                  <Image image={uploaded} x={imageRect.x} y={imageRect.y} width={imageRect.w} height={imageRect.h} fit="fill" />
                </Group>
              ) : null}
              {fogPicture ? (
                <Image
                  image={fogPicture.image as unknown as RnSkImage}
                  x={fogPicture.x}
                  y={fogPicture.y}
                  width={fogPicture.w}
                  height={fogPicture.h}
                  fit="fill"
                />
              ) : null}
              {paintOver}
            </Group>
          </Canvas>
          <CombatTokensLayer h={h} label={label} tokens={tokens} view={map.view} w={w} />
          {base === null && imageUrl === null ? (
            <Text pointerEvents="none" style={styles.painting}>
              Painting map…
            </Text>
          ) : null}
          {overlay}
        </View>
      </GestureDetector>
      <View style={styles.zoomBar}>
        <ZoomButton label="Zoom out" onPress={() => map.zoomBy(1 / 1.25)} text="−" />
        <Text accessibilityLabel={`Zoom ${map.zoom}%`} style={styles.zoomText}>
          {map.zoom}%
        </Text>
        <ZoomButton label="Zoom in" onPress={() => map.zoomBy(1.25)} text="+" />
        <ZoomButton label="Fit map" onPress={map.fit} text="Fit" />
      </View>
    </View>
  );
}

function ZoomButton({ label, onPress, text }: { label: string; onPress: () => void; text: string }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" hitSlop={4} onPress={onPress} style={styles.zoomButton}>
      <Text style={styles.zoomButtonText}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  viewport: {
    flex: 1,
    overflow: "hidden",
  },
  painting: {
    color: "#c8b890",
    fontSize: 13,
    left: 0,
    position: "absolute",
    right: 0,
    textAlign: "center",
    top: "45%",
  },
  zoomBar: {
    alignItems: "center",
    backgroundColor: "rgba(11, 18, 20, 0.85)",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: space[1],
    paddingHorizontal: space[1],
    position: "absolute",
    right: space[2],
    top: space[2],
  },
  zoomButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
  },
  zoomButtonText: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 16,
  },
  zoomText: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
    minWidth: 40,
    textAlign: "center",
  },
});
