import type { CombatMapLayout } from "../../../src/features/combat-map/contract";
import { campaignId, campaignRecord, liveLayout, playerViewOk } from "../combat-view/fixtures";

export { campaignId, campaignRecord, liveLayout, playerViewOk };

export function editSlotQueries(live: CombatMapLayout) {
  return {
    "campaigns:get": campaignRecord("gm"),
    "combatMaps:live": live,
    "combatVision:playerView": { state: "noCharacter", mapId: live._id },
    "combatMapStyle:settings": {
      builtin: [{ id: "forest", label: "Forest" }],
      packs: [],
    },
    "combatMapStyle:spriteSources": {
      view: "gm" as const,
      mapId: live._id,
      style: "classic" as const,
      sprites: [],
    },
  };
}
