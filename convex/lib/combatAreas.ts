import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import type { AreaSpec, CardEffect, CardUse, ConditionRef, EndEvent, Escape, Mod, StandardCondition, Step } from "../../src/lib/domain/card-effects/types";
import {
  alongTo,
  forcedRange,
  pullSquare,
  areaExpires,
  areaHpMarked,
  blocksBetween,
  carriedTo,
  centreOf,
  circle,
  entersRange,
  inArea,
  isWindDirection,
  memberSideFits,
  moveBreaks,
  moveEvents,
  placementHolds,
  rangeSquares,
  rangesCrossed,
  sightDisc,
  wall,
  wallBetween,
  type AreaShapeOnMap,
  type MoveEventKind,
  type MoveLimit,
  type Point,
} from "../../src/lib/domain/feature-effects/areas";
import type { AdversaryFeatureEffect } from "../../src/lib/domain/adversary-effects/types";
import { tokenDistance } from "../../src/lib/domain/combat-actions/distance";
import { appError } from "../../src/lib/errors/app-error";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction, newGroupId } from "./actionLog";
import { blockOf } from "./adversaryFeatures";
import { parseChoices } from "./cardChoices";
import { gmLines, instanceWrites, writeInstances } from "./cardRows";
import { actorSheetAfter, buildRun, instanceModsOn, runCard, sheetModsOn, tokenIdsOf, type UsePick } from "./cardRunner";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { FEATURE_KEY_PREFIX } from "../../src/lib/domain/feature-effects/ids";
import { readSheet, saveSheet } from "./characterSheet";
import type { AttackScene } from "./combatActions";
import { loadScene, viewOf } from "./combatVision";
import { rollDie } from "./dice";
import { campaignFearState } from "./fear";
import { tokensOnMap } from "./combatMaps";
import { viewerSeesThrough, type AreaSightBlock, type SightDisc } from "./areaSight";
import type { AreaCentre } from "./validators/combatMaps";

/**
 * Live map areas (plan lanes, tracer E4; the area runtime of sheet-drawer SD-A, Q14; docs/tasks/TASK-LN-E4.md). The
 * `combatAreas` table (SD0) holds one row per area a feature or card drew. This module is the server half of the
 * runtime; the pure geometry is src/lib/domain/feature-effects/areas.ts.
 *
 * - `placeAreasFromPlan` writes the plan's `area` steps (NV11) in the use's own mutation: centre on the caster's token
 *   (`self`), the use's first target (`target`) or a picked square (`point`, checked against `placeWithin`). Using the
 *   same area again ends the old one (one live area per caster, feature and label).
 * - `activeAreasOnMap` / `areaShape`: the live areas and where they are now (a token centre follows its token).
 * - `areaFactsFor`: the areas a token stands in, for `StateFacts.areas` (the runner's `inArea` check; read by
 *   `buildRun` at each roll).
 * - `areasAfterMove`: after a token moves (`combatTokens.move`): `onEnter` / `onCross` areas it entered, passed through
 *   or crossed get a public feed row naming the area and the creature (the steps are the table's until wave 5's data
 *   and a runner pass; see the task doc), and an area whose `endsOn` holds `ownerLeavesArea` ends when its caster leaves
 *   it (Circle of Power, HF p.16: "This spell lasts until the last token is removed or you exit the circle").
 * - `rangeTriggersAfterMove`: an enemy token that comes within a card's `whenEnemyEntersRange` range of a PC (Hold the
 *   Line) gets a feed row naming the card.
 * - `sightBlockers`: Dark Cloud's blocking discs for the vision engine (CB p.42: "Anyone in this cloud can't see
 *   outside of it, and anyone outside of it can't see in").
 *
 *
 * Plan lanes-2 E4 (round 2, docs/tasks/TASK-LN2-E4.md): walls (`shape: "wall"`, two picked squares), `anchored` areas (a
 * token centre stays on its square), `count` areas (one per picked square), damageable areas (`damage`, Wild Fortress),
 * areas ending on their caster's events (`endAreasOnCasterEvent`), see-through darkness per viewer (`areaSightBlocks`),
 * member and observer conditions (`memberConditionsFor`, `observerConditions`), a `leave` gate on moves (`leaveGate`).
 *
 * The public functions (`list`, `remove`, `damage`) are in convex/combatAreas.ts; this module holds no Convex function, so
 * the queries that need one helper do not load the others (dcm-uh6r). Reads: `combatAreas.by_map`, at most MAX_MAP_AREAS rows (ended rows are swept a day
 * after `endedAt`, convex/cleanup.ts).
 */

/** The most area rows read for one map (live ones plus the ended ones the cron has not swept yet). */
export const MAX_MAP_AREAS = 200;

/** Every `area` step of a list, nested ones included. */
function areaSteps(steps: readonly Step[]): AreaSpec[] {
  const out: AreaSpec[] = [];
  for (const step of steps) {
    if (step.kind === "area") out.push(step.area);
    for (const value of Object.values(step)) {
      if (!Array.isArray(value)) continue;
      for (const x of value as unknown[]) {
        if (x === null || typeof x !== "object") continue;
        if ("kind" in x) out.push(...areaSteps([x as Step]));
        else if (Array.isArray((x as { steps?: unknown }).steps)) out.push(...areaSteps((x as { steps: Step[] }).steps));
      }
    }
  }
  return out;
}

/** The written area spec of a stored row (a card by its id, a feature by its feature id), by its use and label. */
export function areaSpecOf(sourceId: string, useId: string | undefined, label: string): AreaSpec | undefined {
  const entry = cardEffect(sourceId) ?? featureEffect(sourceId);
  if (entry === undefined) return undefined;
  const uses = useId === undefined ? entry.uses : entry.uses.filter((u) => u.id === useId);
  return uses.flatMap((u) => areaSteps(u.steps)).find((a) => a.label === label);
}

/** The map's rows still marked live, spent ones included (`placeArea` ends the old copy of a redrawn area through them). */
async function liveAreaRows(ctx: QueryCtx, mapId: Id<"combatMaps">): Promise<Doc<"combatAreas">[]> {
  const rows = await ctx.db
    .query("combatAreas")
    .withIndex("by_map", (q) => q.eq("mapId", mapId))
    .take(MAX_MAP_AREAS);
  return rows.filter((a) => a.status === "active");
}

/**
 * The live areas on a map. Plan lanes-2 E4.4 (dcm-ii4): an area whose spec ends on `tokensGone` is not live while its
 * caster holds no tokens of its card or feature (Circle of Power, HF p.16: "This spell lasts until the last token is
 * removed"), whichever path spent the last one (the caster's use, an ally's roll, an evaded attack, a hand edit of the
 * sheet). Read, not written: undoing the spend gives the tokens and the area back. `combatCards.afterUse` and
 * `endTokensGone` (cardRows) still end the row when the caster's own use spends the last token.
 */
