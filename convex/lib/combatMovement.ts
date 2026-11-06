import { decodeCells } from "../../src/components/combat-map/map-view/cells";
import { buildMovementGrid, type MovementGrid, type MovementObject } from "../../src/lib/domain/combat-map/movement";
import { spriteMove } from "../../src/lib/sprite-packs/index";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { lineOfSight } from "../../src/lib/domain/combat-actions/index";
import { createView, tokenVisibility, VISION_BASE_DEG, VISION_MAX_DEG, VISION_STEP_DEG, type VisionToken } from "../../src/lib/domain/combat-map/index";
import { lightOf } from "../../src/lib/domain/combat-map/light";
import { countsAsActionRoll } from "../../src/lib/domain/countdowns/advanced";
import { OUTCOME_LABEL } from "../../src/lib/domain/dice/index";
import { rollGaveHope, WITH_HOPE } from "../../src/lib/domain/session-features/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { tickArmedCountdowns } from "../countdownRolls";
import { logAction, newGroupId } from "./actionLog";
import { conditionSources, difficultyOf, endConditionsOnRoll, withoutCondition } from "./cardRunner";
import { readSheet, saveSheet } from "./characterSheet";
import { rollDie } from "./dice";
import { gainFear } from "./fear";
import { afterPcActionRoll, fearWithheldBy, outcomeWithFear } from "./rollAftermath";
import { changed, resolveDuality, type DualityArgs, type Loaded } from "./rolls";
import { appError } from "../../src/lib/errors/app-error";
import { closeRequest, openDifficulty } from "./combatRequests";
import { postRuleNote, ruleMode } from "./ruleModes";
import type { DifficultyAsk } from "./validators/combatRequests";
import { loadScene, type Scene } from "./combatVision";
import { CELL_TILE_ROWS, MAX_MAP_H, objectsOnMap, tokensOnMap } from "./combatMaps";
import { objectTraits, resolveRefs } from "./spriteSources";

/**
 * Movement on the server (plan `.omc/plans/map-movement.yaml`, tracer M0; D1-D4, D6): the map's blocking and
 * difficult squares, built with the pure rules in src/lib/domain/combat-map/movement.ts from the map's areas, its
 * painted terrain and sight-blocker tiles, its objects and their sprites' `move` traits. Callers are campaign / GM
 * wrappers.
 *
 * Reads (all indexed and bounded): the map's objects (`by_map`, at most MAX_COMBAT_OBJECTS = 300), its painted
 * "terrain" tiles (`by_map_layer_tile`, at most ceil(MAX_MAP_H / CELL_TILE_ROWS) = 4; none for an image map), its
 * painted "block" tiles (same index, at most 4) and one `get` per distinct uploaded sprite the objects use (built-in
 * sprites read nothing).
 */

/** Tiles one layer of one map can hold (the tallest map). */
const MAX_LAYER_TILES = Math.ceil(MAX_MAP_H / CELL_TILE_ROWS);

type Uploaded = Awaited<ReturnType<typeof resolveRefs>>;

/** An object as movement reads it: footprint traits, its sprite's `move` (null = its Classic kind's), door state, hull outline. */
function movementObject(object: Doc<"combatMapObjects">, uploaded: Uploaded): MovementObject {
  const move = object.sprite === undefined ? null : spriteMove(object.sprite, { uploaded: (id) => uploaded.get(id) });
  // Doors (user answer 2026-10-21): M2 adds `open` to map objects; until then it is absent and every door is closed.
  const open = (object as { open?: boolean }).open;
  return {
    kind: object.kind,
    x: object.x,
    y: object.y,
    r: object.r,
    rot: object.rot,
    traits: objectTraits(object, uploaded),
    move,
    open: open === true,
    ...(object.points === undefined ? {} : { points: object.points }),
  };
}

function layerTiles(ctx: QueryCtx, mapId: Id<"combatMaps">, layer: "terrain" | "block") {
  return ctx.db
    .query("combatMapCells")
    .withIndex("by_map_layer_tile", (q) => q.eq("mapId", mapId).eq("layer", layer))
    .take(MAX_LAYER_TILES);
}

/**
 * The map's movement grid (D1, D2). An uploaded image ignores terrain (as vision does): its painted sight blockers and
 * its objects still stop tokens.
 */
