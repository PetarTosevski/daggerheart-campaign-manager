import { initialHexCrawl, initialMapState } from "../../../../../src/lib/world/map-state";
import type { WorldMapData } from "../../../src/features/world/contract";

export const campaignId = "campaign-1";

export function campaignRecord(role: "gm" | "player") {
  return {
    _id: campaignId,
    frameId: "witherwild",
    name: "The Table",
    role,
    tier: 1,
    level: 1,
    custom: null,
    tome: null,
    options: { hopeAndFear: true },
    createdAt: 1,
    lastOpenedAt: 1,
    players: 2,
  };
}

export function mapView(role: "gm" | "player", overrides: Record<string, unknown> = {}): WorldMapData {
  const state = initialMapState("witherwild");
  const withParty = {
    ...state,
    party: {
      x: 44,
      y: 52,
      trail: [
        { x: 40, y: 50 },
        { x: 42, y: 51 },
      ],
    },
    tokens: [
      {
        id: 1,
        type: "village",
        x: 55,
        y: 48,
        name: "Haven",
        notes: role === "gm" ? "GM notes" : "",
        hidden: false,
        location: true,
      },
    ],
  };
  return {
    role,
    frameId: "witherwild",
    mapUrl: null,
    state: withParty,
    ...overrides,
  } as WorldMapData;
}

export function horizonMapView(role: "gm" | "player"): WorldMapData {
  const state = initialMapState("journey-to-horizon");
  const crawl = initialHexCrawl();
  return {
    role,
    frameId: "journey-to-horizon",
    mapUrl: null,
    state: {
      ...state,
      hexCrawl: {
        ...crawl,
        party: { q: 0, r: 0 },
        hexes: [
          { q: 0, r: 0, explored: true, poi: { text: "Spire", hidden: false } },
          { q: 1, r: 0, explored: true },
        ],
      },
    },
  } as WorldMapData;
}