export async function activeAreasOnMap(ctx: QueryCtx, mapId: Id<"combatMaps">): Promise<Doc<"combatAreas">[]> {
  const rows = await liveAreaRows(ctx, mapId);
  const spent = await spentAreaIds(ctx, rows);
  return spent.size === 0 ? rows : rows.filter((a) => !spent.has(a._id));
}

/** The `cardTokens` key of an area's source: the card id for a card, `feat:<featureId>` for a feature (featureRunner). */
export function areaTokenKey(sourceId: string): string {
  return cardEffect(sourceId) !== undefined ? sourceId : `${FEATURE_KEY_PREFIX}${sourceId}`;
}

/** Whether the sheet holds no tokens under `key`. */
export function tokensGoneOn(sheet: Pick<CharacterSheet, "cardTokens">, key: string): boolean {
  return ((sheet.cardTokens ?? []).find((t) => t.cardId === key)?.count ?? 0) <= 0;
}

/**
 * The ids of the rows whose spec ends on `tokensGone` and whose caster holds none of those tokens (dcm-ii4). One
 * character read per caster with such an area; an unreadable or foreign sheet leaves its areas live.
 */
async function spentAreaIds(ctx: QueryCtx, rows: readonly Doc<"combatAreas">[]): Promise<Set<string>> {
  const out = new Set<string>();
  const sheets = new Map<string, Pick<CharacterSheet, "cardTokens"> | null>();
  for (const area of rows) {
    if (!(areaSpecOf(area.featureId, area.useId, area.label)?.endsOn ?? []).includes("tokensGone")) continue;
    if (!sheets.has(area.characterId)) {
      const character = await ctx.db.get("characters", area.characterId);
      let sheet: Pick<CharacterSheet, "cardTokens"> | null = null;
      if (character !== null && character.campaignId === area.campaignId) {
        try {
          sheet = readSheet(character.sheet);
        } catch {
          sheet = null;
        }
      }
      sheets.set(area.characterId, sheet);
    }
    const sheet = sheets.get(area.characterId);
    if (sheet && tokensGoneOn(sheet, areaTokenKey(area.featureId))) out.add(area._id);
  }
  return out;
}

const asPoint = (p: readonly number[]): Point => [p[0] ?? 0, p[1] ?? 0];

/** Where the area is now: a wall between its ends; a token centre follows its token; null when that token is no longer on the map. */
export function areaShape(area: Doc<"combatAreas">, tokens: readonly Doc<"combatTokens">[]): AreaShapeOnMap | null {
  if (area.shape === "wall") return area.wall ? wall(asPoint(area.wall.a), asPoint(area.wall.b)) : null;
  if (area.centre.kind === "square") return circle({ x: area.centre.x, y: area.centre.y }, area.radius);
  const tokenId = area.centre.tokenId;
  const token = tokens.find((t) => t._id === tokenId);
  return token ? circle(token, area.radius) : null;
}

/** Ends a live area (its scene, its caster's rest, the GM, its own end). */
export async function endArea(ctx: MutationCtx, area: Doc<"combatAreas">): Promise<void> {
  if (area.status !== "active") return;
  await ctx.db.patch("combatAreas", area._id, { status: "ended", endedAt: Date.now() });
}

export type PlaceInput = {
  campaignId: Id<"campaigns">;
  map: Doc<"combatMaps">;
  characterId: Id<"characters">;
  /** The card id or the feature id that drew it, and the use. */
  sourceId: string;
  useId?: string;
  spec: Omit<AreaSpec, "mods">;
  centre: AreaCentre;
  /** A wall's two end squares (`shape: "wall"`). */
  wallEnds?: { a: { x: number; y: number }; b: { x: number; y: number } };
  /** The caster's token (for `placeWithin`); null off the map's token list. */
  ownerToken: Doc<"combatTokens"> | null;
  /** Leave the caster's older area of the same feature and label live (a `count` area's siblings). */
  keepOld?: boolean;
};

/** A square on the map, else COMBAT_TARGET_INVALID; `placeWithin` of the caster's token is checked too. */
function checkSquare(input: Pick<PlaceInput, "map" | "ownerToken" | "spec">, p: { x: number; y: number }): { x: number; y: number } {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x >= input.map.w || p.y >= input.map.h) throw appError("COMBAT_TARGET_INVALID", "That square is off the map.");
  const square = { x: Math.trunc(p.x), y: Math.trunc(p.y) };
  if (input.ownerToken && !placementHolds(input.spec, input.ownerToken, square)) throw appError("COMBAT_TARGET_INVALID", `${input.spec.label} must be placed within ${input.spec.placeWithin} range.`);
  return square;
}

/**
 * Writes one live area. A square centre (and a wall's two ends) must be on the map and within `placeWithin` of the caster
 * (COMBAT_TARGET_INVALID). A wall needs both ends (INVALID without). An `anchored` token centre is stored as the token's
 * square (Phantom Retreat, CB p.336: "where you're currently standing"). A `damageable` area starts with no HP marked.
 * The caster's old live area of the same feature and label ends first (not with `keepOld`).
 */
export async function placeArea(ctx: MutationCtx, input: PlaceInput): Promise<Id<"combatAreas">> {
  const { spec } = input;
  let centre = input.centre;
  let wallRow: { a: number[]; b: number[] } | undefined;
  if (spec.shape === "wall") {
    if (input.wallEnds === undefined) throw appError("INVALID", `Pick the two ends of ${spec.label}.`);
    const a = checkSquare(input, input.wallEnds.a);
    const b = checkSquare(input, input.wallEnds.b);
    wallRow = { a: [a.x, a.y], b: [b.x, b.y] };
    centre = { kind: "square", x: a.x, y: a.y };
  } else if (centre.kind === "square") {
    centre = { kind: "square", ...checkSquare(input, centre) };
  } else if (spec.anchored === true) {
    const tokenId = centre.tokenId;
    const token = input.ownerToken?._id === tokenId ? input.ownerToken : await ctx.db.get("combatTokens", tokenId);
    if (token === null || token.mapId !== input.map._id) throw appError("FEATURE_NEEDS_MAP");
    centre = { kind: "square", x: token.x, y: token.y };
  }
  if (input.keepOld !== true) {
    for (const old of await liveAreaRows(ctx, input.map._id)) {
      if (old.characterId === input.characterId && old.featureId === input.sourceId && old.label === spec.label) await endArea(ctx, old);
    }
  }
  const hp = spec.damageable;
  return ctx.db.insert("combatAreas", {
    campaignId: input.campaignId,
    mapId: input.map._id,
    featureId: input.sourceId,
    ...(input.useId !== undefined ? { useId: input.useId } : {}),
    characterId: input.characterId,
    label: spec.label.slice(0, 80),
    shape: spec.shape === "wall" ? "wall" : "circle",
    centre,
    ...(wallRow ? { wall: wallRow } : {}),
    ...(hp ? { damage: { major: hp.major, severe: hp.severe, hpMax: hp.hp, hp: 0 } } : {}),
    radius: spec.radius,
    blocksSight: spec.blocksSight === true,
    expires: areaExpires(spec.duration),
    status: "active",
    createdAt: Date.now(),
  });
}

