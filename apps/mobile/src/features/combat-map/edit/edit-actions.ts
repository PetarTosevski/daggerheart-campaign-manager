import type { OptimisticLocalStore } from "convex/browser";
import { useAction, useMutation, type ReactMutation } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import {
  PLACEABLE_OBJECTS,
  builtinPlacement,
  builtinTextureTerrain,
  paintLayoutCells,
  paintLayoutTextures,
  paletteSlot,
  placePoint,
  type PaintValue,
  type PlaceableKind,
  type SpritePlacement,
  strokeLayers,
  uploadedPlacement,
  usedTextureCodes,
  textureCode,
} from "../../../../../../src/components/combat-map/editor/edit-model";
import { errorMessage } from "../../../../../../src/lib/convex-errors";
import type { SpriteRef } from "../../../../../../convex/lib/validators/combatMaps";

import { api } from "../../../convex";
import type { Id } from "../../../convex";
import type { CombatMapLayout } from "../contract";

function withOptimistic<M extends FunctionReference<"mutation">>(
  mutation: ReactMutation<M>,
  update: (store: OptimisticLocalStore, args: FunctionArgs<M>) => void,
): ReactMutation<M> {
  if (!("withOptimisticUpdate" in mutation)) return mutation;
  return mutation.withOptimisticUpdate(update);
}

type LayoutObject = CombatMapLayout["objects"][number];

function patchLayoutQueries(store: OptimisticLocalStore, campaignId: Id<"campaigns">, mapId: string, next: CombatMapLayout) {
  const liveKey = { campaignId };
  const live = store.getQuery(api.combatMaps.live, liveKey);
  if (live && live._id === mapId) store.setQuery(api.combatMaps.live, liveKey, next);
  const getKey = { campaignId, mapId: mapId as Id<"combatMaps"> };
  const detail = store.getQuery(api.combatMaps.get, getKey);
  if (detail) store.setQuery(api.combatMaps.get, getKey, next);
}

function updateObjectInLayouts(
  store: OptimisticLocalStore,
  campaignId: Id<"campaigns">,
  objectId: string,
  update: (o: LayoutObject, layout: CombatMapLayout) => LayoutObject | null,
) {
  for (const { value } of store.getAllQueries(api.combatMaps.get)) {
    if (!value || !value.objects.some((o) => o._id === objectId)) continue;
    const objects: LayoutObject[] = [];
    for (const o of value.objects) {
      if (o._id !== objectId) objects.push(o);
      else {
        const row = update(o, value);
        if (row !== null) objects.push(row);
      }
    }
    patchLayoutQueries(store, campaignId, value._id, { ...value, objects });
  }
  const live = store.getQuery(api.combatMaps.live, { campaignId });
  if (live && live.objects.some((o) => o._id === objectId)) {
    const objects: LayoutObject[] = [];
    for (const o of live.objects) {
      if (o._id !== objectId) objects.push(o);
      else {
        const row = update(o, live);
        if (row !== null) objects.push(row);
      }
    }
    patchLayoutQueries(store, campaignId, live._id, { ...live, objects });
  }
}

function uploadedRows(store: OptimisticLocalStore, campaignId: Id<"campaigns">, mapId: string) {
  const sources = store.getQuery(api.combatMapStyle.spriteSources, { campaignId, mapId: mapId as Id<"combatMaps"> });
  return sources?.view === "gm" ? sources.sprites : [];
}

function placementOf(store: OptimisticLocalStore, campaignId: Id<"campaigns">, mapId: string, ref: SpriteRef): SpritePlacement | null {
  if ("builtin" in ref) return builtinPlacement(ref.builtin);
  const row = uploadedRows(store, campaignId, mapId).find((r) => r._id === ref.uploaded);
  return row && row.category === "object" ? uploadedPlacement(row) : null;
}