export async function movementGrid(ctx: QueryCtx, campaignId: Id<"campaigns">, map: Doc<"combatMaps">): Promise<MovementGrid> {
  const image = map.source === "image";
  const objects = await objectsOnMap(ctx, map._id);
  const terrain = image ? [] : await layerTiles(ctx, map._id, "terrain");
  const blockers = await layerTiles(ctx, map._id, "block");
  const cells = decodeCells([...terrain, ...blockers], map.w, map.h);
  const uploaded = await resolveRefs(ctx, campaignId, objects.map((o) => o.sprite));
  return buildMovementGrid({
    w: map.w,
    h: map.h,
    base: map.base,
    areas: map.areas,
    paint: cells.paint,
    block: cells.block,
    objects: objects.map((o) => movementObject(o, uploaded)),
    image,
  });
}

// ---------------------------------------------------------------- Cloaked ends on a move in sight (SD5, DA3)

/** Instinct that gives the widest vision cone (180 degrees, R6): an adversary's sight has no cone (DA3). */
const WIDE_INSTINCT = Math.ceil((VISION_MAX_DEG - VISION_BASE_DEG) / VISION_STEP_DEG);

const sizeOf = (t: Pick<Doc<"combatTokens">, "size">) => Math.max(1, Math.min(3, Math.trunc(t.size) || 1));

/** A token as the vision engine reads it (as convex/lib/combatVision.ts `visionTokenOf`). */
function visionToken(t: Doc<"combatTokens">): VisionToken {
  return { x: t.x, y: t.y, size: t.size, face: t.face, light: t.light, side: t.side, characterId: t.ref.kind === "pc" ? t.ref.characterId : null, revealedTo: t.revealedTo };
}

/** How an enemy sees a token (DA3, DA18): in clear light, in dim light, or not at all. */
export type EnemySight = "clear" | "dim" | "none";

/**
 * DA3 / DA18 (user 2026-10-30): how the enemy token `enemy` sees the token `at` under the map's light. Day phases light
 * everything, so every square is clear. The dim phases (R8: Nautical Twilight and Nightfall, the Witherwild dusk; "full
 * vision" on the map) count as dim light here (user 2026-10-30, dcm-bxp.99.19.62 (3)): what the enemy sees then it sees
 * dimly, so Cloaked asks for the Finesse roll instead of ending, except where the night's light would show it clearly (a
 * torch or campfire's clear reach, the enemy's own Melee sight; user 2026-10-30, dcm-bxp.99.19.65 (1)). At night `at` is clear when its best square is clear
 * (level 2) from the enemy's eye under the enemy's own night vision or carried light, every other token's carried light
 * (the rogue's own torch too), the map's lit lights and glowing terrain (R9), and dim when it is dim (level 1). The enemy
 * looks straight at `at` with the widest cone, so facing never decides. GM fog marks are the players' view and are not
 * applied.
 */
export function enemySight(scene: Pick<Scene, "prepared" | "tokens" | "phase">, enemy: Doc<"combatTokens">, at: Doc<"combatTokens">): EnemySight {
  const ez = sizeOf(enemy);
  const az = sizeOf(at);
  const face = Math.atan2(at.y + az / 2 - (enemy.y + ez / 2), at.x + az / 2 - (enemy.x + ez / 2));
  const viewer = `token:${enemy._id}`;
  const others = scene.tokens.filter((t) => t._id !== enemy._id).map(visionToken);
  const view = createView(scene.prepared, { token: { ...visionToken(enemy), face }, characterId: viewer, instinct: WIDE_INSTINCT }, { phase: scene.phase ?? "", tokens: others });
  // Read as a non-PC token (tokenVisibility always shows a PC token, Q4) revealed to this viewer, so a dim square reads
  // "dim" rather than "hidden" (R10's GM reveal is the players' view, not the enemy's).
  const target: VisionToken = { ...visionToken(at), side: "neutral", revealedTo: [viewer] };
  const seen = tokenVisibility(view, target);
  if (seen === "hidden") return "none";
  if (seen !== "clear" || lightOf(scene.phase ?? "") !== "dim") return seen;
  // dcm-bxp.99.19.65 (1) (user 2026-10-30): in a dim phase a rogue inside a light's clear reach (a torch, a campfire) is
  // seen clearly, as at night: the same look under night light decides; anything less stays dim.
  const lit = createView(scene.prepared, { token: { ...visionToken(enemy), face }, characterId: viewer, instinct: WIDE_INSTINCT }, { phase: NIGHT_LOOK, tokens: others });
  return tokenVisibility(lit, target) === "clear" ? "clear" : "dim";
}

/** A night phase (R8), for the dim-phase look at the lights only (`enemySight`). */
const NIGHT_LOOK = "Deep Night";

/** DA3: whether the enemy token `enemy` sees the token `at` in clear light (`enemySight`). */
export function enemySees(scene: Pick<Scene, "prepared" | "tokens" | "phase">, enemy: Doc<"combatTokens">, at: Doc<"combatTokens">): boolean {
  return enemySight(scene, enemy, at) === "clear";
}

