import type { CombatMapLayout } from "../../../src/features/combat-map/contract";
import { campaignId, campaignRecord, liveLayout, playerViewOk } from "../combat-view/fixtures";

export { campaignId, campaignRecord, liveLayout, playerViewOk };

export function mapList(live: CombatMapLayout) {
  return [
    {
      _id: live._id,
      _creationTime: 1,
      name: live.name,
      live: true,
      source: live.source,
      w: live.w,
      h: live.h,
      base: live.base,
      areas: live.areas,
      seed: live.seed,
      imageUrl: null,
      updatedAt: live.updatedAt,
    },
    {
      _id: "map-2",
      _creationTime: 2,
      name: "Draft arena",
      live: false,
      source: "blank" as const,
      w: 22,
      h: 15,
      base: "grass",
      areas: [],
      seed: 1,
      imageUrl: null,
      updatedAt: 2,
    },
  ];
}

export function tokenList() {
  return [
    {
      _id: "tok-pc",
      kind: "pc" as const,
      name: "Briar",
      side: "pc" as const,
      x: 1,
      y: 1,
      size: 1,
      face: 0,
      light: "none" as const,
      sub: "",
      portrait: null,
      canMove: true,
      mine: false,
      stats: null,
      characterId: "char-1",
    },
    {
      _id: "tok-adv",
      kind: "adversary" as const,
      name: "Bear",
      side: "enemy" as const,
      x: 2,
      y: 2,
      size: 1,
      face: 0,
      light: "none" as const,
      sub: "",
      portrait: null,
      canMove: true,
      mine: false,
      stats: null,
      instanceId: "inst-1",
    },
  ];
}

export function gmSlotQueries(live: CombatMapLayout) {
  return {
    "campaigns:get": campaignRecord("gm"),
    "campaigns:fear": 2,
    "combatMaps:live": live,
    "combatVision:playerView": { state: "noCharacter", mapId: live._id },
    "combatMaps:list": mapList(live),
    "combatTokensReads:combatants": { partyLeft: 1, encounter: { _id: "enc-1", name: "Ambush" }, queue: [] },
    "combatTokensReads:list": tokenList(),
    "combatCardsReads:handSharing": { playersSeeHands: true, hidden: [] },
    "combatVision:doors": { mapId: live._id, doors: [] },
    "encounters:list": {
      active: [{ _id: "enc-1", name: "Ambush", status: "running" as const }],
      planned: [],
    },
    "combatRequestsReads:mine": [],
  };
}