/** GM combat map edit mutations (same surface as the website editor). */
export function useEditActions(campaignId: Id<"campaigns">, layout: CombatMapLayout, setError: (message: string | null) => void) {
  const mapId = layout._id;
  const fail = (e: unknown) => setError(errorMessage(e));
  const run = (p: unknown) => {
    void Promise.resolve(p).catch(fail);
  };

  const paintCells = withOptimistic(useMutation(api.combatMapEdit.paintCells), (store, args) => {
    const key = { campaignId: args.campaignId, mapId: args.mapId };
    const current = store.getQuery(api.combatMaps.get, key) ?? store.getQuery(api.combatMaps.live, { campaignId: args.campaignId });
    if (!current || current._id !== args.mapId) return;
    const paint = args.paint;
    if (typeof paint === "string") {
      const cells = paintLayoutCells(current.cells, current.w, args.squares, paint);
      const clearsTexture = strokeLayers(paint).some((l) => l.layer === "texture");
      const textureCells =
        clearsTexture && current.textureCells
          ? paintLayoutTextures(current.textureCells, current.w, args.squares, ".")
          : current.textureCells;
      patchLayoutQueries(store, args.campaignId, current._id, {
        ...current,
        cells,
        ...(textureCells === undefined ? {} : { textureCells }),
      });
      return;
    }
    const ref = paint.texture;
    const terrain =
      "builtin" in ref
        ? builtinTextureTerrain(ref.builtin)
        : (uploadedRows(store, args.campaignId, args.mapId).find((r) => r._id === ref.uploaded)?.terrain ?? null);
    const slot = paletteSlot(current.texturePalette ?? [], ref, usedTextureCodes(current.textureCells ?? []));
    if (terrain === null || slot === null) return;
    patchLayoutQueries(store, args.campaignId, current._id, {
      ...current,
      cells: paintLayoutCells(current.cells, current.w, args.squares, terrain),
      textureCells: paintLayoutTextures(current.textureCells ?? [], current.w, args.squares, textureCode(slot.index)),
      texturePalette: slot.palette,
    });
  });

  const clearPaint = withOptimistic(useMutation(api.combatMapEdit.clearPaint), (store, args) => {
    const key = { campaignId: args.campaignId, mapId: args.mapId };
    const current = store.getQuery(api.combatMaps.get, key) ?? store.getQuery(api.combatMaps.live, { campaignId: args.campaignId });
    if (!current) return;
    const cells = current.cells.filter((t) => t.layer !== args.layer);
    if (args.layer !== "terrain") {
      patchLayoutQueries(store, args.campaignId, current._id, { ...current, cells });
      return;
    }
    const { textureCells, texturePalette, ...rest } = current;
    void textureCells;
    void texturePalette;
    patchLayoutQueries(store, args.campaignId, current._id, { ...rest, cells });
  });

  const addObject = withOptimistic(useMutation(api.combatMapEdit.addObject), (store, args) => {
    const current = store.getQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId });
    if (!current) return;
    const placement: SpritePlacement | null = args.sprite
      ? placementOf(store, args.campaignId, args.mapId, args.sprite)
      : args.kind
        ? { kind: args.kind, r: PLACEABLE_OBJECTS[args.kind].r }
        : null;
    if (placement === null) return;
    const at = placePoint(args.x, args.y, current.w, current.h);
    const _id = `optimistic:${current.objects.length}:${args.x},${args.y}` as Id<"combatMapObjects">;
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
    patchLayoutQueries(store, args.campaignId, current._id, { ...current, objects: [...current.objects, object] });
  });

  const moveObject = withOptimistic(useMutation(api.combatMapEdit.moveObject), (store, args) =>
    updateObjectInLayouts(store, args.campaignId, args.objectId, (o, map) => ({
      ...o,
      x: Math.max(0, Math.min(map.w, args.x)),
      y: Math.max(0, Math.min(map.h, args.y)),
    })),
  );

  const removeObject = withOptimistic(useMutation(api.combatMapEdit.removeObject), (store, args) =>
    updateObjectInLayouts(store, args.campaignId, args.objectId, () => null),
  );

  const setObjectSight = withOptimistic(useMutation(api.combatMapEdit.setObjectSight), (store, args) =>
    updateObjectInLayouts(store, args.campaignId, args.objectId, (o) => {
      const { sight, ...rest } = o;
      void sight;
      return args.sight === "default" ? rest : { ...rest, sight: args.sight };
    }),
  );

  const updateObject = withOptimistic(useMutation(api.combatMapEdit.updateObject), (store, args) =>
    updateObjectInLayouts(store, args.campaignId, args.objectId, (o) => ({
      ...o,
      ...(args.r === undefined ? {} : { r: args.r }),
      ...(args.rot === undefined ? {} : { rot: args.rot }),
      ...(args.lit === undefined ? {} : { lit: args.lit }),
    })),
  );

  const setStyleMut = withOptimistic(useMutation(api.combatMapStyle.setStyle), (store, args) => {
    const getKey = { campaignId: args.campaignId, mapId: args.mapId };
    const current = store.getQuery(api.combatMaps.get, getKey) ?? store.getQuery(api.combatMaps.live, { campaignId: args.campaignId });
    if (current && current._id === args.mapId) patchLayoutQueries(store, args.campaignId, current._id, { ...current, style: args.style });
  });

  const setSettingMut = withOptimistic(useMutation(api.combatMapStyle.setSetting), (store, args) => {
    const getKey = { campaignId: args.campaignId, mapId: args.mapId };
    const current = store.getQuery(api.combatMaps.get, getKey) ?? store.getQuery(api.combatMaps.live, { campaignId: args.campaignId });
    if (!current) return;
    patchLayoutQueries(store, args.campaignId, current._id, {
      ...current,
      ...(args.setting === null ? {} : { setting: args.setting }),
      settingPicked: args.setting !== null,
    });
  });

  const generateAction = useAction(api.combatMapGenerate.generate);
  const stopGenerate = useMutation(api.combatMapGenerate.stop);

  const isReal = (objectId: string) => !objectId.startsWith("optimistic:");

  return {
    paint(squares: number[], paint: PaintValue | { layer: "texture"; texture: SpriteRef }) {
      if (squares.length === 0) return;
      setError(null);
      if (typeof paint === "object") {
        run(paintCells({ campaignId, mapId, squares, paint }));
        return;
      }
      run(paintCells({ campaignId, mapId, squares, paint }));
    },
    clearPaint(layer: "terrain" | "block") {
      setError(null);
      run(clearPaint({ campaignId, mapId, layer }));
    },
    async add(kind: PlaceableKind, x: number, y: number) {
      setError(null);
      try {
        return (await addObject({ campaignId, mapId, kind, x, y })).objectId;
      } catch (e) {
        fail(e);
        return null;
      }
    },
    async addSprite(sprite: SpriteRef, x: number, y: number) {
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
      run(moveObject({ campaignId, objectId: objectId as Id<"combatMapObjects">, x, y }));
    },
    remove(objectId: string) {
      if (!isReal(objectId)) return;
      setError(null);
      run(removeObject({ campaignId, objectId: objectId as Id<"combatMapObjects"> }));
    },
    setSight(objectId: string, sight: "block" | "cover" | "none" | "default") {
      if (!isReal(objectId)) return;
      setError(null);
      run(setObjectSight({ campaignId, objectId: objectId as Id<"combatMapObjects">, sight }));
    },
    update(objectId: string, patch: { r?: number; rot?: number; lit?: boolean }) {
      if (!isReal(objectId)) return;
      setError(null);
      run(updateObject({ campaignId, objectId: objectId as Id<"combatMapObjects">, ...patch }));
    },
    setStyle(style: "classic" | "sprites") {
      setError(null);
      run(setStyleMut({ campaignId, mapId, style }));
    },
    setSetting(setting: { builtin: string } | { pack: Id<"spritePacks"> } | null) {
      setError(null);
      run(setSettingMut({ campaignId, mapId, setting }));
    },
    generate(args: { prompt: string; size: "small" | "medium" | "large"; another?: boolean; setting?: { builtin: string } | { pack: Id<"spritePacks"> } }) {
      setError(null);
      return generateAction({ campaignId, mapId, ...args });
    },
    stopGenerate() {
      setError(null);
      run(stopGenerate({ campaignId, mapId }));
    },
  };
}
