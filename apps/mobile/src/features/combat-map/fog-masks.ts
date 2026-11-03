import { decodeExplored } from "../../../../../src/lib/domain/combat-map/vision";
import { unionMask, type FogMasks } from "./fog-paint";
import type { CombatPlayerView } from "./contract";

/** Fog samples for a character view (`combatVision.playerView` when `state === "ok"`). */
export function fogMasksFromView(view: Extract<CombatPlayerView, { state: "ok" }>): FogMasks {
  const { sw, sh, scale, seen, clear } = view.vision;
  const length = sw * sh;
  const seenMask = decodeExplored(seen, length);
  return {
    sw,
    sh,
    scale,
    seen: seenMask,
    clear: decodeExplored(clear, length),
    explored: unionMask(seenMask, null),
  };
}
