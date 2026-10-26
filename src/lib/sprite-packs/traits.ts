/**
 * Sprite traits for the vision engine and the painter (D3, D5, Q1). A sprite
 * ref is a built-in catalog key or an uploaded spritePackSprites row; unknown
 * or deleted refs resolve to null and the object falls back to its Classic
 * kind (D1, D9).
 *
 * `SpriteTraits` is structurally a superset of P3's VisionTraits
 * ({sight, light, footprint, w, h}); P5 checks the assignability.
 */

import { defaultMove, type MoveTrait } from "../domain/combat-map/movement";
import type { SightMode } from "../domain/combat-map/sight";
import { catalogEntry, type SpriteFootprint, type SpriteHeight, type SpriteLight } from "./catalog";

/** Mirrors convex spriteRefValidator (P0): `{builtin: key}` or `{uploaded: id}`. */
export type SpriteRef = { readonly builtin: string } | { readonly uploaded: string };

export type SpriteTraits = {
  readonly sight: SightMode;
  readonly light: SpriteLight;
  readonly height: SpriteHeight;
  readonly footprint: SpriteFootprint;
  readonly w: number;
  readonly h: number;
};

/** The trait fields of an uploaded row; `classicKind` feeds the movement default (`spriteMove`). */
export type UploadedSpriteTraits = SpriteTraits & { readonly classicKind?: string };

export type TraitsLookup = {
  /** Uploaded rows by id, loaded by the caller (P5's resolveRefs); missing = deleted. */
  readonly uploaded?: (id: string) => UploadedSpriteTraits | null | undefined;
};

function pick(t: SpriteTraits): SpriteTraits {
  return { sight: t.sight, light: t.light, height: t.height, footprint: t.footprint, w: t.w, h: t.h };
}

/** The traits for a sprite ref, or null when the ref does not resolve. */
export function spriteTraits(ref: SpriteRef, lookup: TraitsLookup = {}): SpriteTraits | null {
  if ("builtin" in ref) {
    const entry = catalogEntry(ref.builtin);
    return entry ? pick(entry) : null;
  }
  const row = lookup.uploaded?.(ref.uploaded);
  return row ? pick(row) : null;
}

/**
 * The movement trait of a sprite ref (map-movement M0, D1), or null when the ref does not resolve (the object then
 * moves as its Classic kind). Built-in: the catalog's `move` (explicit or the D1 default). Uploaded: the D1 default
 * from its labels (blocks sight and tall = block, else difficult when its Classic kind is, else open); uploads have
 * no movement label yet.
 * Kept apart from `spriteTraits` so the vision traits stay exactly P3's shape.
 */
export function spriteMove(ref: SpriteRef, lookup: TraitsLookup = {}): MoveTrait | null {
  if ("builtin" in ref) return catalogEntry(ref.builtin)?.move ?? null;
  const row = lookup.uploaded?.(ref.uploaded);
  return row ? defaultMove(row) : null;
}