/** The most areas one `count` step places (Forest Sprites, CB p.339: one per Hope spent). */
export const MAX_AREA_COUNT = 10;

export type PlanAreasInput = Omit<PlaceInput, "spec" | "centre" | "wallEnds" | "keepOld"> & {
  steps: readonly PlanStep[];
  /** The map token of a runner id (the actor's id is its own token), or null. */
  tokenOf: (runnerId: string) => Id<"combatTokens"> | null;
  /** The square the player picked for a `point` centre (dcm-dgu); a `point` area without one is INVALID. */
  point?: { x: number; y: number };
  /**
   * Plan lanes-2 E4: more squares, after `point`. A `count` area (Forest Sprites, dcm-5yew) places one area on each picked
   * square (at most MAX_AREA_COUNT); a wall takes its two ends from the first two (Wall of Flame, CB p.332).
   */
  points?: readonly { x: number; y: number }[];
};

/**
 * Writes every `area` step of a plan (NV11) in the use's mutation; returns the new rows' ids. A wall takes the first two
 * picked squares as its ends; a `count` area with a `point` centre places one area per picked square (its siblings stay
 * live; using it again ends the old ones first).
 */
export async function placeAreasFromPlan(ctx: MutationCtx, input: PlanAreasInput): Promise<Id<"combatAreas">[]> {
  const out: Id<"combatAreas">[] = [];
  const squares = [...(input.point ? [input.point] : []), ...(input.points ?? [])];
  for (const step of input.steps) {
    if (step.kind !== "area") continue;
    const { mods: _mods, ...spec } = step.area;
    void _mods;
    if (spec.shape === "wall") {
      const [a, b] = squares;
      if (a === undefined || b === undefined) throw appError("INVALID", `Pick the two ends of ${spec.label}.`);
      out.push(await placeArea(ctx, { ...input, spec, centre: { kind: "square", x: a.x, y: a.y }, wallEnds: { a, b } }));
      continue;
    }
    if (spec.centre === "point") {
      if (squares.length === 0) throw appError("INVALID", `Pick a square for ${spec.label}.`);
      const picks = spec.count === undefined ? squares.slice(0, 1) : squares.slice(0, MAX_AREA_COUNT);
      for (const [i, p] of picks.entries()) out.push(await placeArea(ctx, { ...input, spec, centre: { kind: "square", x: p.x, y: p.y }, keepOld: i > 0 }));
      continue;
    }
    const tokenId = step.centreId === null ? null : input.tokenOf(step.centreId);
    if (tokenId === null) throw appError("FEATURE_NEEDS_MAP");
    out.push(await placeArea(ctx, { ...input, spec, centre: { kind: "token", tokenId } }));
  }
  return out;
}

/** The areas a token stands in now, for `StateFacts.areas` (`own`: the character drew it). */
export function areaFactsFor(areas: readonly Doc<"combatAreas">[], tokens: readonly Doc<"combatTokens">[], token: Doc<"combatTokens">, characterId: Id<"characters"> | null): { featureId: string; own: boolean }[] {
  const out: { featureId: string; own: boolean }[] = [];
  for (const area of areas) {
    const shape = areaShape(area, tokens);
    if (shape !== null && inArea(token, shape)) out.push({ featureId: area.featureId, own: area.characterId === characterId });
  }
  return out;
}

export { viewerSeesThrough, type AreaSightBlock, type SightDisc };

/** The vision engine's blocking discs of the live sight-blocking areas (Dark Cloud), as map objects that block sight. */
export function sightBlockers(areas: readonly Doc<"combatAreas">[], tokens: readonly Doc<"combatTokens">[]): SightDisc[] {
  return areaSightBlocks(areas, tokens).flatMap((b) => b.discs);
}

// prepareMap blocks `r * blockRadiusFactor(kind)` (0.55 for an unknown kind): undo it so the disc is the area.
const disc = (x: number, y: number, r: number): SightDisc => ({ kind: "area", x, y, r: r / 0.55, sight: "block" });

/**
 * The live sight-blocking areas as blocking discs: a circle is one disc (Dark Cloud, CB p.42), a wall a row of half-square
 * discs along its line (Veil of Night, CB p.336: "a temporary curtain of darkness between two points"). `seeThrough` says
 * which viewers the vision engine leaves it out for (convex/lib/combatVision.ts `preparedFor`).
 */
export function areaSightBlocks(areas: readonly Doc<"combatAreas">[], tokens: readonly Doc<"combatTokens">[]): AreaSightBlock[] {
  const out: AreaSightBlock[] = [];
  for (const area of areas) {
    if (!area.blocksSight) continue;
    const shape = areaShape(area, tokens);
    if (shape === null) continue;
    const discs: SightDisc[] = [];
    if (shape.shape === "circle") {
      const d = sightDisc(shape);
      discs.push(disc(d.x, d.y, d.r));
    } else {
      const [ax, ay] = [shape.a[0] + 0.5, shape.a[1] + 0.5];
      const [bx, by] = [shape.b[0] + 0.5, shape.b[1] + 0.5];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      for (let i = 0; i <= n; i++) discs.push(disc(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, 0.5));
    }
    const seeThrough = areaSpecOf(area.featureId, area.useId, area.label)?.seeThrough;
    out.push({ areaId: area._id, characterId: area.characterId, ...(seeThrough ? { seeThrough } : {}), discs });
  }
  return out;
}


// ---------------------------------------------------------------- plan lanes-2 E4: caster events, conditions, leaving

/**
 * Ends the caster's live areas whose `endsOnCaster` holds `event` (Hush, CB p.336: "you cast Hush again, or you take Major
 * damage": `majorDamage`; Veil of Night: `castsSpell`; Hold the Line: `moves`; dcm-rx1k, dcm-o44e). The caller fires it
 * where the caster's event happens (E6 / E2 for damage and spells; `combatTokens.move` for `moves`). Returns the labels
 * ended. Reads `combatAreas.by_campaign` (at most MAX_MAP_AREAS rows).
 */
export async function endAreasOnCasterEvent(ctx: MutationCtx, campaignId: Id<"campaigns">, characterId: Id<"characters">, event: EndEvent): Promise<string[]> {
  const rows = await ctx.db
    .query("combatAreas")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_MAP_AREAS);
  const ended: string[] = [];
  for (const area of rows) {
    if (area.status !== "active" || area.characterId !== characterId) continue;
    if (!(areaSpecOf(area.featureId, area.useId, area.label)?.endsOnCaster ?? []).includes(event)) continue;
    await endArea(ctx, area);
    ended.push(area.label);
  }
  return ended;
}

