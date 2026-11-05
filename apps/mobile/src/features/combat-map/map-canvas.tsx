import { Canvas, Image, Skia } from "@shopify/react-native-skia";
import { Image as ExpoImage } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { FogMasks } from "./fog-paint";

import type { CombatMapLayout, CombatPlayerView } from "./contract";
import { fogMasksFromView } from "./fog-masks";
import { paintCombatLayout, stageAspect } from "./paint-layout";
import { FOG_PAD_SQUARES } from "../../../../../src/lib/domain/combat-map/vision";

import { AlphaType, ColorType } from "./canvas/skia-enums";
import { CombatTokensLayer } from "./tokens-layer";
import type { View as PanView } from "../world/pan-zoom";

export type CombatMapCanvasProps = {
  label: string;
  layout: CombatMapLayout;
  view: CombatPlayerView;
  isGm: boolean;
  panView: PanView;
};

function viewFog(view: CombatPlayerView, isGm: boolean): FogMasks | null {
  if (isGm || view.state !== "ok") return null;
  return fogMasksFromView(view);
}

/** Live combat map art, fog and tokens (view-only). */
export function CombatMapCanvas({ label, layout, view, isGm, panView }: CombatMapCanvasProps) {
  const player = !isGm;
  const aspect = stageAspect(layout, player);
  const mapW = panView.w * panView.z;
  const mapH = mapW * aspect;
  const imageUrl = layout.source === "image" ? (layout.image?.url ?? null) : null;

  const [frame, setFrame] = useState<{ width: number; height: number; pixels: Uint8ClampedArray } | null>(null);
  const fog = useMemo(() => viewFog(view, isGm), [view, isGm]);

  useEffect(() => {
    if (imageUrl) return;
    let cancelled = false;
    void paintCombatLayout(layout, { player, fog }).then((painted) => {
      if (!cancelled) setFrame({ width: painted.width, height: painted.height, pixels: painted.pixels });
    });
    return () => {
      cancelled = true;
    };
  }, [layout, player, fog, imageUrl]);

  const skImage = useMemo(() => {
    if (!frame) return null;
    const data = Skia.Data.fromBytes(new Uint8Array(frame.pixels));
    return Skia.Image.MakeImage(
      {
        width: frame.width,
        height: frame.height,
        alphaType: AlphaType.Unpremul,
        colorType: ColorType.RGBA_8888,
      },
      data,
      frame.width * 4,
    );
  }, [frame]);

  const pad = player ? FOG_PAD_SQUARES : 0;

  return (
    <View
      accessibilityLabel={label}
      style={[styles.stage, { width: mapW, height: mapH, transform: [{ translateX: panView.x }, { translateY: panView.y }] }]}
      testID="combat-map-stage"
    >
      {imageUrl ? (
        <ExpoImage accessibilityIgnoresInvertColors source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="fill" />
      ) : skImage ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Image image={skImage} x={0} y={0} width={mapW} height={mapH} fit="fill" />
        </Canvas>
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Painting map…</Text>
        </View>
      )}
      <CombatTokensLayer isGm={isGm} layout={layout} padSquares={pad} view={view} mapW={mapW} mapH={mapH} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    overflow: "hidden",
    position: "relative",
  },
  placeholder: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: "#0b1214",
    justifyContent: "center",
  },
  placeholderText: {
    color: "#c8b890",
    fontSize: 13,
  },
});
