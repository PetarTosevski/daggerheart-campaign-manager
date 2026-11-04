/**
 * A combat token as the map draws it (C6). Moved out of `../../combatTokens` (dcm-uh6r) so the vision queries that return
 * token views do not load the token mutations, the areas and the card runner; `../../combatTokens` re-exports them.
 */
import { v, type Infer } from "convex/values";

import { tokenPortraitValidator as portraitValidator } from "../pcPortrait";
import { carriedLightValidator, tokenSideValidator } from "./combatMaps";

const tokenKindValidator = v.union(v.literal("pc"), v.literal("adversary"), v.literal("custom"));

const statsValidator = v.object({
  hp: v.number(),
  hpMax: v.number(),
  stress: v.number(),
  stressMax: v.number(),
  /** The sheet's conditions (PC) or the tracker's (adversary, custom). */
  conditions: v.array(v.string()),
  /** An adversary's Difficulty. */
  difficulty: v.optional(v.number()),
  /** Every HP marked (a downed PC, a defeated adversary): the token is greyed. */
  down: v.boolean(),
});

/**
 * A token as the map draws it. `stats` is null when the source row is gone (a deleted character or encounter
 * instance) or unreadable. `tracked` (adversaries): the tracker accepts changes because the encounter is running.
 */
export const tokenViewValidator = v.object({
  _id: v.id("combatTokens"),
  kind: tokenKindValidator,
  characterId: v.optional(v.id("characters")),
  instanceId: v.optional(v.id("encounterAdversaries")),
  side: tokenSideValidator,
  x: v.number(),
  y: v.number(),
  size: v.number(),
  face: v.number(),
  light: carriedLightValidator,
  /** GM only: who this token was revealed to (R10). */
  revealedTo: v.optional(v.array(v.id("characters"))),
  name: v.string(),
  /** "Bard · level 1", "Bruiser", "" (custom). */
  sub: v.string(),
  portrait: portraitValidator,
  /** The caller may move and turn it (GM: every token; a player: their own PC's). */
  canMove: v.boolean(),
  /** The caller's own character's token (players; false for the GM). */
  mine: v.boolean(),
  stats: v.union(v.null(), statsValidator),
  tracked: v.optional(v.boolean()),
});
export type TokenView = Infer<typeof tokenViewValidator>;