/** A token as the side checks read it: its side and whether it is the area owner's PC token. */
function isOwnerToken(area: Doc<"combatAreas">, token: Doc<"combatTokens">): boolean {
  return token.ref.kind === "pc" && token.ref.characterId === area.characterId;
}

/**
 * The conditions a token has from the areas it stands in (`AreaSpec.memberCondition`; Shadow Swarm, HF p.82: "Creatures
 * that aren't Cryptimoths are Vulnerable while inside that area"; dcm-wuu). Members by `side` / `excludeOwner`; the owner
 * is a PC, so its side is the party. Read by the attack paths (follow-up for E1 / E7).
 */
export function memberConditionsFor(areas: readonly Doc<"combatAreas">[], tokens: readonly Doc<"combatTokens">[], token: Doc<"combatTokens">): { label: string; condition: ConditionRef }[] {
  const out: { label: string; condition: ConditionRef }[] = [];
  for (const area of areas) {
    const spec = areaSpecOf(area.featureId, area.useId, area.label);
    if (spec?.memberCondition === undefined) continue;
    const shape = areaShape(area, tokens);
    if (shape === null || !inArea(token, shape)) continue;
    if (!memberSideFits(spec, "pc", token.side, isOwnerToken(area, token))) continue;
    out.push({ label: area.label, condition: spec.memberCondition });
  }
  return out;
}

/**
 * The conditions `target` has toward `observer` from sight-blocking areas between them: members' `perObserver` (Dark
 * Cloud, CB p.42: "Cloaked from any adversary for whom the cloud blocks line of sight"; dcm-bhp) and the owner's
 * `ownerPerObserver` (Veil of Night, CB p.336: "Hidden to adversaries on the other side of the veil"; dcm-o44e). A circle
 * blocks when one stands inside and the other outside; a wall when the line between them crosses it.
 */
export function observerConditions(areas: readonly Doc<"combatAreas">[], tokens: readonly Doc<"combatTokens">[], target: Doc<"combatTokens">, observer: Doc<"combatTokens">): { label: string; condition: StandardCondition }[] {
  const out: { label: string; condition: StandardCondition }[] = [];
  for (const area of areas) {
    if (!area.blocksSight) continue;
    const spec = areaSpecOf(area.featureId, area.useId, area.label);
    if (spec === undefined || (spec.perObserver === undefined && spec.ownerPerObserver === undefined)) continue;
    const shape = areaShape(area, tokens);
    if (shape === null || !(shape.shape === "wall" ? wallBetween(shape, observer, target) : blocksBetween(shape, observer, target))) continue;
    if (spec.ownerPerObserver !== undefined && isOwnerToken(area, target)) out.push({ label: area.label, condition: spec.ownerPerObserver });
    if (spec.perObserver !== undefined && shape.shape === "circle" && inArea(target, shape) && memberSideFits(spec, "pc", target.side, isOwnerToken(area, target))) out.push({ label: area.label, condition: spec.perObserver });
  }
  return out;
}

/** "a Finesse Roll (14) or an attack" from an `Escape` (V2). */
function escapeText(e: Escape): string {
  const traits = e.trait === undefined ? [] : typeof e.trait === "string" ? [e.trait] : [...e.trait];
  const name = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const dc = e.difficulty?.kind === "fixed" ? ` (${e.difficulty.value})` : "";
  const parts = [...(traits.length > 0 ? [`a ${traits.map(name).join(" or ")} Roll${dc}`] : []), ...(e.attack === true ? ["an attack"] : [])];
  return parts.length > 0 ? parts.join(" or ") : "an escape";
}

/**
 * The areas a move would take a member out of that hold it (`AreaSpec.leave`; Bramble Patch, CB p.230: "must succeed on a
 * Finesse Roll or deal more than 20 damage to the Dryad with an attack to leave the area"; dcm-wuu): label and what it
 * takes. `combatTokens.move` refuses a player's move out (the escape roll is the table's / E7's) and warns the GM.
 */
export function leaveGate(areas: readonly Doc<"combatAreas">[], tokens: readonly Doc<"combatTokens">[], before: Doc<"combatTokens">, after: { x: number; y: number }): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const area of areas) {
    if (area.centre.kind === "token" && area.centre.tokenId === before._id) continue;
    const spec = areaSpecOf(area.featureId, area.useId, area.label);
    if (spec?.leave === undefined) continue;
    const shape = areaShape(area, tokens);
    if (shape === null || !inArea(before, shape) || inArea({ ...before, ...after }, shape)) continue;
    if (!memberSideFits(spec, "pc", before.side, isOwnerToken(area, before))) continue;
    out.push({ label: area.label, text: `${escapeText(spec.leave)} to leave ${area.label}` });
  }
  return out;
}

/** The centre square of the caster's live area with this label (Phantom Retreat's spot, `move.relativeTo: "area"`; dcm-5yew), or null. */
export function areaCentreSquare(areas: readonly Doc<"combatAreas">[], tokens: readonly Doc<"combatTokens">[], characterId: Id<"characters">, label: string): { x: number; y: number } | null {
  const area = areas.find((a) => a.characterId === characterId && a.label === label);
  if (area === undefined) return null;
  if (area.centre.kind === "square") return { x: area.centre.x, y: area.centre.y };
  const shape = areaShape(area, tokens);
  if (shape === null || shape.shape !== "circle") return null;
  const [cx, cy] = centreOf(shape.centre);
  return { x: Math.floor(cx), y: Math.floor(cy) };
}

/**
 * A damageable area takes an attack's damage (Wild Fortress, CB p.339: "Attacks made against the dome automatically
 * succeed. The dome has the following damage thresholds and lasts until it marks 3 Hit Points"; dcm-cj8): marks 1 / 2 / 3
 * HP by its thresholds and ends at its last HP. Returns the HP marked and whether it ended.
 */
export async function damageArea(ctx: MutationCtx, area: Doc<"combatAreas">, amount: number): Promise<{ marked: number; hp: number; ended: boolean }> {
  if (area.status !== "active" || area.damage === undefined) throw appError("INVALID", `${area.label} can't be damaged.`);
  const marked = areaHpMarked(amount, area.damage.major, area.damage.severe);
  const hp = Math.min(area.damage.hpMax, area.damage.hp + marked);
  const ended = hp >= area.damage.hpMax;
  await ctx.db.patch("combatAreas", area._id, { damage: { ...area.damage, hp }, ...(ended ? { status: "ended" as const, endedAt: Date.now() } : {}) });
  return { marked, hp, ended };
}

/** What a move did to one area (`combatTokens.move` returns it). */
export type AreaMoveNote = { label: string; event: MoveEventKind; ended: boolean };

const EVENT_WORDS: Record<MoveEventKind, string> = { enter: "enters", through: "moves through", leave: "leaves", cross: "crosses" };

/**
 * After a token moved from `before` to `after`: the areas it entered, passed through, crossed or left. An `onEnter` area
 * entered or passed through, or an `onCross` wall crossed, logs one public feed row ("Grim enters Rune Circle"); an area
 * whose `endsOn` holds `ownerLeavesArea` ends when its caster's token leaves it. Areas centred on the moved token move
 * with it and are skipped. Returns the notes for the caller.
 */