/** The revealed enemy tokens (none in `hidden`) with a clear line to `at` (walls and closed doors block it; cover does not). */
function enemiesInLine(scene: Pick<Scene, "prepared" | "tokens" | "visionObjects">, at: Doc<"combatTokens">, hidden: ReadonlySet<Id<"combatTokens">>): Doc<"combatTokens">[] {
  return scene.tokens.filter((t) => t._id !== at._id && t.side === "enemy" && !hidden.has(t._id) && lineOfSight(scene.prepared, t, at, scene.visionObjects).lineOfSight);
}

/**
 * Q9 (a), CB p.42 (Rogue, "Cloaked"): "After you make an attack or end a move within line of sight of an adversary, you are
 * no longer Cloaked." DA3 (user 2026-10-30): only a revealed enemy token counts (none in `hidden`: the Hidden condition,
 * a defeated adversary), and only when it has a clear line to `at` AND sees it in clear light (`enemySees`).
 */
export function inSightOfAdversary(
  scene: Pick<Scene, "prepared" | "tokens" | "visionObjects" | "phase">,
  at: Doc<"combatTokens">,
  hidden: ReadonlySet<Id<"combatTokens">> = new Set(),
): boolean {
  return enemiesInLine(scene, at, hidden).some((t) => enemySees(scene, t, at));
}

/**
 * DA18: what the revealed enemies with a clear line to `at` see of it. `clear`: one of them sees it in clear light (Cloaked
 * ends outright); otherwise `dim` lists those that see it in dim light (Cloaked asks for a Finesse roll). Both empty: it
 * stands in darkness for all of them (Cloaked stays).
 */
export function enemySightOf(
  scene: Pick<Scene, "prepared" | "tokens" | "visionObjects" | "phase">,
  at: Doc<"combatTokens">,
  hidden: ReadonlySet<Id<"combatTokens">> = new Set(),
): { clear: boolean; dim: Doc<"combatTokens">[] } {
  const dim: Doc<"combatTokens">[] = [];
  for (const t of enemiesInLine(scene, at, hidden)) {
    const seen = enemySight(scene, t, at);
    if (seen === "clear") return { clear: true, dim: [] };
    if (seen === "dim") dim.push(t);
  }
  return { clear: false, dim };
}

type Difficulty = { value: number; label: string };

/**
 * The enemy tokens that see nothing (DA3): an adversary with the Hidden condition, defeated or gone, and a custom token
 * with the Hidden condition. `difficulty`: each seeing adversary token's Difficulty (its stat block plus its effects, as an
 * attack reads it) for DA18's roll; custom and PC tokens have none. One `get` per adversary token (a map holds at most
 * MAX_COMBAT_TOKENS).
 */
async function enemyStates(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  tokens: readonly Doc<"combatTokens">[],
): Promise<{ hidden: Set<Id<"combatTokens">>; difficulty: Map<Id<"combatTokens">, Difficulty> }> {
  const hidden = new Set<Id<"combatTokens">>();
  const difficulty = new Map<Id<"combatTokens">, Difficulty>();
  for (const t of tokens) {
    if (t.side !== "enemy") continue;
    if (t.ref.kind === "custom") {
      if (t.ref.conditions.includes("hidden")) hidden.add(t._id);
    } else if (t.ref.kind === "adversary") {
      const instance = await ctx.db.get("encounterAdversaries", t.ref.adversaryId);
      if (instance === null || instance.campaignId !== campaignId || instance.defeated || instance.conditions.includes("hidden")) hidden.add(t._id);
      else difficulty.set(t._id, { value: difficultyOf(instance), label: instance.label });
    }
  }
  return { hidden, difficulty };
}

/**
 * Whether the character's Cloaked has a source of its own (Vanishing Act, CB p.42: "You remain Cloaked in this way until
 * you roll with Fear or until your next rest."; pin dcm-bxp.99.19.42; user R5, dcm-bxp.99.19.52): its marker on the sheet
 * (`conditionSources`, convex/lib/cardRunner.ts). Such a Cloaked ends only by its own endings (a roll with Fear, the next
 * rest), never by a move or an attack; unconscious or dead still drops it.
 */
export function sourcedCloak(sheet: Pick<CharacterSheet, "conditions" | "effects">): boolean {
  return conditionSources(sheet, "cloaked").length > 0;
}

/** The sheet without Cloaked (and without any source marker for it). */
const uncloaked = (s: CharacterSheet): CharacterSheet => withoutCondition(s, "cloaked");

/** Hidden and Cloaked: the conditions C2 `hiddenEnds` ends (CB p.102, CB p.42). */
type Hide = "hidden" | "cloaked";

