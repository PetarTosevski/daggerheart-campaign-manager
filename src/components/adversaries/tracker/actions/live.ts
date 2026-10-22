"use client";

import { useQuery } from "convex/react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CombatMapSummary } from "../../../combat-map/slots";

/** The campaign's live Combat Map (the one the players see), null without one, undefined while loading. GM reads. */
export function useLiveMap(campaignId: Id<"campaigns">): CombatMapSummary | null | undefined {
  const maps = useQuery(api.combatMaps.list, { campaignId });
  if (maps === undefined) return undefined;
  const live = maps.find((m) => m.live);
  return live ? { _id: live._id, name: live.name, live: live.live, source: live.source, w: live.w, h: live.h } : null;
}

/**
 * What the target picker reads (Q18): the party, and the live map's tokens (null without a live map). Undefined while
 * either loads.
 */
export function useTargetData(campaignId: Id<"campaigns">) {
  const map = useLiveMap(campaignId);
  const party = useQuery(api.characters.listByCampaign, { campaignId });
  const tokens = useQuery(api.combatTokens.list, map ? { campaignId, mapId: map._id } : "skip");
  if (map === undefined || party === undefined || (map !== null && tokens === undefined)) return undefined;
  return { party, tokens: map === null ? null : (tokens ?? []) };
}
