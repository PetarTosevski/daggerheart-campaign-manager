import type { CombatMapLayout, CombatPlayerView } from "../../../src/features/combat-map/contract";
import { campaignSummary } from "../../harness/records";

export const campaignId = "campaign-1";

export function campaignRecord(role: "gm" | "player") {
  return campaignSummary({
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
  });
}

export function liveLayout(overrides: Partial<CombatMapLayout> = {}): CombatMapLayout {
  return {
    _id: "map-1",
    name: "Forest skirmish",
    live: true,
    source: "generated",
    w: 4,
    h: 4,
    base: "grass",
    areas: [],
    seed: 9,
    updatedAt: 1,
    image: null,
    objects: [],
    cells: [],
    ...overrides,
  } as CombatMapLayout;
}

export function playerViewOk(overrides: Partial<Extract<CombatPlayerView, { state: "ok" }>> = {}): CombatPlayerView {
  return {
    state: "ok",
    mapId: "map-1",
    characterId: "char-1",
    tokenId: "tok-1",
    phase: "DAY",
    light: "day",
    instinct: 0,
    coneDeg: 70,
    unseenAdversaries: [],
    vision: {
      sw: 8,
      sh: 8,
      scale: 2,
      seen: "AAAA",
      clear: "AAAA",
    },
    pcs: [
      {
        _id: "tok-1",
        kind: "pc",
        name: "Briar",
        side: "pc",
        x: 1,
        y: 1,
        size: 1,
        face: 0,
        light: "none",
        sub: "",
        portrait: null,
        canMove: true,
        mine: true,
        stats: null,
      },
    ],
    others: [],
    ...overrides,
  } as CombatPlayerView;
}