/**
 * C2 Book (plan rule-switches RFA, user 2026-11-06): the PC's Hidden and Cloaked that a move into sight or an attack
 * ends. CB p.102 (Hidden): "After an adversary moves to where they would see you, you move into their line of sight, or
 * you make an attack, you are no longer Hidden." CB p.42 (Cloaked) says the same for Cloaked. A condition with a source
 * of its own (Vanishing Act's Cloaked, a card's Hidden; `conditionSources`) ends by its own endings and is left out.
 */
export function endableHides(sheet: Pick<CharacterSheet, "conditions" | "effects">): Hide[] {
  return (["hidden", "cloaked"] as const).filter((c) => sheet.conditions.includes(c) && conditionSources(sheet, c).length === 0);
}

/** "Hidden", "Cloaked" or "Hidden and Cloaked". */
const hidesLabel = (names: readonly Hide[]): string => names.map((c) => (c === "hidden" ? "Hidden" : "Cloaked")).join(" and ");

/** The sheet without the conditions `names` (and their source markers). */
const withoutHides = (s: CharacterSheet, names: readonly Hide[]): CharacterSheet => names.reduce((acc, c) => withoutCondition(acc, c), s);

// ---------------------------------------------------------------- C2 Manual (plan rule-switches RM)

/** C2 `hiddenEnds` (CB p.102) is Manual in this campaign: the app ends neither Hidden nor Cloaked and notes it for the GM. */
export function hiddenEndsManual(campaign: Pick<Doc<"campaigns">, "frameId" | "ruleModes">): boolean {
  return ruleMode(campaign, "hiddenEnds") === "manual";
}

/**
 * C2 Manual: what a note asks the GM to remove: the PC's Hidden and / or ordinary Cloaked ("Hidden", "Cloaked",
 * "Hidden and Cloaked"), or null. A condition with a source of its own (Vanishing Act's Cloaked, a card's Hidden) ends by
 * its own endings and is left out.
 */
export function hiddenLabel(sheet: Pick<CharacterSheet, "conditions" | "effects">): string | null {
  const names = endableHides(sheet);
  return names.length === 0 ? null : hidesLabel(names);
}

/** C2 Manual: the note for an attack ("Mira attacks with Charge: remove Cloaked?"). */
export function hiddenAttackNote(name: string, use: string, label: string): string {
  return `${name} attacks with ${use}: remove ${label}?`;
}

/** C2 Manual: the note for a move that ended in an enemy's sight ("Mira moved into the Bandit's sight: remove Hidden?"). */
export function hiddenMoveNote(name: string, seer: string, label: string, dim: boolean): string {
  return `${name} moved into ${seer}'s sight${dim ? " in dim light" : ""}: remove ${label}?`;
}

/** C2 Manual: the note for an enemy's move that ended where it sees a Hidden PC ("Bandit moved to where it sees Mira: remove Hidden?"). */
export function hiddenSeenNote(seer: string, name: string, dim: boolean): string {
  return `${seer} moved to where it sees ${name}${dim ? " in dim light" : ""}: remove Hidden?`;
}

/** An enemy token's name for a C2 note: a custom token's name, an adversary's label ("the Bandit" reads as written). */
function seerName(t: Doc<"combatTokens">, difficulty: ReadonlyMap<Id<"combatTokens">, Difficulty>): string {
  if (t.ref.kind === "custom") return t.ref.name;
  return difficulty.get(t._id)?.label ?? "an adversary";
}

/**
 * dcm-bxp.99.19.65 (4) (user 2026-10-30): an attack made outside the attack path (Charge's 1d12 damage, a card's attack,
 * `use` names it) ends the character's ordinary Cloaked (CB p.42: "After you make an attack … you are no longer
 * Cloaked") and, C2 Book (plan rule-switches RFA, CB p.102), the ordinary Hidden; Vanishing Act's Cloaked
 * (`sourcedCloak`) and a sourced Hidden stay (`endableHides`). One public, undoable `feature` row in `options.groupId` (or
 * a group of its own). Returns whether Cloaked ended (callers name it). C2 Manual (plan rule-switches RM): nothing ends; a
 * GM-only note in the group asks to remove the PC's Hidden / Cloaked instead (false).
 */