export async function areasAfterMove(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  mapId: Id<"combatMaps">,
  before: Doc<"combatTokens">,
  after: Doc<"combatTokens">,
  actorId: Id<"users">,
  nameOf: () => Promise<string>,
): Promise<AreaMoveNote[]> {
  const areas = (await activeAreasOnMap(ctx, mapId)).filter((a) => !(a.centre.kind === "token" && a.centre.tokenId === after._id));
  if (areas.length === 0) return [];
  const tokens = await tokensOnMap(ctx, mapId);
  const moved = tokens.map((t) => (t._id === after._id ? after : t));
  const shapes = areas.map((a) => areaShape(a, moved));
  const live = shapes.flatMap((s, i) => (s === null ? [] : [{ shape: s, area: areas[i]! }]));
  const notes: AreaMoveNote[] = [];
  const groupId = newGroupId();
  let name: string | null = null;
  const who = async () => (name ??= await nameOf());
  for (const ev of moveEvents(before, after, live.map((l) => l.shape))) {
    const { area } = live[ev.index]!;
    const spec = areaSpecOf(area.featureId, area.useId, area.label);
    const ownerLeft = ev.kind === "leave" && after.ref.kind === "pc" && after.ref.characterId === area.characterId && (spec?.endsOn ?? []).includes("ownerLeavesArea");
    if (ownerLeft) {
      await endArea(ctx, area);
      await logAction(ctx, { campaignId, characterId: area.characterId, actorId, kind: "combat", visibility: "public", summary: `${await who()} leaves ${area.label}; it ends`, groupId, undoable: false });
      notes.push({ label: area.label, event: ev.kind, ended: true });
      continue;
    }
    const steps = ev.kind === "cross" ? spec?.onCross : ev.kind === "enter" || ev.kind === "through" ? spec?.onEnter : undefined;
    if (steps === undefined || steps.length === 0) continue;
    await logAction(ctx, { campaignId, characterId: area.characterId, actorId, kind: "combat", visibility: "public", summary: `${await who()} ${EVENT_WORDS[ev.kind]} ${area.label}`, groupId, undoable: false });
    notes.push({ label: area.label, event: ev.kind, ended: false });
    // Plan lanes-2 E4.3 (dcm-cma, dcm-wuu): the area's steps run on the creature that set it off (`to: "triggerSubject"`),
    // with the caster as the actor, when the server can write all they change; otherwise the row above is the table's.
    const ownerSelf = after.ref.kind === "pc" && after.ref.characterId === area.characterId;
    if (!ownerSelf) {
      const effect: CardEffect = { cardId: area.featureId, uses: [{ id: `${area.useId ?? "main"}:${ev.kind}`, name: area.label, activation: { kind: "action" }, steps }] };
      await runTriggeredUse(ctx, { campaignId, mapId, characterId: area.characterId, effect, name: area.label, role: "triggerSubject", tokenId: after._id, actorId, groupId });
    }
  }
  return notes;
}

/**
 * Plan lanes-2 E4.4 (dcm-ii4): ends the map's live areas whose spec ends on `ownerLeavesArea` and whose caster's token now
 * stands outside them or is off the map (Circle of Power, HF p.16: "This spell lasts until ... you exit the circle"). The
 * mover's own step out is `areasAfterMove`'s; this catches the rest: a carried caster, a forced move (`forcedMove`), the
 * caster's token taken off the map (`combatTokens.remove` / `clear`). A wall or a token-centred area that lost its token
 * is left alone. One public feed row per ended area. Returns the ended areas' labels.
 */
export async function endAreasOwnerLeft(ctx: MutationCtx, input: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps">; actorId: Id<"users"> }): Promise<string[]> {
  const areas = (await liveAreaRows(ctx, input.mapId)).filter((a) => (areaSpecOf(a.featureId, a.useId, a.label)?.endsOn ?? []).includes("ownerLeavesArea"));
  if (areas.length === 0) return [];
  const tokens = await tokensOnMap(ctx, input.mapId);
  const out: string[] = [];
  for (const area of areas) {
    const shape = areaShape(area, tokens);
    if (shape === null || shape.shape === "wall") continue;
    const owner = tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === area.characterId && t.duplicateOf === undefined);
    if (owner !== undefined && inArea(owner, shape)) continue;
    await endArea(ctx, area);
    await logAction(ctx, { campaignId: input.campaignId, characterId: area.characterId, actorId: input.actorId, kind: "combat", visibility: "public", summary: `${area.label} ends: its caster left it`, undoable: false });
    out.push(area.label);
  }
  return out;
}

/**
 * Plan lanes E4 (dcm-bpr): after an enemy token moved, the PCs it came within range of whose loadout holds a card with a
 * `whenEnemyEntersRange` use (Hold the Line, CB p.342: "If an adversary moves within Very Close range, they're pulled
 * into Melee range and Restrained") get a public feed row naming the card, so the player answers with it. Reads the PC
 * tokens' characters (the party). Feature entries with this trigger are the feature runner's (task doc).
 */
export async function rangeTriggersAfterMove(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  mapId: Id<"combatMaps">,
  before: Doc<"combatTokens">,
  after: Doc<"combatTokens">,
  actorId: Id<"users">,
  nameOf: () => Promise<string>,
): Promise<{ characterId: Id<"characters">; card: string }[]> {
  if (after.side !== "enemy") return [];
  const out: { characterId: Id<"characters">; card: string }[] = [];
  const groupId = newGroupId();
  for (const token of await tokensOnMap(ctx, mapId)) {
    if (token.ref.kind !== "pc") continue;
    const character = await ctx.db.get("characters", token.ref.characterId);
    if (character === null || character.campaignId !== campaignId) continue;
    let sheet: ReturnType<typeof readSheet>;
    try {
      sheet = readSheet(character.sheet);
    } catch {
      continue;
    }
    for (const cardId of sheet.domainCards.loadout) {
      const effect = cardEffect(cardId);
      const use = effect?.uses.find((u) => (u.activation.kind === "reaction" || u.activation.kind === "auto") && u.activation.trigger.kind === "whenEnemyEntersRange" && entersRange(before, after, token, u.activation.trigger.range));
      if (effect === undefined || use === undefined) continue;
      await logAction(ctx, { campaignId, characterId: character._id, actorId, kind: "combat", visibility: "public", summary: `${await nameOf()} moves within range of ${sheet.name}: ${use.name}`, groupId, undoable: false });
      out.push({ characterId: character._id, card: use.name });
      // Plan lanes-2 E4.3 (dcm-bpr, dcm-g90o engine half): an `auto` use runs at once on the creature that came in (its
      // `trigger` source; Hold the Line's pull and Restrained); a reaction stays the player's answer.
      if (use.activation.kind === "auto") await runTriggeredUse(ctx, { campaignId, mapId, characterId: character._id, effect: { cardId, uses: [use] }, name: use.name, role: "triggerSource", tokenId: after._id, actorId, groupId });
    }
  }
  return out;
}

