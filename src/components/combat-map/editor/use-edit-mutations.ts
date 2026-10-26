"use client";

import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";

import { errorMessage } from "@/lib/convex-errors";
import type { SpriteRef } from "../../../../convex/lib/validators/combatMaps";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CombatMapLayout } from "../../../../convex/combatMaps";
import {
  builtinPlacement,
  builtinTextureTerrain,
  movePoint,
  objectRadius,
  objectRotation,
  paintLayoutCells,
  paintLayoutTextures,
  paletteSlot,
  PLACEABLE_OBJECTS,
  placePoint,
  strokeLayers,
  textureCode,
  uploadedPlacement,
  usedTextureCodes,
  type PaintValue,
  type PlaceableKind,
  type SpritePlacement,
} from "./edit-model";
import { useEditor } from "./editor-state";

type LayoutObject = CombatMapLayout["objects"][number];

/** Rewrites, in every cached `combatMaps.get` layout holding the object, that object (or drops it when null). */
function updateObjectInLayouts(store: OptimisticLocalStore, objectId: string, update: (o: LayoutObject, layout: CombatMapLayout) => LayoutObject | null) {
  for (const { args, value } of store.getAllQueries(api.combatMaps.get)) {
    if (!value || !value.objects.some((o) => o._id === objectId)) continue;
    const objects: LayoutObject[] = [];
    for (const o of value.objects) {
      if (o._id !== objectId) objects.push(o);
      else {
        const next = update(o, value);
        if (next !== null) objects.push(next);
      }
    }
    store.setQuery(api.combatMaps.get, args, { ...value, objects });
  }
}

/** The uploaded sprite rows the GM's client holds for a map (P5's `spriteSources`), for optimistic sprite edits. */
function uploadedRows(store: OptimisticLocalStore, campaignId: Id<"campaigns">, mapId: string) {
  const sources = store.getQuery(api.combatMapStyle.spriteSources, { campaignId, mapId });
  return sources?.view === "gm" ? sources.sprites : [];
}

/** The placement of a sprite as the server will store it (P9): from the catalog or the cached uploaded row. */
function placementOf(store: OptimisticLocalStore, campaignId: Id<"campaigns">, mapId: string, ref: SpriteRef): SpritePlacement | null {
  if ("builtin" in ref) return builtinPlacement(ref.builtin);
  const row = uploadedRows(store, campaignId, mapId).find((r) => r._id === ref.uploaded);
  return row && row.category === "object" ? uploadedPlacement(row) : null;
}

/**
 * The editor's mutations, each applied optimistically to the GM's `combatMaps.get` layout so a stroke or an object
 * edit shows at once (the map canvas then repaints only what changed). Failures land in the editor's error line.
 */
