import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useRef, useState } from "react";
import { LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from "react-native";

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

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport({ w: width, h: height });
  };

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
    <ScrollView contentContainerStyle={styles.stack}>
      <Text style={styles.eyebrow}>{sectionLabel("combat-map")}</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {layout.name}
      </Text>
      <Text style={styles.hint}>{player ? "Pinch to zoom and drag to pan." : "Pinch to zoom and drag to pan. GM tools arrive in a later release."}</Text>
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
          ) : (
            <View style={styles.mapPlaceholder} />
          )}
        </View>
      </GestureDetector>
      {isGm ? <CombatGmSlot {...slotProps} /> : <CombatPlaySlot {...slotProps} />}
      <CombatEditSlot {...slotProps} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[3],
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
  hint: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  empty: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    paddingVertical: space[6],
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
  mapShell: {
    flexGrow: 1,
    minHeight: 320,
    overflow: "hidden",
  },
  mapPlaceholder: {
    backgroundColor: colors.ink2,
    borderRadius: 10,
    flex: 1,
    minHeight: 280,
  },
});
