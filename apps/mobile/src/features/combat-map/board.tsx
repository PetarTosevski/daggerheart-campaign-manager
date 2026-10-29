import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useEffect, useRef, useState } from "react";
import { LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from "react-native";

import { type Id } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { sectionLabel } from "../../shell/sections";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { useMapPanZoom } from "../world/pan-zoom";

import type { CombatMapLayout, CombatPlayerView } from "./contract";
import { CombatEditSlot } from "./edit";
import { CombatGmSlot } from "./gm";
import { CombatHudBar } from "./hud-bar";
import { CombatMapCanvas } from "./map-canvas";
import { CombatPlaySlot } from "./play";
import { stageAspect } from "./paint-layout";

export function CombatBoard({
  layout,
  view,
}: {
  layout: CombatMapLayout | null;
  view: CombatPlayerView | undefined;
}) {
  const campaign = useCampaign();
  const isGm = campaign.role === "gm";
  const player = !isGm;

  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const aspect = layout ? stageAspect(layout, player) : 1;
  const panZoom = useMapPanZoom(viewport.w, viewport.h, aspect);
  const fitted = useRef(false);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport({ w: width, h: height });
  };

  useEffect(() => {
    if (fitted.current || viewport.w <= 0 || viewport.h <= 0) return;
    fitted.current = true;
    panZoom.fit();
  }, [panZoom, viewport.h, viewport.w]);

  const panStart = useRef({ x: 0, y: 0 });
  /* eslint-disable react-hooks/refs -- RNGH callbacks run outside React render. */
  const pan = Gesture.Pan()
    .onBegin(() => {
      panStart.current = { x: panZoom.view.x, y: panZoom.view.y };
    })
    .onUpdate((e) => {
      panZoom.setView({
        z: panZoom.view.z,
        x: panStart.current.x + e.translationX,
        y: panStart.current.y + e.translationY,
      });
    })
    .runOnJS(true);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      panZoom.zoomAt(panZoom.view.z * e.scale, viewport.w / 2, viewport.h / 2);
    })
    .runOnJS(true);
  /* eslint-enable react-hooks/refs */

  const gesture = Gesture.Simultaneous(pan, pinch);

  if (layout === null || view === undefined) {
    return (
      <ScrollView contentContainerStyle={styles.stack}>
        <Text style={styles.eyebrow}>{sectionLabel("combat-map")}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {campaign.name}
        </Text>
        <Text style={styles.empty}>{player ? "The GM has not shown a map yet." : "No battlefield yet. Generate or upload a map on the website."}</Text>
      </ScrollView>
    );
  }

  const slotProps = { campaignId: campaign._id, isGm, layout, view };

  return (
    <View style={styles.screen}>
      <CombatHudBar campaignId={campaign._id as Id<"campaigns">} mapId={layout._id} />
      <GestureDetector gesture={gesture}>
        <View onLayout={onLayout} style={styles.mapShell} testID="combat-viewport">
          {viewport.w > 0 ? (
            <CombatMapCanvas
              isGm={isGm}
              label={`Battle map ${layout.name}`}
              layout={layout}
              panView={panZoom.view}
              view={view}
            />
          ) : null}
        </View>
      </GestureDetector>
      <View style={styles.dock}>
        <View style={styles.toolbar}>
          <Button onPress={() => panZoom.zoomAt(panZoom.view.z / 1.25)} variant="outline">
            Zoom out
          </Button>
          <Text style={styles.zoom}>{Math.round(panZoom.view.z * 100)}%</Text>
          <Button onPress={() => panZoom.zoomAt(panZoom.view.z * 1.25)} variant="outline">
            Zoom in
          </Button>
          <Button onPress={panZoom.fit} variant="outline">
            Fit map
          </Button>
        </View>
        {isGm ? <CombatGmSlot {...slotProps} /> : <CombatPlaySlot {...slotProps} />}
        <CombatEditSlot {...slotProps} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.ink,
    flex: 1,
  },
  stack: {
    gap: space[3],
    padding: space[4],
    paddingBottom: space[8],
  },
  eyebrow: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    color: colors.body,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
  empty: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    paddingVertical: space[6],
  },
  mapShell: {
    backgroundColor: "#0b1214",
    flex: 1,
    overflow: "hidden",
  },
  dock: {
    backgroundColor: colors.panel,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  zoom: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    minWidth: 48,
    textAlign: "center",
  },
});