// ---------------------------------------------------------------- plan lanes-2 E4.3: uses the server runs on a move

/**
 * The live map and the character's view on it (as combatActions' `attackScene`, built here from combatVision: importing
 * combatActions from this module is an import cycle through cardRows' validators). Throws off the live map or token.
 */
async function triggerScene(ctx: QueryCtx, campaign: Doc<"campaigns">, character: Doc<"characters">, mapId: Id<"combatMaps">): Promise<AttackScene> {
  const map = await ctx.db.get("combatMaps", mapId);
  if (map === null || map.campaignId !== campaign._id || !map.live) throw appError("COMBAT_MAP_NOT_FOUND");
  const scene = await loadScene(ctx, campaign, map);
  const viewer = viewOf(scene, character);
  if (viewer === null) throw appError("COMBAT_TOKEN_NOT_FOUND");
  return { map, scene, viewer, attacker: scene.tokens[viewer.index]! };
}

/**
 * Runs a use that a move set off (an area's `onEnter` / `onCross` steps, dcm-cma; a card's `auto` use on
 * `whenEnemyEntersRange`, dcm-bpr) with the PC `characterId` as the actor and the moved token as the trigger's
 * `triggerSubject` / `triggerSource`, through the card runner (`buildRun`, `runCard`, the server's dice). It writes only
 * what the server can write on its own: the actor's sheet (costs, limits), enemy instances (damage, marks, conditions;
 * `instanceWrites`) and server moves (into Melee of the anchor: `pullIntoMelee`, with `forcedMoveReduce`). A use that
 * needs a choice, a roll answer, the GM's Fear or another PC's sheet, or that the runner refuses, runs nothing (the
 * caller's feed row stays the table's). One public row names what happened, one GM row the numbers. Returns whether it ran.
 */
export async function runTriggeredUse(
  ctx: MutationCtx,
  input: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps">; characterId: Id<"characters">; effect: CardEffect; name: string; role: "triggerSubject" | "triggerSource"; tokenId: Id<"combatTokens">; actorId: Id<"users">; groupId: string },
): Promise<boolean> {
  const campaign = await ctx.db.get("campaigns", input.campaignId);
  const character = await ctx.db.get("characters", input.characterId);
  const use: CardUse | undefined = input.effect.uses[0];
  if (campaign === null || character === null || character.campaignId !== campaign._id || use === undefined) return false;
  let ran: { plan: Extract<ReturnType<typeof runCard>, { kind: "plan" }>["plan"]; built: Awaited<ReturnType<typeof buildRun>> };
  try {
    const scene = await triggerScene(ctx, campaign, character, input.mapId);
    const pick: UsePick = { effect: input.effect, use, name: input.name, limitKey: input.effect.cardId };
    const fear = await campaignFearState(ctx, campaign._id);
    const built = await buildRun(ctx, { campaign, character, sheet: readSheet(character.sheet), scene, pick, targetTokenIds: [], choices: parseChoices([{ id: input.role, value: input.tokenId }]), roll: {}, gmFear: fear.fear, lastRollWithHope: false });
    const outcome = runCard(built, pick, rollDie);
    if (outcome.kind !== "plan") return false;
    ran = { plan: outcome.plan, built };
  } catch {
    // Not on the live map, the creature can't be seen or named, a refused requirement or cost: the table's.
    return false;
  }
  const { plan, built } = ran;
  const pcs = new Set(built.creatures.all.flatMap((c) => (c.kind === "pc" ? [c.tokenId as string] : [])));
  const tableOnly = plan.steps.some((s) => s.kind === "pcDamage" || s.kind === "fold" || s.kind === "delegate" || s.kind === "area" || (s.kind === "prompt" && s.prompt !== "manual" && !(s.prompt === "move" && s.server === true)));
  if (plan.gmFearDelta !== 0 || tableOnly || plan.creatures.some((c) => pcs.has(c.id))) return false;
  const writes = instanceWrites(plan, built.creatures, input.name);
  await writeInstances(ctx, writes);
  const sheet = actorSheetAfter(built.paidSheet, plan, built.context.actor.id, input.name);
  await saveSheet(ctx, character._id, sheet);
  const map = await ctx.db.get("combatMaps", input.mapId);
  const moved: string[] = [];
  for (const step of plan.steps) {
    if (step.kind !== "prompt" || step.prompt !== "move" || step.server !== true || map === null) continue;
    const anchorToken = step.anchorId !== undefined ? tokenIdsOf(built, [step.anchorId])[0] : undefined;
    for (const tokenId of tokenIdsOf(built, step.targetIds)) {
      const anchorId = anchorToken !== undefined && anchorToken !== tokenId ? anchorToken : built.creatures.scene.attacker._id;
      if (anchorId === tokenId) continue;
      const done = await pullIntoMelee(ctx, { campaignId: input.campaignId, map, tokenId, anchorId, label: input.name, actorId: input.actorId });
      if (done !== null) moved.push(done);
    }
  }
  const manual = plan.steps.flatMap((s) => (s.kind === "prompt" && s.prompt === "manual" ? [s.text] : []));
  const parts = [`${sheet.name}: ${input.name}`, ...moved, ...manual];
  await logAction(ctx, { campaignId: input.campaignId, characterId: character._id, actorId: input.actorId, kind: "combat", visibility: "public", summary: parts.join("; ").slice(0, 500), groupId: input.groupId, undoable: false });
  const lines = gmLines(plan, built, writes);
  if (lines.length > 0) await logAction(ctx, { campaignId: input.campaignId, characterId: character._id, actorId: input.actorId, kind: "combat", visibility: "gm", summary: `${input.name}: ${lines.join("; ")}`.slice(0, 500), groupId: input.groupId, undoable: false });
  return true;
}

// ---------------------------------------------------------------- plan lanes-2 E4.3: forced moves (dcm-1yo, dcm-bpr)

/** The `forcedMoveReduce` steps of mods (Immovable Object, CB p.230). */
const reduceSteps = (mods: readonly Mod[]) => mods.reduce((n, m) => n + (m.kind === "forcedMoveReduce" ? m.steps : 0), 0);

/**
 * How many ranges a forced move of `token` loses (dcm-1yo): an adversary's stat block passives (`forcedMoveReduce` on
 * itself) and the lasting mods on its instance; a PC's lasting mods.
 */