export function useEditMutations(campaignId: Id<"campaigns">, mapId: Id<"combatMaps">) {
  const { setError } = useEditor();
  const fail = (e: unknown) => setError(errorMessage(e));

  const paintCells = useMutation(api.combatMapEdit.paintCells).withOptimisticUpdate((store, args) => {
    const key = { campaignId: args.campaignId, mapId: args.mapId };
    const layout = store.getQuery(api.combatMaps.get, key);
    if (!layout) return;
    const paint = args.paint;
    if (typeof paint === "string") {
      const cells = paintLayoutCells(layout.cells, layout.w, args.squares, paint);
      // Painting or erasing terrain clears the texture under the brush (the server's strokeLayers).
      const clearsTexture = strokeLayers(paint).some((l) => l.layer === "texture");
      const textureCells = clearsTexture && layout.textureCells ? paintLayoutTextures(layout.textureCells, layout.w, args.squares, ".") : layout.textureCells;
      store.setQuery(api.combatMaps.get, key, { ...layout, cells, ...(textureCells === undefined ? {} : { textureCells }) });
      return;
    }
    // A texture (P9): its palette slot, the texture layer and its terrain class, as the server stores them.
    const ref = paint.texture;
    const terrain =
      "builtin" in ref ? builtinTextureTerrain(ref.builtin) : (uploadedRows(store, args.campaignId, args.mapId).find((r) => r._id === ref.uploaded)?.terrain ?? null);
    const slot = paletteSlot(layout.texturePalette ?? [], ref, usedTextureCodes(layout.textureCells ?? []));
    if (terrain === null || slot === null) return;
    store.setQuery(api.combatMaps.get, key, {
      ...layout,
      cells: paintLayoutCells(layout.cells, layout.w, args.squares, terrain),
      textureCells: paintLayoutTextures(layout.textureCells ?? [], layout.w, args.squares, textureCode(slot.index)),
      texturePalette: slot.palette,
    });
  });
  const clearPaint = useMutation(api.combatMapEdit.clearPaint).withOptimisticUpdate((store, args) => {
    const key = { campaignId: args.campaignId, mapId: args.mapId };
    const layout = store.getQuery(api.combatMaps.get, key);
    if (!layout) return;
    const cells = layout.cells.filter((t) => t.layer !== args.layer);
    if (args.layer !== "terrain") {
      store.setQuery(api.combatMaps.get, key, { ...layout, cells });
      return;
    }
    // "Undo all painting" also clears the textures and the palette (P9).
    const { textureCells, texturePalette, ...rest } = layout;
    void textureCells;
    void texturePalette;
    store.setQuery(api.combatMaps.get, key, { ...rest, cells });
  });
  const addObject = useMutation(api.combatMapEdit.addObject).withOptimisticUpdate((store, args) => {
    const layout = store.getQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId });
    if (!layout) return;
    const placement: SpritePlacement | null = args.sprite
      ? placementOf(store, args.campaignId, args.mapId, args.sprite)
      : args.kind
        ? { kind: args.kind, r: PLACEABLE_OBJECTS[args.kind].r }
        : null;
    if (placement === null) return;
    const at = placePoint(args.x, args.y, layout.w, layout.h);
    // A placeholder id until the server's row arrives (never sent back to the server).
    const _id = `optimistic:${layout.objects.length}:${args.x},${args.y}` as Id<"combatMapObjects">;
    const object: LayoutObject = {
      _id,
      kind: placement.kind,
      ...(placement.variant === undefined ? {} : { variant: placement.variant }),
      x: at.x,
      y: at.y,
      r: placement.r,
      rot: 0,
      ...(args.sprite ? { sprite: args.sprite } : {}),
    };
    store.setQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId }, { ...layout, objects: [...layout.objects, object] });
  });
  const moveObject = useMutation(api.combatMapEdit.moveObject).withOptimisticUpdate((store, args) =>
    updateObjectInLayouts(store, args.objectId, (o, layout) => ({ ...o, ...movePoint(args.x, args.y, layout.w, layout.h) })),
  );
  const removeObject = useMutation(api.combatMapEdit.removeObject).withOptimisticUpdate((store, args) =>
    updateObjectInLayouts(store, args.objectId, () => null),
  );
  const setObjectSight = useMutation(api.combatMapEdit.setObjectSight).withOptimisticUpdate((store, args) =>
    updateObjectInLayouts(store, args.objectId, (o) => {
      const { sight, ...rest } = o;
      void sight;
      return args.sight === "default" ? rest : { ...rest, sight: args.sight };
    }),
  );
  const updateObject = useMutation(api.combatMapEdit.updateObject).withOptimisticUpdate((store, args) =>
    updateObjectInLayouts(store, args.objectId, (o) => ({
      ...o,
      ...(args.r === undefined ? {} : { r: objectRadius(args.r) }),
      ...(args.rot === undefined ? {} : { rot: objectRotation(args.rot) }),
      // Only the light switch sends `lit`, and the panel offers it for lights only (the server checks the traits).
      ...(args.lit === undefined ? {} : { lit: args.lit }),
    })),
  );

  const isReal = (objectId: string) => !objectId.startsWith("optimistic:");

  return {
    paint(squares: number[], paint: PaintValue) {
      if (squares.length === 0) return;
      setError(null);
      paintCells({ campaignId, mapId, squares, paint }).catch(fail);
    },
    /** One texture stroke (Sprites style, P9). */
    paintTexture(squares: number[], texture: SpriteRef) {
      if (squares.length === 0) return;
      setError(null);
      paintCells({ campaignId, mapId, squares, paint: { layer: "texture", texture } }).catch(fail);
    },
    clearPaint(layer: "terrain" | "block") {
      setError(null);
      clearPaint({ campaignId, mapId, layer }).catch(fail);
    },
    /** Places an object; resolves with its id once stored (null when it failed). */
    async add(kind: PlaceableKind, x: number, y: number): Promise<Id<"combatMapObjects"> | null> {
      setError(null);
      try {
        return (await addObject({ campaignId, mapId, kind, x, y })).objectId;
      } catch (e) {
        fail(e);
        return null;
      }
    },
    /** Places an object sprite (Sprites style, P9); resolves with its id once stored (null when it failed). */
    async addSprite(sprite: SpriteRef, x: number, y: number): Promise<Id<"combatMapObjects"> | null> {
      setError(null);
      try {
        return (await addObject({ campaignId, mapId, sprite, x, y })).objectId;
      } catch (e) {
        fail(e);
        return null;
      }
    },
    move(objectId: string, x: number, y: number) {
      if (!isReal(objectId)) return;
      setError(null);
      moveObject({ campaignId, objectId, x, y }).catch(fail);
    },
    remove(objectId: string) {
      if (!isReal(objectId)) return;
      setError(null);
      removeObject({ campaignId, objectId }).catch(fail);
    },
    setSight(objectId: string, sight: "block" | "cover" | "none" | "default") {
      if (!isReal(objectId)) return;
      setError(null);
      setObjectSight({ campaignId, objectId, sight }).catch(fail);
    },
    update(objectId: string, patch: { r?: number; rot?: number; lit?: boolean }) {
      if (!isReal(objectId)) return;
      setError(null);
      updateObject({ campaignId, objectId, ...patch }).catch(fail);
    },
  };
}
