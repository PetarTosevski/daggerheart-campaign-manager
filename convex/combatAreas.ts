import type { PlanStep } from "../src/lib/domain/card-effects/run";
import type { AreaSpec, Step } from "../src/lib/domain/card-effects/types";
import { areaExpires, circle, entersRange, inArea, moveEvents, placementHolds, sightDisc, type AreaShapeOnMap, type MoveEventKind } from "../src/lib/domain/feature-effects/areas";
import { appError } from "../src/lib/errors/app-error";
import { cardEffect } from "../src/lib/srd/card-effects/index";
import { featureEffect } from "../src/lib/srd/feature-effects/index";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { readSheet } from "./lib/characterSheet";
import { tokensOnMap } from "./lib/combatMaps";
import type { AreaCentre } from "./lib/validators/combatMaps";

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
 * No public function lives here yet: `list` (the overlay) and `remove` (the GM) need their authz-matrix entries in a
 * file outside lane E4's owns, so they are the follow-up (task doc). Reads: `combatAreas.by_map`, at most MAX_MAP_AREAS
 * rows (ended rows are swept a day after `endedAt`, convex/cleanup.ts).
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

/** The live areas on a map. */
export async function activeAreasOnMap(ctx: QueryCtx, mapId: Id<"combatMaps">): Promise<Doc<"combatAreas">[]> {
  const rows = await ctx.db
    .query("combatAreas")
    .withIndex("by_map", (q) => q.eq("mapId", mapId))
    .take(MAX_MAP_AREAS);
  return rows.filter((a) => a.status === "active");
}

/** Where the area is now: a token centre follows its token; null when that token is no longer on the map. */
export function areaShape(area: Doc<"combatAreas">, tokens: readonly Doc<"combatTokens">[]): AreaShapeOnMap | null {
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
  /** The caster's token (for `placeWithin`); null off the map's token list. */
  ownerToken: Doc<"combatTokens"> | null;
};

/**
 * Writes one live area. A wall (`shape: "wall"`) is refused until `combatAreaFields.shape` is widened (task doc); a
 * square outside `placeWithin` of the caster is COMBAT_TARGET_INVALID. The caster's old live area of the same feature
 * and label ends first.
 */
export async function placeArea(ctx: MutationCtx, input: PlaceInput): Promise<Id<"combatAreas">> {
  const { spec, centre } = input;
  if (spec.shape === "wall") throw appError("INVALID", `${spec.label} is a wall; walls can't be drawn on the map yet.`);
  if (centre.kind === "square") {
    if (!Number.isFinite(centre.x) || !Number.isFinite(centre.y) || centre.x < 0 || centre.y < 0 || centre.x >= input.map.w || centre.y >= input.map.h) throw appError("COMBAT_TARGET_INVALID", "That square is off the map.");
    if (input.ownerToken && !placementHolds(spec, input.ownerToken, { x: centre.x, y: centre.y })) throw appError("COMBAT_TARGET_INVALID", `${spec.label} must be placed within ${spec.placeWithin} range.`);
  }
  for (const old of await activeAreasOnMap(ctx, input.map._id)) {
    if (old.characterId === input.characterId && old.featureId === input.sourceId && old.label === spec.label) await endArea(ctx, old);
  }
  return ctx.db.insert("combatAreas", {
    campaignId: input.campaignId,
    mapId: input.map._id,
    featureId: input.sourceId,
    ...(input.useId !== undefined ? { useId: input.useId } : {}),
    characterId: input.characterId,
    label: spec.label.slice(0, 80),
    shape: "circle",
    centre: centre.kind === "square" ? { kind: "square", x: Math.trunc(centre.x), y: Math.trunc(centre.y) } : centre,
    radius: spec.radius,
    blocksSight: spec.blocksSight === true,
    expires: areaExpires(spec.duration),
    status: "active",
    createdAt: Date.now(),
  });
}

export type PlanAreasInput = Omit<PlaceInput, "spec" | "centre"> & {
  steps: readonly PlanStep[];
  /** The map token of a runner id (the actor's id is its own token), or null. */
  tokenOf: (runnerId: string) => Id<"combatTokens"> | null;
  /** The square the player picked for a `point` centre (dcm-dgu); a `point` area without one is INVALID. */
  point?: { x: number; y: number };
};

/** Writes every `area` step of a plan (NV11) in the use's mutation; returns the new rows' ids. */
export async function placeAreasFromPlan(ctx: MutationCtx, input: PlanAreasInput): Promise<Id<"combatAreas">[]> {
  const out: Id<"combatAreas">[] = [];
  for (const step of input.steps) {
    if (step.kind !== "area") continue;
    const { mods: _mods, ...spec } = step.area;
    void _mods;
    let centre: AreaCentre;
    if (spec.centre === "point") {
      if (input.point === undefined) throw appError("INVALID", `Pick a square for ${spec.label}.`);
      centre = { kind: "square", x: input.point.x, y: input.point.y };
    } else {
      const tokenId = step.centreId === null ? null : input.tokenOf(step.centreId);
      if (tokenId === null) throw appError("FEATURE_NEEDS_MAP");
      centre = { kind: "token", tokenId };
    }
    out.push(await placeArea(ctx, { ...input, spec, centre }));
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

/** The vision engine's blocking discs of the live sight-blocking areas (Dark Cloud), as map objects that block sight. */
export function sightBlockers(areas: readonly Doc<"combatAreas">[], tokens: readonly Doc<"combatTokens">[]): { kind: string; x: number; y: number; r: number; sight: "block" }[] {
  const out: { kind: string; x: number; y: number; r: number; sight: "block" }[] = [];
  for (const area of areas) {
    if (!area.blocksSight) continue;
    const shape = areaShape(area, tokens);
    if (shape === null || shape.shape !== "circle") continue;
    const disc = sightDisc(shape);
    // prepareMap blocks `r * blockRadiusFactor(kind)` (0.55 for an unknown kind): undo it so the disc is the cloud.
    out.push({ kind: "area", x: disc.x, y: disc.y, r: disc.r / 0.55, sight: "block" });
  }
  return out;
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
  }
  return notes;
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
      const use = cardEffect(cardId)?.uses.find((u) => (u.activation.kind === "reaction" || u.activation.kind === "auto") && u.activation.trigger.kind === "whenEnemyEntersRange" && entersRange(before, after, token, u.activation.trigger.range));
      if (use === undefined) continue;
      await logAction(ctx, { campaignId, characterId: character._id, actorId, kind: "combat", visibility: "public", summary: `${await nameOf()} moves within range of ${sheet.name}: ${use.name}`, groupId, undoable: false });
      out.push({ characterId: character._id, card: use.name });
    }
  }
  return out;
}
