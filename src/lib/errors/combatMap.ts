/**
 * Errors of the combat map (D9: maps, generation, editing, tokens, vision).
 * Contract: see `actionLog.ts`; add this domain's codes here only. Every D9
 * tracer throws only these codes (plus the common ones); a code missing here
 * means stop and ask the orchestrator (plan `.omc/plans/d9-combat-map.yaml`).
 */
export const combatMapMessages = {
  /** A map id that is not in this campaign, or a player asking for a map that is not live. */
  COMBAT_MAP_NOT_FOUND: "That map isn't in this campaign anymore.",
  /** MAX_COMBAT_MAPS per campaign. */
  COMBAT_MAP_LIMIT: "This campaign already has 30 maps. Delete one first.",
  /** A map size outside the grid bounds (12..44 x 10..32 squares) or a bad grid over an image. */
  COMBAT_MAP_SIZE: "A map is 12 to 44 squares wide and 10 to 32 squares tall.",
  /** A token id that is not on this map. */
  COMBAT_TOKEN_NOT_FOUND: "That token isn't on the map anymore.",
  /** MAX_COMBAT_TOKENS per map. */
  COMBAT_TOKEN_LIMIT: "This map already has 80 tokens. Remove one first.",
  /** An object id that is not on this map. */
  COMBAT_OBJECT_NOT_FOUND: "That object isn't on the map anymore.",
  /** MAX_COMBAT_OBJECTS per map. */
  COMBAT_OBJECT_LIMIT: "This map already has 300 objects. Remove one first.",
  /** MAX_COMBAT_AREAS per map. */
  COMBAT_AREA_LIMIT: "This map already has 60 terrain areas.",
  /** A player moving, turning or lighting a token that is not their own PC's (R4, Q3). */
  COMBAT_NOT_YOUR_TOKEN: "You can only move and turn your own character's token.",
  /** A player with no character on this map asking for their view (C7). */
  COMBAT_NO_CHARACTER: "Your character isn't on this map.",
  /** Claude could not be reached for a layout and the keyword fallback was not usable either (C4). */
  COMBAT_GENERATE_UNAVAILABLE: "Couldn't lay out a map right now. Try again in a moment.",
  /** A layout (from Claude or the client) that fails spec validation (C1 spec.ts). */
  COMBAT_LAYOUT_INVALID: "That map layout isn't valid.",
  /** A player switching a map light their character has never seen (R9, C7). */
  COMBAT_LIGHT_NOT_SEEN: "Your character hasn't seen that light.",
  /** A stored combat map blob that cannot be read (CD2). */
  COMBAT_MAP_CORRUPT: "This map's saved data can't be read.",
} as const satisfies Record<string, string>;

export type CombatMapErrorCode = keyof typeof combatMapMessages;
