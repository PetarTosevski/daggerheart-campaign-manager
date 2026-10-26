"use client";

import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";

import { SETTING_LABEL, isSettingId } from "@/lib/sprite-packs/settings";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PackRow, PackSpriteRow, SpritePatch } from "../../../../convex/spritePacks";
import { classicAfterLight } from "./labels";

/**
 * The pack mutations with optimistic updates on `spritePacks.packs` (CL4: the store's rows are copied, never
 * mutated; nothing happens while the query is not loaded). One intent per call (CL3).
 */

type Store = OptimisticLocalStore;

function patchPacks(store: Store, campaignId: Id<"campaigns">, change: (packs: PackRow[]) => PackRow[]) {
  const packs = store.getQuery(api.spritePacks.packs, { campaignId });
  if (packs !== undefined) store.setQuery(api.spritePacks.packs, { campaignId }, change(packs));
}

function patchSprite(packs: PackRow[], spriteId: string, change: (sprite: PackSpriteRow) => PackSpriteRow | null): PackRow[] {
  return packs.map((pack) => {
    if (!pack.sprites.some((s) => s._id === spriteId)) return pack;
    const sprites: PackSpriteRow[] = [];
    for (const sprite of pack.sprites) {
      const next = sprite._id === spriteId ? change(sprite) : sprite;
      if (next !== null) sprites.push(next);
    }
    return { ...pack, sprites };
  });
}

/** The label change as the server applies it (D2: a new light moves the Classic look to one that fits). */
export function applyPatch(sprite: PackSpriteRow, patch: SpritePatch): PackSpriteRow {
  if ("light" in patch) return { ...sprite, light: patch.light, classicKind: classicAfterLight(sprite.classicKind, { ...sprite, light: patch.light }) };
  if ("category" in patch && patch.category === "texture") return { ...sprite, category: "texture", terrain: sprite.terrain ?? "grass", rotatable: sprite.rotatable ?? true };
  if ("name" in patch) return { ...sprite, name: patch.name.trim() };
  return { ...sprite, ...patch };
}

export function usePackMutations(campaignId: Id<"campaigns">) {
  const renamePack = useMutation(api.spritePacks.renamePack).withOptimisticUpdate((store, { packId, name }) => {
    const trimmed = name.trim();
    if (trimmed) patchPacks(store, campaignId, (packs) => packs.map((p) => (p._id === packId ? { ...p, name: trimmed } : p)));
  });
  const setPackExtends = useMutation(api.spritePacks.setPackExtends).withOptimisticUpdate((store, { packId, extends: ext }) => {
    const option = ext !== null && isSettingId(ext) ? { id: ext, label: SETTING_LABEL[ext] } : null;
    patchPacks(store, campaignId, (packs) => packs.map((p) => (p._id === packId ? { ...p, extends: option } : p)));
  });
  const deletePack = useMutation(api.spritePacks.deletePack).withOptimisticUpdate((store, { packId }) => {
    patchPacks(store, campaignId, (packs) => packs.filter((p) => p._id !== packId));
  });
  const updateSprite = useMutation(api.spritePacks.updateSprite).withOptimisticUpdate((store, { spriteId, patch }) => {
    patchPacks(store, campaignId, (packs) => patchSprite(packs, spriteId, (s) => applyPatch(s, patch)));
  });
  const removeSprite = useMutation(api.spritePacks.removeSprite).withOptimisticUpdate((store, { spriteId }) => {
    patchPacks(store, campaignId, (packs) => patchSprite(packs, spriteId, () => null));
  });
  const reorderSprite = useMutation(api.spritePacks.reorderSprite).withOptimisticUpdate((store, { spriteId, direction }) => {
    patchPacks(store, campaignId, (packs) =>
      packs.map((pack) => {
        const at = pack.sprites.findIndex((s) => s._id === spriteId);
        const to = direction === "up" ? at - 1 : at + 1;
        if (at < 0 || to < 0 || to >= pack.sprites.length) return pack;
        const sprites = [...pack.sprites];
        [sprites[at], sprites[to]] = [sprites[to]!, sprites[at]!];
        return { ...pack, sprites };
      }),
    );
  });
  return { renamePack, setPackExtends, deletePack, updateSprite, removeSprite, reorderSprite };
}
