"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useRef, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import type { CarriedLight } from "@/lib/domain/combat-map/light";
import { decodeExplored, exploredGrows } from "@/lib/domain/combat-map/vision";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CombatMapLayout } from "../../../../convex/combatMaps";
import { CELL_UNPAINTED } from "../map-view/cells";
import { isEmptyTile, paintTile, squaresByTile } from "../editor/edit-model";
import type { CombatPageState } from "../slots";
import { unionMask, type FogMasks } from "./fog";

/** What `playerView` / `previewAs` return (C7). */
export type ViewState = FunctionReturnType<typeof api.combatVision.playerView>;
export type ViewOk = Extract<ViewState, { state: "ok" }>;
export type OtherToken = ViewOk["others"][number];

/**
 * Whose eyes the map is seen through:
 * - `player`: a player, always their own character (`playerView`, R11);
 * - `preview`: the GM previewing a PC in Play (`previewAs`, R12): exactly what that player gets;
 * - `gm`: the GM's own view of everything (no fog from vision, only the night tint and the fog marks).
 */
export type Viewing =
  | { kind: "player"; view: ViewState | undefined }
  | { kind: "preview"; characterId: Id<"characters">; view: ViewState | undefined }
  | { kind: "gm" };

type ViewArgs = Pick<CombatPageState, "campaignId" | "role" | "mode" | "map" | "previewCharacterId">;

/** The view on screen (see `Viewing`). Convex shares one subscription per query and arguments across the slots. */
export function useViewing({ campaignId, role, mode, map, previewCharacterId }: ViewArgs): Viewing {
  const player = role === "player";
  const previewing = !player && mode === "play" && previewCharacterId !== null && map !== null;
  const playerView = useQuery(api.combatVision.playerView, player && map ? { campaignId } : "skip");
  const preview = useQuery(
    api.combatVision.previewAs,
    previewing ? { campaignId, characterId: previewCharacterId, mapId: map._id } : "skip",
  );
  if (player) return { kind: "player", view: map ? playerView : { state: "noMap" } };
  if (previewing) return { kind: "preview", characterId: previewCharacterId, view: preview };
  return { kind: "gm" };
}

/** A door the viewer may switch (map-movement M2, `combatVision.doors`). */
export type DoorView = NonNullable<FunctionReturnType<typeof api.combatVision.doors>>["doors"][number];

/**
 * The doors the viewer may open and close (D8): the GM every door on the map (Play only), a player the live map's
 * doors one of their characters has seen (the server never sends the others). Empty while loading or editing.
 */
export function useDoors({ campaignId, role, mode, map }: Pick<CombatPageState, "campaignId" | "role" | "mode" | "map">): DoorView[] {
  const gm = role === "gm";
  const result = useQuery(api.combatVision.doors, map === null || (gm && mode !== "play") ? "skip" : gm ? { campaignId, mapId: map._id } : { campaignId });
  if (!result || map === null || result.mapId !== map._id) return [];
  return result.doors;
}

/** "door" for a solid door, "gate" for bars and gates (D7), numbered per kind in reading order: "Door 1", "Gate 2". */
export function doorLabels(doors: readonly DoorView[]): Map<string, string> {
  const sorted = [...doors].sort((a, b) => a.y - b.y || a.x - b.x);
  const count = { door: 0, gate: 0 };
  const out = new Map<string, string>();
  for (const d of sorted) {
    const kind = d.solid ? "door" : "gate";
    count[kind] += 1;
    out.set(d._id, `${kind === "door" ? "Door" : "Gate"} ${count[kind]}`);
  }
  return out;
}

/** The result when it is a character's view, else null. */
export function okView(viewing: Viewing): ViewOk | null {
  return viewing.kind !== "gm" && viewing.view?.state === "ok" ? viewing.view : null;
}

/**
 * The character's stored explored samples (R11), decoded: `mask` null while loading or with nothing stored yet,
 * `loaded` once the query has answered.
 */
