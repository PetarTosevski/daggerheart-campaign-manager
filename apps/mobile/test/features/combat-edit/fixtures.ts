import type { CombatMapLayout } from "../../../src/features/combat-map/contract";
import { campaignId, campaignRecord, liveLayout, playerViewOk } from "../combat-view/fixtures";
import { api } from "../../../src/convex";
import { fn } from "../../harness";

export { campaignId, campaignRecord, liveLayout, playerViewOk };

export function editSlotQueries(live: CombatMapLayout) {
  return {
    [fn(api.campaigns.get)]: campaignRecord("gm"),
    [fn(api.combatMaps.live)]: live,
    [fn(api.combatVision.playerView)]: { state: "noCharacter", mapId: live._id },
    [fn(api.combatMapStyle.settings)]: {
      builtin: [{ id: "forest", label: "Forest" }],
      packs: [],
    },
    [fn(api.combatMapStyle.spriteSources)]: {
      view: "gm" as const,
      mapId: live._id,
      style: "classic" as const,
      setting: { builtin: "forest" },
      settingPicked: false,
      extends: null,
      sprites: [],
    },
  };
}