export async function forcedMoveReduceOf(ctx: QueryCtx, campaignId: Id<"campaigns">, token: Doc<"combatTokens">): Promise<number> {
  if (token.ref.kind === "pc") {
    const character = await ctx.db.get("characters", token.ref.characterId);
    if (character === null || character.campaignId !== campaignId) return 0;
    try {
      return reduceSteps(sheetModsOn(readSheet(character.sheet)));
    } catch {
      return 0;
    }
  }
  const instance = await liveInstance(ctx, campaignId, token);
  if (instance === null) return 0;
  const block = await blockOf(ctx, instance);
  const passive = (block?.effects ?? []).flatMap((e) => e.uses.flatMap((u) => (u.activation.kind === "passive" ? (u.modifiers ?? []).flatMap((m) => (m.kind === "mod" && (m.to === undefined || m.to === "self") ? [m.mod] : [])) : [])));
  return reduceSteps(passive) + reduceSteps(instanceModsOn(instance));
}

/**
 * A move the server makes on a creature (plan lanes-2 E4.3, dcm-1yo: the server forced-move path): toward `to`, shortened
 * by its `forcedMoveReduce` ranges (Immovable Object: "moves them two fewer ranges"; none left: it stays). Writes the
 * token's square and a GM feed row when the move was shortened. Returns where it ended and the ranges it lost.
 */
export async function forcedMove(
  ctx: MutationCtx,
  input: { campaignId: Id<"campaigns">; map: Doc<"combatMaps">; tokenId: Id<"combatTokens">; to: { x: number; y: number }; label: string; actorId: Id<"users"> },
): Promise<{ x: number; y: number; reducedBy: number; moved: boolean } | null> {
  const token = await ctx.db.get("combatTokens", input.tokenId);
  if (token === null || token.mapId !== input.map._id) return null;
  const reducedBy = await forcedMoveReduceOf(ctx, input.campaignId, token);
  const target = { x: input.to.x, y: input.to.y, size: token.size };
  const range = forcedRange(token, target, reducedBy);
  const at = range === null ? { x: token.x, y: token.y } : reducedBy > 0 ? alongTo(token, target, range) : { x: input.to.x, y: input.to.y };
  const moved = at.x !== token.x || at.y !== token.y;
  if (moved) await ctx.db.patch("combatTokens", token._id, at);
  // dcm-ii4: a caster forced out of their own Circle of Power has exited it.
  if (moved && token.ref.kind === "pc") await endAreasOwnerLeft(ctx, { campaignId: input.campaignId, mapId: input.map._id, actorId: input.actorId });
  if (reducedBy > 0) await logAction(ctx, { campaignId: input.campaignId, actorId: input.actorId, kind: "combat", visibility: "gm", summary: `${input.label}: the move is ${reducedBy} range${reducedBy === 1 ? "" : "s"} shorter${moved ? "" : "; it stays"}`, undoable: false });
  return { ...at, reducedBy, moved };
}

/**
 * Pulls a creature into Melee range of `anchorId` (Hold the Line, CB p.342: "they're pulled into Melee range"; a use's
 * `move` with `mode: "intoMelee"` the server makes): to the nearest free square in Melee of the anchor (`pullSquare`),
 * through `forcedMove`. Returns the feed words, or null when it didn't move.
 */
export async function pullIntoMelee(
  ctx: MutationCtx,
  input: { campaignId: Id<"campaigns">; map: Doc<"combatMaps">; tokenId: Id<"combatTokens">; anchorId: Id<"combatTokens">; label: string; actorId: Id<"users"> },
): Promise<string | null> {
  const tokens = await tokensOnMap(ctx, input.map._id);
  const token = tokens.find((t) => t._id === input.tokenId);
  const anchor = tokens.find((t) => t._id === input.anchorId);
  if (token === undefined || anchor === undefined) return null;
  const to = pullSquare(token, anchor, tokens.filter((t) => t._id !== token._id && t._id !== anchor._id), input.map);
  if (to === null) return null;
  const done = await forcedMove(ctx, { ...input, to });
  return done?.moved === true ? "pulled into Melee range" : null;
}

// ---------------------------------------------------------------- plan lanes-2 E4: the rules a move keeps

/** One adversary feature a PC's move sets off (`pcMoves`; Shield Wall, CB p.212; dcm-xobk). E7 runs the use. */
export type MoveTrigger = { instanceId: Id<"encounterAdversaries">; feature: string; useId: string; stage: "would" | "did" };

/** What the move rules said about one move: GM warnings (a player's move is refused instead) and the triggers it set off. */
export type MoveRules = { warnings: string[]; triggers: MoveTrigger[] };

/** The adversary instance behind an enemy token, when its encounter is running and it is not defeated. */
async function liveInstance(ctx: QueryCtx, campaignId: Id<"campaigns">, token: Doc<"combatTokens">): Promise<Doc<"encounterAdversaries"> | null> {
  if (token.side !== "enemy" || token.ref.kind !== "adversary") return null;
  const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
  if (instance === null || instance.campaignId !== campaignId || instance.defeated) return null;
  const encounter = await ctx.db.get("encounters", instance.encounterId);
  return encounter !== null && encounter.status === "running" ? instance : null;
}

/** The `moveLimit` mods of a stat block's passives (Creeping Fire, CB p.216: "can only move within Very Close range"; dcm-wuu). */
function passiveMoveLimits(effects: readonly AdversaryFeatureEffect[]): MoveLimit[] {
  const out: MoveLimit[] = [];
  for (const effect of effects) {
    for (const use of effect.uses) {
      if (use.activation.kind !== "passive") continue;
      for (const m of use.modifiers ?? []) {
        if (m.kind !== "mod" || m.mod.kind !== "moveLimit" || (m.to !== undefined && m.to !== "self")) continue;
        out.push({ ...(m.mod.maxRange ? { maxRange: m.mod.maxRange } : {}), label: effect.feature });
      }
    }
  }
  return out;
}

/**
 * The `moveLimit` mods among a creature's lasting mods (Creeping Fire's kind on a condition; Hurricane, CB p.339). A
 * `direction` names the use's choice, whose pick no stored row keeps yet, so only `maxRange` applies (task doc).
 */
function lastingMoveLimits(mods: readonly Mod[], label: string): MoveLimit[] {
  return mods.flatMap((m) => (m.kind === "moveLimit" && m.maxRange !== undefined ? [{ maxRange: m.maxRange, label: m.text ?? label }] : []));
}

/**
 * The `moveLimit` mods of the areas a token stands in (members by `side`). A `direction` read from a use's choice is not
 * stored on an area row, so only `maxRange` applies here; Hurricane's wind sits on a condition (E7's instance effects).
 */
function areaMoveLimits(areas: readonly Doc<"combatAreas">[], tokens: readonly Doc<"combatTokens">[], token: Doc<"combatTokens">): MoveLimit[] {
  const out: MoveLimit[] = [];
  for (const area of areas) {
    const spec = areaSpecOf(area.featureId, area.useId, area.label);
    const limits = (spec?.mods ?? []).flatMap((m) => (m.kind === "moveLimit" ? [m] : []));
    if (spec === undefined || limits.length === 0) continue;
    const shape = areaShape(area, tokens);
    if (shape === null || !inArea(token, shape) || !memberSideFits(spec, "pc", token.side, isOwnerToken(area, token))) continue;
    for (const m of limits) {
      const direction = m.direction?.choice;
      out.push({ ...(m.maxRange ? { maxRange: m.maxRange } : {}), ...(isWindDirection(direction) ? { direction } : {}), label: area.label });
    }
  }
  return out;
}

