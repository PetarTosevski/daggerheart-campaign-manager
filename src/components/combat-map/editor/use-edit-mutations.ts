"use client";

import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CombatMapLayout } from "../../../../convex/combatMaps";
import {
  isSwitchableLight,
  movePoint,
  objectRadius,
  objectRotation,
  paintLayoutCells,
  PLACEABLE_OBJECTS,
  placePoint,
  type PaintValue,
  type PlaceableKind,
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

/**
 * The editor's mutations, each applied optimistically to the GM's `combatMaps.get` layout so a stroke or an object
 * edit shows at once (the map canvas then repaints only what changed). Failures land in the editor's error line.
 */
export function useEditMutations(campaignId: Id<"campaigns">, mapId: Id<"combatMaps">) {
  const { setError } = useEditor();
  const fail = (e: unknown) => setError(errorMessage(e));

  const paintCells = useMutation(api.combatMapEdit.paintCells).withOptimisticUpdate((store, args) => {
    const layout = store.getQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId });
    if (!layout) return;
    const cells = paintLayoutCells(layout.cells, layout.w, args.squares, args.paint);
    store.setQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId }, { ...layout, cells });
  });
  const clearPaint = useMutation(api.combatMapEdit.clearPaint).withOptimisticUpdate((store, args) => {
    const layout = store.getQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId });
    if (!layout) return;
    store.setQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId }, { ...layout, cells: layout.cells.filter((t) => t.layer !== args.layer) });
  });
  const addObject = useMutation(api.combatMapEdit.addObject).withOptimisticUpdate((store, args) => {
    const layout = store.getQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId });
    if (!layout) return;
    const at = placePoint(args.x, args.y, layout.w, layout.h);
    // A placeholder id until the server's row arrives (never sent back to the server).
    const _id = `optimistic:${layout.objects.length}:${args.x},${args.y}` as Id<"combatMapObjects">;
    const object: LayoutObject = { _id, kind: args.kind, x: at.x, y: at.y, r: PLACEABLE_OBJECTS[args.kind].r, rot: 0 };
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
      ...(args.lit === undefined || !isSwitchableLight(o.kind) ? {} : { lit: args.lit }),
    })),
  );

  const isReal = (objectId: string) => !objectId.startsWith("optimistic:");

  return {
    paint(squares: number[], paint: PaintValue) {
      if (squares.length === 0) return;
      setError(null);
      paintCells({ campaignId, mapId, squares, paint }).catch(fail);
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