export async function uncloakAfterAttack(ctx: MutationCtx, campaign: Doc<"campaigns">, characterId: Id<"characters">, actorId: Id<"users">, use: string, options: { groupId?: string } = {}): Promise<boolean> {
  const character = await ctx.db.get("characters", characterId);
  if (character === null || character.campaignId !== campaign._id) return false;
  const sheet = readSheet(character.sheet);
  if (hiddenEndsManual(campaign)) {
    const label = hiddenLabel(sheet);
    if (label !== null) await postRuleNote(ctx, campaign, { ruleId: "hiddenEnds", summary: hiddenAttackNote(sheet.name, use, label), groupId: options.groupId ?? newGroupId(), actorId });
    return false;
  }
  const names = endableHides(sheet);
  if (names.length === 0) return false;
  await saveSheet(ctx, character._id, withoutHides(sheet, names));
  await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId,
    kind: "feature",
    visibility: "public",
    summary: `${sheet.name} attacks with ${use} and is no longer ${hidesLabel(names)}`,
    before: sheet,
    groupId: options.groupId ?? newGroupId(),
    undoable: true,
  });
  return names.includes("cloaked");
}

/** How a move came about, for `uncloakAfterMove`. */
export type UncloakOptions = {
  /**
   * The actionLog group of the use that made the move (dcm-bxp.99.19.59: Charge): the Cloaked rows join it, so one undo
   * reverts the use, the move and Cloaked together. Without it the rows form their own group.
   */
  groupId?: string;
  /**
   * The GM moved the token (`combatTokens.move` by the GM). Unless the GM also owns the character, the drag is not the
   * rogue's move (user 2026-10-30, dcm-bxp.99.19.62 (2)): no roll, and Cloaked stays.
   */
  byGm?: boolean;
};

/**
 * Cloaked on a move (DA3, DA18). When the character whose PC token just ended a move on the live map is Cloaked:
 * - unconscious or dead (user 2026-10-30, dcm-bxp.99.19.62 (2): a rogue who is unconscious or dead drops Cloaked):
 *   Cloaked ends, whoever moved the token and whatever sees it (one public, undoable `feature` row);
 * - else a GM's drag (`options.byGm`, the GM not the character's owner) changes nothing: it is not the rogue's move;
 * - else, unless Cloaked comes from Vanishing Act (`sourcedCloak`, pin dcm-bxp.99.19.42), when a revealed enemy
 *   with a clear line to its square
 *   - sees it in clear light: Cloaked ends (one public, undoable `feature` row);
 *   - sees it only in dim light (user 2026-10-30, dcm-bxp.99.19.53 (4); a dim time phase counts, `enemySight`): the
 *     rogue makes ONE Finesse action roll (`cloakRoll`); success keeps Cloaked, failure ends it;
 *   - sees it nowhere (darkness): nothing happens.
 * C2 Book (plan rule-switches RFA, user 2026-11-06; CB p.102 "you move into their line of sight … you are no longer
 * Hidden"): an ordinary Hidden (no source of its own) ends the same way, together with Cloaked: clear sight ends it, dim
 * light asks the same Finesse roll and a failure ends it.
 * C2 Manual (plan rule-switches RM, CB p.102): after the unconscious / dead and GM-drag checks, a Hidden or ordinary
 * Cloaked PC seen in clear or dim light loses nothing and makes no roll; one GM-only note ("Mira moved into the Bandit's
 * sight: remove Hidden?") joins the move's group.
 * The rows join `options.groupId` when given. Returns whether Hidden or Cloaked ended. `combatTokens.move` calls it after patching
 * the token; `featurePrompts.charge` after a successful Charge moved it.
 */
