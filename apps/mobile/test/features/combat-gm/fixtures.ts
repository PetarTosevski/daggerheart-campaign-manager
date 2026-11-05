import type { CombatMapLayout } from "../../../src/features/combat-map/contract";
import { campaignId, campaignRecord, liveLayout, playerViewOk } from "../combat-view/fixtures";
import { api } from "../../../src/convex";
import { fn } from "../../harness";

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
    [fn(api.campaigns.get)]: campaignRecord("gm"),
    [fn(api.campaigns.fear)]: 2,
    [fn(api.combatMaps.live)]: live,
    [fn(api.combatVision.playerView)]: { state: "noCharacter", mapId: live._id },
    [fn(api.combatMaps.list)]: mapList(live),
    [fn(api.combatTokensReads.combatants)]: { partyLeft: 1, encounter: { _id: "enc-1", name: "Ambush" }, queue: [] },
    [fn(api.combatTokensReads.list)]: tokenList(),
    [fn(api.combatCardsReads.handSharing)]: { playersSeeHands: true, hidden: [] },
    [fn(api.combatVision.doors)]: { mapId: live._id, doors: [] },
    [fn(api.encounters.list)]: {
      active: [{ _id: "enc-1", name: "Ambush", status: "running" as const }],
      planned: [],
    },
    [fn(api.combatRequestsReads.mine)]: [],
  };
}