/**
 * The rules a token's move from `before` to `after` keeps, read before it is written (plan lanes-2 E4):
 * - leaving an area that holds its members (`AreaSpec.leave`, Bramble Patch, CB p.230; dcm-wuu);
 * - movement limits (`Mod moveLimit`: an area's members, an adversary's own passive, Creeping Fire, CB p.216; dcm-3oe);
 * - a PC's move into or out of an adversary's range sets off its `pcMoves` features (Shield Wall, CB p.212: "A creature
 *   who tries to move within Very Close range of the Guard"; `stage: "would"` before the move, else after; dcm-xobk). One
 *   GM feed row names them; E7 runs the use (a would-move `negate` undoes the move).
 * A player's move that breaks a hold or a limit is MOVE_BLOCKED (the message says what it takes); the GM's drag goes
 * through with a warning. Reads the map's live areas and tokens, and per enemy token on a live map its instance and
 * encounter (at most MAX_COMBAT_TOKENS).
 */
export async function moveRules(
  ctx: MutationCtx,
  input: { campaignId: Id<"campaigns">; map: Doc<"combatMaps">; before: Doc<"combatTokens">; after: { x: number; y: number }; byGm: boolean; actorId: Id<"users">; nameOf: () => Promise<string> },
): Promise<MoveRules> {
  const { before, byGm } = input;
  const moved = { ...before, ...input.after };
  const areas = await activeAreasOnMap(ctx, input.map._id);
  const tokens = await tokensOnMap(ctx, input.map._id);
  const problems = leaveGate(areas, tokens, before, input.after).map((g) => `${g.label}: needs ${g.text}`);
  const limits = areaMoveLimits(areas, tokens, before);
  const instance = await liveInstance(ctx, input.campaignId, before);
  if (instance !== null) {
    const block = await blockOf(ctx, instance);
    if (block !== null) limits.push(...passiveMoveLimits(block.effects));
    // Plan lanes-2 E4.3 (dcm-3oe, dcm-wuu): the movement limits on what the instance carries (a card's condition, an
    // adversary's modifier), read from their entries.
    limits.push(...lastingMoveLimits(instanceModsOn(instance), instance.label));
  } else if (before.ref.kind === "pc") {
    const character = await ctx.db.get("characters", before.ref.characterId);
    if (character !== null && character.campaignId === input.campaignId) limits.push(...lastingMoveLimits(sheetModsOn(readSheet(character.sheet)), "a lasting effect"));
  }
  for (const limit of limits) {
    const broken = moveBreaks(limit, before, moved);
    if (broken !== null) problems.push(broken);
  }
  if (problems.length > 0 && !byGm) throw appError("MOVE_BLOCKED", problems[0]);
  const triggers = before.ref.kind === "pc" && input.map.live ? await pcMoveTriggers(ctx, input.campaignId, tokens, before, moved) : [];
  if (triggers.length > 0) {
    const words = triggers.map((t) => `${t.feature} (${t.stage === "would" ? "before the move" : "after the move"})`);
    await logAction(ctx, { campaignId: input.campaignId, actorId: input.actorId, kind: "adversary", visibility: "gm", summary: `${await input.nameOf()} moves: ${words.join(", ")}`, undoable: false });
  }
  return { warnings: problems, triggers };
}

/** The `pcMoves` features of the enemies on the map that a PC's move sets off (into / out of their ranges). */
async function pcMoveTriggers(ctx: QueryCtx, campaignId: Id<"campaigns">, tokens: readonly Doc<"combatTokens">[], before: Doc<"combatTokens">, after: Doc<"combatTokens">): Promise<MoveTrigger[]> {
  const out: MoveTrigger[] = [];
  for (const enemy of tokens) {
    if (enemy._id === before._id || enemy.side !== "enemy" || enemy.ref.kind !== "adversary") continue;
    const crossed = rangesCrossed(before, after, enemy);
    if (crossed.into.length === 0 && crossed.outOf.length === 0) continue;
    const instance = await liveInstance(ctx, campaignId, enemy);
    if (instance === null) continue;
    const block = await blockOf(ctx, instance);
    for (const effect of block?.effects ?? []) {
      for (const use of effect.uses) {
        const a = use.activation;
        if ((a.kind !== "auto" && a.kind !== "reaction") || a.trigger.kind !== "pcMoves") continue;
        const t = a.trigger;
        const hit = (t.into !== undefined && crossed.into.includes(t.into)) || (t.outOf !== undefined && crossed.outOf.includes(t.outOf));
        if (hit) out.push({ instanceId: instance._id, feature: effect.feature, useId: use.id ?? "main", stage: t.stage ?? "did" });
      }
    }
  }
  return out;
}

/**
 * Tokens carried along by a move (`move.mode: "withCaster"`: Wings of Light, CB p.45: "carry another willing creature";
 * Pin, HF p.71: "drags the Restrained target when it moves"; dcm-lvgm, dcm-z5a6): each takes the carrier's step. A carried
 * token must stand within Melee range of the carrier before the move (COMBAT_TARGET_INVALID); a player carries PC tokens
 * only (the willing creature), the GM any. At most 4. Returns the carried tokens' new squares.
 */
export async function carryAlong(
  ctx: MutationCtx,
  input: { map: Doc<"combatMaps">; carrierBefore: Doc<"combatTokens">; carrierAfter: { x: number; y: number }; carry: readonly string[]; byGm: boolean },
): Promise<{ tokenId: Id<"combatTokens">; x: number; y: number }[]> {
  if (input.carry.length > 4) throw appError("INVALID", "At most 4 creatures can be carried.");
  const out: { tokenId: Id<"combatTokens">; x: number; y: number }[] = [];
  const after = { ...input.carrierBefore, ...input.carrierAfter };
  for (const raw of new Set(input.carry)) {
    const id = ctx.db.normalizeId("combatTokens", raw);
    const token = id === null ? null : await ctx.db.get("combatTokens", id);
    if (token === null || token.mapId !== input.map._id || token._id === input.carrierBefore._id) throw appError("COMBAT_TARGET_INVALID");
    if (!input.byGm && token.side !== "pc") throw appError("COMBAT_TARGET_INVALID", "Only a willing creature can be carried.");
    if (tokenDistance(input.carrierBefore, token) > rangeSquares("melee")) throw appError("COMBAT_TARGET_INVALID", "A carried creature must be within Melee range.");
    const to = carriedTo(input.carrierBefore, after, token, input.map);
    await ctx.db.patch("combatTokens", token._id, to);
    out.push({ tokenId: token._id, ...to });
  }
  return out;
}