export function useStoredExplored(campaignId: Id<"campaigns">, viewing: Viewing): { mask: Uint8Array | null; loaded: boolean } {
  const ok = okView(viewing);
  const row = useQuery(
    api.combatVision.explored,
    ok ? { campaignId, characterId: ok.characterId, ...(viewing.kind === "preview" ? { mapId: ok.mapId } : {}) } : "skip",
  );
  const mask = useMemo(() => {
    if (!ok || !row || row.mapId !== ok.mapId) return null;
    const length = ok.vision.sw * ok.vision.sh;
    return row.length === length ? decodeExplored(row.bits, length) : null;
  }, [ok, row]);
  return { mask, loaded: row !== undefined };
}

/** The fog masks of a character's view: seen, clear and explored (stored or seen now). */
export function useFogMasks(view: ViewOk | null, stored: Uint8Array | null): FogMasks | null {
  return useMemo(() => {
    if (!view) return null;
    const { sw, sh, scale } = view.vision;
    const length = sw * sh;
    const seen = decodeExplored(view.vision.seen, length);
    const clear = decodeExplored(view.vision.clear, length);
    return { sw, sh, scale, seen, clear, explored: unionMask(stored, seen) };
  }, [view, stored]);
}

/** At most one explored-area write per this many milliseconds; the first change of view is sent at once. */
export const EXPLORED_THROTTLE_MS = 500;

type ExploredWrite = { mapId: Id<"combatMaps">; characterId: Id<"characters">; bits: string };

/**
 * Keeps the player's explored area on the server (R11) without a write per render:
 * - the need is derived from data during render: `exploredGrows(stored, seen)` is true only when the character
 *   sees a sample the stored row lacks;
 * - the effect runs only when that answer or the seen mask itself changes (its dependencies are the boolean and
 *   the encoded mask, never a fresh object), and returns at once when nothing grows;
 * - the write goes out at once when none was sent in the last EXPLORED_THROTTLE_MS and none is in flight; otherwise
 *   one write is scheduled, and it sends the newest mask when it fires. A change of view never cancels it: the
 *   server keeps only what the character sees when the write arrives, so a cancelled write lost a view that lasted
 *   less than the wait (dcm-bxp.55: a campfire lit and put out quickly);
 * - after a write the stored row updates reactively, `grows` turns false and nothing more is sent. A failed or
 *   refused write (`grew: false`) does not retry for the same mask, because the dependencies did not change.
 * Only the player's own client writes; the GM's preview never marks a character's explored area.
 */
export function useExploredSync(campaignId: Id<"campaigns">, viewing: Viewing, masks: FogMasks | null, stored: Uint8Array | null, storedLoaded: boolean) {
  const markExplored = useMutation(api.combatVision.markExplored);
  const last = useRef(0);
  const latest = useRef<ExploredWrite | null>(null);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const ok = viewing.kind === "player" ? okView(viewing) : null;
  const grows = ok !== null && masks !== null && storedLoaded && exploredGrows(stored ?? new Uint8Array(0), masks.seen);
  const bits = ok?.vision.seen ?? null;
  const mapId = ok?.mapId ?? null;
  const characterId = ok?.characterId ?? null;

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!grows || bits === null || mapId === null || characterId === null) return;
    latest.current = { mapId, characterId, bits };
    if (timer.current !== null) return; // the scheduled write will send this newer mask
    const send = () => {
      timer.current = null;
      const write = latest.current;
      if (write === null) return;
      latest.current = null;
      inFlight.current = true;
      last.current = Date.now();
      markExplored({ campaignId, ...write })
        .catch(() => {
          // The next change of view tries again; explored areas are a convenience, never an error card.
        })
        .finally(() => {
          inFlight.current = false;
          // A view that changed while this write was out is sent next, after the throttle.
          if (latest.current !== null && timer.current === null) timer.current = window.setTimeout(send, EXPLORED_THROTTLE_MS);
        });
    };
    if (inFlight.current) return; // sent when the write in flight settles
    const wait = last.current + EXPLORED_THROTTLE_MS - Date.now();
    if (wait <= 0) send();
    else timer.current = window.setTimeout(send, wait);
  }, [grows, bits, mapId, characterId, campaignId, markExplored]);
}

