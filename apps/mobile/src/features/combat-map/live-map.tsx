import { useQuery } from "convex/react";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { dimLightBadge } from "../../../../../src/lib/domain/combat-map/light";
import { FOG_PAD_SQUARES } from "../../../../../src/lib/domain/combat-map/vision";

import { api, type Id } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";

import type { CombatMapLayout, CombatPlayerView } from "./contract";
import { CombatMapStage } from "./map-canvas";
import type { MapToken } from "./tokens-layer";
import { useExploredSync, useFogMasks, useSeenSync, useStoredExplored, type ViewOk } from "./vision-sync";

type LiveMapProps = { campaignId: Id<"campaigns">; layout: CombatMapLayout };

const NO_TOKENS: readonly MapToken[] = [];

/**
 * A player's map: their character's view (R11) with fog, explored areas and the "seen" writes the website makes
 * (dcm-gdzi.11, dcm-gdzi.12), and the M3 Darkness dim-light badge (rule switches; Book until the rules load).
 */
export function PlayerLiveMap({ campaignId, layout, view }: LiveMapProps & { view: CombatPlayerView }) {
  const ok: ViewOk | null = view.state === "ok" && view.mapId === layout._id ? view : null;
  const stored = useStoredExplored(campaignId, ok);
  const masks = useFogMasks(ok, stored.mask);
  useExploredSync(campaignId, ok, masks, stored.mask, stored.loaded);
  useSeenSync(campaignId, ok);
  const darkness = useQuery(api.ruleSettings.get, { campaignId })?.modes.darkness ?? "book";
  const tokens = useMemo(() => (ok ? [...ok.pcs, ...ok.others] : NO_TOKENS), [ok]);
  const badge = ok === null ? null : ok.light === "night" ? "Night: light sources matter" : dimLightBadge(ok.light, darkness);

  return (
    <CombatMapStage
      fog={masks}
      label={`Battle map ${layout.name}`}
      layout={layout}
      overlay={
        badge ? (
          <View pointerEvents="none" style={styles.badge} testID="combat-light-badge">
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null
      }
      pad={FOG_PAD_SQUARES}
      tokens={tokens}
    />
  );
}

/** The GM's map: every token on it (`combatTokensReads.list`, dcm-gdzi.10), no fog. */
export function GmLiveMap({ campaignId, layout }: LiveMapProps) {
  const tokens = useQuery(api.combatTokensReads.list, { campaignId, mapId: layout._id });
  return <CombatMapStage fog={null} label={`Battle map ${layout.name}`} layout={layout} pad={0} tokens={tokens ?? NO_TOKENS} />;
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "rgba(11, 18, 20, 0.85)",
    borderRadius: radius.pill,
    left: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    position: "absolute",
    top: space[2],
    maxWidth: "60%",
  },
  badgeText: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
  },
});