export async function uncloakAfterMove(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  map: Doc<"combatMaps">,
  token: Doc<"combatTokens">,
  actorId: Id<"users">,
  options: UncloakOptions = {},
): Promise<boolean> {
  if (token.ref.kind !== "pc" || !map.live) return false;
  const character = await ctx.db.get("characters", token.ref.characterId);
  if (character === null || character.campaignId !== campaign._id) return false;
  const sheet = readSheet(character.sheet);
  const cloaked = sheet.conditions.includes("cloaked");
  // C2 (plan rule-switches RM, RFA): a Hidden PC's move is checked too (Book ends it, Manual notes it).
  const manual = hiddenEndsManual(campaign);
  const names = endableHides(sheet);
  const label = names.length === 0 ? null : hidesLabel(names);
  if (!cloaked && label === null) return false;
  const groupId = options.groupId ?? newGroupId();
  const drop = async (summary: string, after: CharacterSheet): Promise<true> => {
    await saveSheet(ctx, character._id, after);
    await logAction(ctx, { campaignId: campaign._id, characterId: character._id, actorId, kind: "feature", visibility: "public", summary, before: sheet, groupId, undoable: true });
    return true;
  };
  // Not C2 (dcm-bxp.99.19.62 (2)): an unconscious or dead rogue drops Cloaked in every mode.
  if (character.status === "dead" || sheet.conditions.includes("unconscious")) {
    return cloaked ? drop(`${sheet.name} is ${character.status === "dead" ? "dead" : "unconscious"} and no longer Cloaked`, uncloaked(sheet)) : false;
  }
  if (options.byGm === true && character.ownerId !== actorId) return false;
  const scene = await loadScene(ctx, campaign, map);
  const moved = scene.tokens.find((t) => t._id === token._id) ?? token;
  const enemies = await enemyStates(ctx, campaign._id, scene.tokens);
  const sight = enemySightOf(scene, moved, enemies.hidden);
  if (!sight.clear && sight.dim.length === 0) return false;
  if (manual) {
    // No loss and no Finesse roll: one GM-only note in the move's group names the first enemy that sees the PC.
    if (label === null) return false;
    const seer = sight.clear ? enemiesInLine(scene, moved, enemies.hidden).find((t) => enemySight(scene, t, moved) === "clear") : sight.dim[0];
    const name = seer === undefined ? "an adversary" : seerName(seer, enemies.difficulty);
    await postRuleNote(ctx, campaign, { ruleId: "hiddenEnds", summary: hiddenMoveNote(sheet.name, name, label, !sight.clear), groupId, actorId });
    return false;
  }
  // Vanishing Act's Cloaked (and a sourced Hidden) stays.
  if (label === null) return false;
  if (!sight.clear) return cloakRoll(ctx, { campaign, character, sheet, gm: false }, { map, token: moved, seers: sight.dim, difficulties: enemies.difficulty }, actorId, groupId);
  return drop(`${sheet.name} ends a move in sight of an adversary and is no longer ${label}`, withoutHides(sheet, names));
}

/**
 * C2 Book (plan rule-switches RFA, user 2026-11-06), the adversary's half of CB p.102 (Hidden): "After an adversary moves
 * to where they would see you … you are no longer Hidden." After an enemy token (`token`, as it stands after the move)
 * ended a move on the live map, every PC with an ordinary Hidden (no source of its own) that it has a clear line to:
 * - seen in clear light: Hidden ends (one public, undoable `feature` row);
 * - seen only in dim light: the PC makes the same Finesse action roll Cloaked makes (DA18, `cloakRoll`) against this
 *   enemy's Difficulty (or the GM's, when it has none); failure ends Hidden;
 * - in darkness: nothing.
 * A Cloaked PC is left alone (CB p.42: "while Cloaked you remain unseen if you are stationary when an adversary moves to
 * where they would normally see you"), and so is a Hidden adversary or a defeated one that moves (it sees nothing,
 * `enemyStates`). Manual: nothing ends and no roll; one GM-only note per PC ("Bandit moved to where it sees Mira: remove
 * Hidden?"). All rows of one move share one group. Reads: the map's tokens, one `get` per PC token; the scene only when
 * a PC on the map is Hidden.
 */
export async function unhideAfterEnemyMove(ctx: MutationCtx, campaign: Doc<"campaigns">, map: Doc<"combatMaps">, token: Doc<"combatTokens">, actorId: Id<"users">): Promise<void> {
  if (token.side !== "enemy" || !map.live) return;
  const hiddenPcs: { token: Doc<"combatTokens">; character: Doc<"characters">; sheet: CharacterSheet }[] = [];
  for (const t of await tokensOnMap(ctx, map._id)) {
    if (t.ref.kind !== "pc") continue;
    const character = await ctx.db.get("characters", t.ref.characterId);
    if (character === null || character.campaignId !== campaign._id || character.status === "dead") continue;
    const sheet = readSheet(character.sheet);
    if (sheet.conditions.includes("cloaked") || !endableHides(sheet).includes("hidden")) continue;
    hiddenPcs.push({ token: t, character, sheet });
  }
  if (hiddenPcs.length === 0) return;
  const scene = await loadScene(ctx, campaign, map);
  const enemy = scene.tokens.find((t) => t._id === token._id) ?? token;
  const enemies = await enemyStates(ctx, campaign._id, scene.tokens);
  if (enemies.hidden.has(enemy._id)) return;
  const manual = hiddenEndsManual(campaign);
  const seer = seerName(enemy, enemies.difficulty);
  const groupId = newGroupId();
  for (const pc of hiddenPcs) {
    const at = scene.tokens.find((t) => t._id === pc.token._id) ?? pc.token;
    if (!lineOfSight(scene.prepared, enemy, at, scene.visionObjects).lineOfSight) continue;
    const seen = enemySight(scene, enemy, at);
    if (seen === "none") continue;
    if (manual) {
      await postRuleNote(ctx, campaign, { ruleId: "hiddenEnds", summary: hiddenSeenNote(seer, pc.sheet.name, seen === "dim"), groupId, actorId });
      continue;
    }
    if (seen === "dim") {
      await cloakRoll(ctx, { campaign, character: pc.character, sheet: pc.sheet, gm: false }, { map, token: at, seers: [enemy], difficulties: enemies.difficulty }, actorId, groupId, `is seen in dim light by ${seer}`);
      continue;
    }
    await saveSheet(ctx, pc.character._id, withoutCondition(pc.sheet, "hidden"));
    await logAction(ctx, { campaignId: campaign._id, characterId: pc.character._id, actorId, kind: "feature", visibility: "public", summary: `${seer} moves to where it sees ${pc.sheet.name}: no longer Hidden`, before: pc.sheet, groupId, undoable: true });
  }
}