// ---------------------------------------------------------------- writes, with optimistic updates (CL4)

type LayoutObject = CombatMapLayout["objects"][number];

/** Rewrites the object in every cached layout (the GM's `get` and the players' `live`). */
function patchObject(store: OptimisticLocalStore, objectId: string, change: (o: LayoutObject) => LayoutObject) {
  for (const query of [api.combatMaps.get, api.combatMaps.live] as const) {
    for (const { args, value } of store.getAllQueries(query)) {
      if (!value || !value.objects.some((o) => o._id === objectId)) continue;
      store.setQuery(query, args, { ...value, objects: value.objects.map((o) => (o._id === objectId ? change(o) : o)) });
    }
  }
}

/** Sets a door's open state in every cached door list and layout (map-movement M2; closed = no `open` field). */
function patchDoor(store: OptimisticLocalStore, objectId: string, open: boolean) {
  patchObject(store, objectId, ({ open: _was, ...o }) => {
    void _was;
    return open ? { ...o, open: true } : o;
  });
  for (const { args, value } of store.getAllQueries(api.combatVision.doors)) {
    if (!value || !value.doors.some((d) => d._id === objectId)) continue;
    store.setQuery(api.combatVision.doors, args, { ...value, doors: value.doors.map((d) => (d._id === objectId ? { ...d, open } : d)) });
  }
}

/** Sets a token's carried light in every cached token list and character view. */
function patchLight(store: OptimisticLocalStore, tokenId: string, light: CarriedLight) {
  for (const query of [api.combatTokens.list, api.combatTokens.party] as const) {
    for (const { args, value } of store.getAllQueries(query)) {
      if (!value || !value.some((t) => t._id === tokenId)) continue;
      store.setQuery(query, args, value.map((t) => (t._id === tokenId ? { ...t, light } : t)));
    }
  }
  for (const query of [api.combatVision.playerView, api.combatVision.previewAs] as const) {
    for (const { args, value } of store.getAllQueries(query)) {
      if (value?.state !== "ok" || !value.pcs.some((t) => t._id === tokenId)) continue;
      store.setQuery(query, args, { ...value, pcs: value.pcs.map((t) => (t._id === tokenId ? { ...t, light } : t)) });
    }
  }
}

/** Adds or removes a character in a token's `revealedTo` (the GM's list). */
function patchReveal(store: OptimisticLocalStore, tokenId: string, characterId: Id<"characters">, on: boolean) {
  for (const { args, value } of store.getAllQueries(api.combatTokens.list)) {
    if (!value || !value.some((t) => t._id === tokenId)) continue;
    store.setQuery(
      api.combatTokens.list,
      args,
      value.map((t) => {
        if (t._id !== tokenId) return t;
        const rest = (t.revealedTo ?? []).filter((c) => c !== characterId);
        return { ...t, revealedTo: on ? [...rest, characterId] : rest };
      }),
    );
  }
}

export type FogMark = "reveal" | "hide" | "erase";

/** The fog layer's code for a mark (C0's encoding, mirrored in C3's cells.ts). */
const FOG_CODE: Record<FogMark, string> = { reveal: "r", hide: "h", erase: CELL_UNPAINTED };

/** The optimistic copy of `paintFog`: the touched fog tiles rewritten, emptied ones dropped. */
export function paintFogCells(tiles: CombatMapLayout["cells"], w: number, squares: readonly number[], mark: FogMark): CombatMapLayout["cells"] {
  const code = FOG_CODE[mark];
  let out = [...tiles];
  for (const [tile, positions] of squaresByTile([...new Set(squares)], w)) {
    const i = out.findIndex((t) => t.layer === "fog" && t.tile === tile);
    const before = i >= 0 ? out[i]!.cells : null;
    if (before === null && code === CELL_UNPAINTED) continue;
    const after = paintTile(before, w, positions, code);
    if (isEmptyTile(after)) out = out.filter((_, j) => j !== i);
    else if (i >= 0) out = out.map((t, j) => (j === i ? { ...t, cells: after } : t));
    else out.push({ layer: "fog", tile, cells: after });
  }
  return out;
}

