/**
 * Sprite traits for the vision engine and the painter (D3, D5, Q1). A sprite
 * ref is a built-in catalog key or an uploaded spritePackSprites row; unknown
 * or deleted refs resolve to null and the object falls back to its Classic
 * kind (D1, D9).
 *
 * `SpriteTraits` is structurally a superset of P3's VisionTraits
 * ({sight, light, footprint, w, h}); P5 checks the assignability.
 */

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

/** The trait fields of an uploaded spritePackSprites row (extra fields are ignored). */
export type UploadedSpriteTraits = SpriteTraits;

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
