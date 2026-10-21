/**
 * What a map object does to sight (R7).
 *
 * R7: anything big enough to hide behind blocks sight (walls, trees, tents,
 * boulders, pillars, statues, masts). Bushes, rocks, logs, crates, barrels,
 * chests, tables and rubble are cover only by default; the GM can set any
 * object to block sight. Walls are terrain (see vision.ts), not objects.
 */

import type { ObjectKind } from "./spec";

export type SightMode = "block" | "cover" | "none";

export const SIGHT_MODES: readonly SightMode[] = ["block", "cover", "none"];

/** R7 default per object kind (ported from the board's CMAP.SIGHT). */
export const SIGHT_DEFAULTS: Readonly<Record<ObjectKind, SightMode>> = {
  tree: "block",
  tent: "block",
  boulder: "block",
  pillar: "block",
  statue: "block",
  mast: "block",
  bush: "cover",
  rock: "cover",
  log: "cover",
  crate: "cover",
  barrel: "cover",
  chest: "cover",
  table: "cover",
  rubble: "cover",
  deadtree: "none",
  campfire: "none",
  torch: "none",
  walltorch: "none",
  crystal: "none",
  mushroom: "none",
  bones: "none",
  hull: "none",
  /** A closed solid door blocks sight; an open one has no effect (map-movement M2, D7: `sightOf`). */
  door: "block",
};

/** The board's sight-setting labels. */
export const SIGHT_LABEL: Readonly<Record<SightMode, string>> = {
  block: "Blocks sight",
  cover: "Cover only",
  none: "No effect",
};

export type SightSubject = {
  readonly kind: string;
  /** GM override; unset (or null) = the traits' sight, else the R7 default for the kind. */
  readonly sight?: SightMode | null;
  /** Sprite traits (sprite-packs P3, D3); absent on Classic objects. */
  readonly traits?: { readonly sight?: SightMode | null } | null;
  /** Doors only (map-movement M2): true = open. Only doors carry it (combatVision.toggleDoor writes it). */
  readonly open?: boolean | null;
};

/**
 * The object's effective sight mode (D3): an open door has none (map-movement M2, D7); else the override, else the
 * sprite's traits, else the R7 default. A closed door keeps its own mode: a solid door (Classic `door`, the wooden
 * door sprite) blocks, bars and gates (portcullis, crypt gate, iron gate, wooden gates) stay cover.
 */
export function sightOf(object: SightSubject): SightMode {
  if (object.open === true) return "none";
  if (object.sight) return object.sight;
  if (object.traits?.sight) return object.traits.sight;
  return (SIGHT_DEFAULTS as Readonly<Record<string, SightMode>>)[object.kind] ?? "none";
}

export function blocksSight(object: SightSubject): boolean {
  return sightOf(object) === "block";
}

/**
 * Fraction of an object's radius that blocks sight (the board's footprint:
 * a tree's canopy and a tent fill most of their circle, other kinds about half).
 */
export function blockRadiusFactor(kind: string): number {
  if (kind === "tree") return 0.8;
  if (kind === "tent") return 0.75;
  return 0.55;
}