/**
 * Every vision write: map lights (GM and players, R9), doors (map-movement M2, D8), carried lights (Q3), reveals (R10),
 * the GM's fog brush (R12) and "Forget explored" (dcm-bxp.52), each with an optimistic update so a click shows at once. A failure lands in `error`.
 */
export function useVisionActions(campaignId: Id<"campaigns">) {
  const [error, setError] = useState<string | null>(null);
  const toggleLight = useMutation(api.combatVision.toggleLight).withOptimisticUpdate((store, { objectId, lit }) =>
    patchObject(store, objectId, (o) => ({ ...o, lit })),
  );
  const toggleDoor = useMutation(api.combatVision.toggleDoor).withOptimisticUpdate((store, { objectId, open }) => patchDoor(store, objectId, open));
  const setCarriedLight = useMutation(api.combatVision.setCarriedLight).withOptimisticUpdate((store, { tokenId, light }) =>
    patchLight(store, tokenId, light),
  );
  const revealTo = useMutation(api.combatVision.revealTo).withOptimisticUpdate((store, { tokenId, characterId }) =>
    patchReveal(store, tokenId, characterId as Id<"characters">, true),
  );
  const unrevealTo = useMutation(api.combatVision.unrevealTo).withOptimisticUpdate((store, { tokenId, characterId }) =>
    patchReveal(store, tokenId, characterId as Id<"characters">, false),
  );
  const paintFog = useMutation(api.combatVision.paintFog).withOptimisticUpdate((store, { mapId, squares, mark }) => {
    for (const { args, value } of store.getAllQueries(api.combatMaps.get)) {
      if (!value || value._id !== mapId) continue;
      store.setQuery(api.combatMaps.get, args, { ...value, cells: paintFogCells(value.cells, value.w, squares, mark) });
    }
  });

  const forgetExplored = useMutation(api.combatVision.forgetExplored).withOptimisticUpdate((store, { mapId, characterId }) => {
    for (const { args, value } of store.getAllQueries(api.combatVision.explored)) {
      if (!value || value.mapId !== mapId || (characterId !== undefined && value.characterId !== characterId)) continue;
      store.setQuery(api.combatVision.explored, args, { ...value, bits: "" });
    }
  });

  async function run(call: () => Promise<unknown>) {
    setError(null);
    try {
      await call();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return {
    error,
    clearError: () => setError(null),
    /**
     * GM: forgets every character's explored area on the map (dcm-bxp.52), batch by batch until none is left; the
     * cached explored rows empty at once.
     */
    forgetExplored: (mapId: Id<"combatMaps">) =>
      run(async () => {
        let more = true;
        while (more) ({ more } = await forgetExplored({ campaignId, mapId }));
      }),
    /** Lights or puts out a campfire / wall torch: `lit` is the wanted state (C7). */
    setLit: (objectId: Id<"combatMapObjects">, lit: boolean) => run(() => toggleLight({ campaignId, objectId, lit })),
    /** Opens or closes a door: `open` is the wanted state (M2). */
    setOpen: (objectId: Id<"combatMapObjects">, open: boolean) => run(() => toggleDoor({ campaignId, objectId, open })),
    setCarriedLight: (tokenId: Id<"combatTokens">, light: CarriedLight) => run(() => setCarriedLight({ campaignId, tokenId, light })),
    reveal: (tokenId: Id<"combatTokens">, characterId: Id<"characters">, on: boolean) =>
      run(() => (on ? revealTo({ campaignId, tokenId, characterId }) : unrevealTo({ campaignId, tokenId, characterId }))),
    paintFog: (mapId: Id<"combatMaps">, squares: number[], mark: FogMark) => run(() => paintFog({ campaignId, mapId, squares, mark })),
  };
}

export type VisionActions = ReturnType<typeof useVisionActions>;