/** DA18's Finesse action roll: no Experience, no options; the Difficulty sets the outcome only. */
function cloakRollArgs(difficulty: number): DualityArgs {
  return { kind: "action", trait: "finesse", modifier: 0, difficulty, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
}

/**
 * DA18 (user 2026-10-30, dcm-bxp.99.19.53 (4)): a Cloaked rogue who ends a move in dim light in the clear line of revealed
 * enemies (`seers`) makes ONE Finesse action roll against the HIGHEST Difficulty among them (`rollCloak`). A seer without a
 * Difficulty (a custom token, an enemy-side PC or companion) is left out. When NONE of them has one (user 2026-10-30,
 * dcm-bxp.99.19.62 (1)), the GM is asked for a Difficulty (a `difficulty` request, `ask.kind` `cloak`, plan lanes B2) and
 * the roll waits for the answer (`answerCloakDifficulty`); Cloaked stays meanwhile. A rogue who is away makes no roll and
 * gets no request. Returns whether Cloaked ended (never, while the roll waits).
 */
async function cloakRoll(
  ctx: MutationCtx,
  loaded: Loaded,
  seen: { map: Doc<"combatMaps">; token: Doc<"combatTokens">; seers: readonly Doc<"combatTokens">[]; difficulties: ReadonlyMap<Id<"combatTokens">, Difficulty> },
  actorId: Id<"users">,
  groupId: string,
  /** What made the roll, for the feed (`rollCloak`). */
  seenHow?: string,
): Promise<boolean> {
  const { campaign, character } = loaded;
  if (character.status === "away") return false;
  let highest: Difficulty | null = null;
  for (const t of seen.seers) {
    const d = seen.difficulties.get(t._id);
    if (d !== undefined && (highest === null || d.value > highest.value)) highest = d;
  }
  if (highest === null) {
    await openDifficulty(ctx, {
      campaignId: campaign._id,
      mapId: seen.map._id,
      createdBy: actorId,
      payload: {
        schemaVersion: 1,
        kind: "difficulty",
        characterId: character._id,
        ask: { kind: "cloak", tokenId: seen.token._id, at: { x: seen.token.x, y: seen.token.y }, seers: seen.seers.map((t) => t._id), groupId },
      },
    });
    return false;
  }
  return rollCloak(ctx, loaded, highest, actorId, groupId, seenHow);
}

/**
 * B2 (dcm-bxp.99.19.62 (1)): the GM's Difficulty for a waiting Cloaked roll (`row`, an open `difficulty` request whose
 * `ask.kind` is `cloak`). The roll is made only while the move still stands: the map is live, the rogue's token is still
 * on the square the move ended on, the rogue is still Cloaked, not away, unconscious or dead. Otherwise the request is
 * declined and `stale` returned. The roll's rows join the move's group and belong to the player who moved (`createdBy`).
 */
export async function answerCloakDifficulty(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  row: Doc<"combatRequests">,
  difficulty: number,
  by: Id<"users">,
): Promise<{ status: "stale" } | { status: "rolled"; cloaked: boolean }> {
  const p = row.payload;
  if (p.kind !== "difficulty" || p.ask.kind !== "cloak") throw appError("NOT_FOUND");
  const ask: Extract<DifficultyAsk, { kind: "cloak" }> = p.ask;
  const stale = async () => {
    await closeRequest(ctx, row._id, "declined", by);
    return { status: "stale" as const };
  };
  const character = await ctx.db.get("characters", p.characterId);
  const token = await ctx.db.get("combatTokens", ask.tokenId);
  const map = row.mapId === undefined ? null : await ctx.db.get("combatMaps", row.mapId);
  if (character === null || character.campaignId !== campaign._id || token === null || token.campaignId !== campaign._id || map === null || !map.live) return stale();
  if (token.mapId !== map._id || token.x !== ask.at.x || token.y !== ask.at.y) return stale();
  const sheet = readSheet(character.sheet);
  if (endableHides(sheet).length === 0 || character.status !== "active" || sheet.conditions.includes("unconscious")) return stale();
  // An undone group (the Charge that made the move) would leave these rows stuck in an undone group.
  const undone = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", campaign._id).eq("groupId", ask.groupId))
    .take(GROUP_SCAN);
  if (undone.some((r) => r.undoneAt !== undefined)) return stale();
  const cloakedAfter = !(await rollCloak(ctx, { campaign, character, sheet, gm: false }, { value: difficulty, label: "set by the GM" }, row.createdBy, ask.groupId));
  await closeRequest(ctx, row._id, "resolved", by);
  return { status: "rolled", cloaked: cloakedAfter };
}

/** The rows of a move's group `answerCloakDifficulty` reads (a Charge's group holds a few). */
const GROUP_SCAN = 50;

/**
 * DA18's Finesse action roll against `highest`. Hope and Fear apply as on any action roll (Hope or a cleared Stress to the
 * rogue, Fear to the GM, armed countdowns tick); success keeps Cloaked, failure ends it. C2 Book (RFA): the same for an
 * ordinary Hidden (`endableHides`: both end together). `seenHow`: what made the roll, for the feed (default: the PC's
 * own move). The public `roll` row holds the
 * dice, the total and success / failure but never the Difficulty (U1); a GM row in the same group names it. Undo of the
 * group reverts the roll's Hope / Stress / Fear and the Cloaked change. Both rows join `groupId`. Returns whether Cloaked
 * ended.
 */
async function rollCloak(ctx: MutationCtx, loaded: Loaded, highest: Difficulty, actorId: Id<"users">, groupId: string, seenHow = "ends a move in dim light in sight of an adversary"): Promise<boolean> {
  const { campaign, character, sheet } = loaded;
  const names = endableHides(sheet);
  const label = hidesLabel(names);
  // R3 Manual (plan rule-switches RA): `resolveDuality` gains neither the Hope nor the Fear; the aftermath notes the Fear.
  const { paid, next, roll, effects, hopeFear } = await resolveDuality(ctx, loaded, cloakRollArgs(highest.value), rollDie, false);
  const success = roll.outcome === "critical" || roll.outcome === "successHope" || roll.outcome === "successFear";
  // Lane C2: the roll ends the rogue's other sourced conditions it ends (a roll with Fear), as any roll does.
  const after = endConditionsOnRoll(success ? next : withoutHides(next, names), roll).sheet;
  const { gained } = effects.fear > 0 ? await gainFear(ctx, campaign._id, effects.fear) : { gained: 0 };
  const sheetChanged = changed(sheet, after);
  if (sheetChanged) await saveSheet(ctx, character._id, after);
  // U1: players never see the Difficulty; the public record keeps the outcome it gave.
  const publicRoll = { ...roll };
  delete publicRoll.difficulty;
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId,
    kind: "roll",
    visibility: "public",
    summary: `${sheet.name} ${seenHow}: Finesse action roll ${roll.total}, ${OUTCOME_LABEL[roll.outcome]}; ${success ? `stays ${label}` : `no longer ${label}`}`,
    roll: publicRoll,
    groupId,
    ...(sheetChanged ? { before: sheet } : {}),
    ...(gained !== 0 ? { fearDelta: gained } : {}),
    ...(WITH_HOPE.includes(roll.outcome) ? { hopeGained: effects.hope > 0 && rollGaveHope(paid, roll.outcome, "action") } : {}),
    undoable: true,
  });
  await logAction(ctx, {
    campaignId: campaign._id,
    actorId,
    kind: "combat",
    visibility: "gm",
    summary: `${sheet.name} · ${label} in dim light → Finesse ${roll.total} vs Difficulty ${highest.value} (${highest.label}): ${success ? `stays ${label}` : `no longer ${label}`}`,
    groupId,
    undoable: true,
  });
  // Armed countdowns tick right after an action roll resolves (countdowns-advanced K1, CB p.162), as `rolls.duality` does.
  if (countsAsActionRoll(roll, { logKind: "roll", undone: false })) {
    await tickArmedCountdowns(ctx, { campaignId: campaign._id, entryId, outcome: roll.outcome, actorId });
  }
  // Plan rule-switches RA (S1, R3): a failure or a roll with Fear hands the spotlight to the GM (or notes it), in the group.
  await afterPcActionRoll(ctx, campaign, {
    characterId: character._id,
    name: sheet.name,
    kind: "action",
    success,
    withFear: outcomeWithFear(roll.outcome),
    fearWithheld: fearWithheldBy(hopeFear, "action", roll.outcome),
    groupId,
    actorId,
  });
  return !success;
}
