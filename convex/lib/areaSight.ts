/**
 * Sight-blocking areas as the vision engine reads them, and the blocking grid one viewer sees (plan lanes-2 E4,
 * dcm-o44e). Split out of `../combatAreas` and `./combatVision` (dcm-uh6r) so the card runner's line of sight does not
 * load the vision engine and the sprite packs; both modules re-export what moved.
 */
import type { PreparedMap } from "../../src/lib/domain/combat-map/index";
import { seesThrough } from "../../src/lib/domain/feature-effects/areas";
import type { Id } from "../_generated/dataModel";
import type { Scene } from "./combatVision";

/** A blocking disc as the vision engine reads a map object. */
export type SightDisc = { kind: string; x: number; y: number; r: number; sight: "block" };

/** One sight-blocking area's discs, with who sees through it (`AreaSpec.seeThrough`; dcm-o44e). */
export type AreaSightBlock = { areaId: Id<"combatAreas">; characterId: Id<"characters">; seeThrough?: "owner" | "ownerAndAllies"; discs: SightDisc[] };

/** Whether a PC viewer (a character's token) sees through the block (the owner; with `ownerAndAllies` every PC). */
export function viewerSeesThrough(block: AreaSightBlock, viewer: Id<"characters">): boolean {
  return seesThrough(block.seeThrough, { isOwner: block.characterId === viewer, isParty: true });
}

/**
 * The blocking grid as this character sees it: without the sight-blocking areas they see through (Eclipse, CB p.337:
 * "complete darkness only you and your allies can see through"; Veil of Night, CB p.336; plan lanes-2 E4, dcm-o44e).
 */
export function preparedFor(scene: Scene, characterId: Id<"characters">): PreparedMap {
  const through = new Set<string>(scene.areaBlocks.filter((b) => viewerSeesThrough(b, characterId)).map((b) => b.areaId));
  return through.size > 0 ? scene.preparedWithout(through) : scene.prepared;
}
