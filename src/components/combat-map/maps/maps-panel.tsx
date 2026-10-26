"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { CombatMapListRow } from "../../../../convex/combatMaps";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { MapsPanelProps } from "../slots";
import { MapImageButton } from "./image-upload";
import { MapThumbnail } from "./thumbnail";

/** The board's size presets (convex/lib/combatMaps.ts MAP_SIZES). */
const SIZES = [
  { key: "small", label: "Small", w: 22, h: 15 },
  { key: "medium", label: "Medium", w: 30, h: 20 },
  { key: "large", label: "Large", w: 40, h: 27 },
] as const;

const SOURCE_LABEL: Record<CombatMapListRow["source"], string> = { blank: "Blank", generated: "Generated", image: "Image" };

/** How long a first "Delete" click waits for the confirming second click (the board: 3 s). */
const CONFIRM_MS = 3000;

/** GM, left column (slot `MapsPanel`): the campaign's maps (R2): new, open, set live, rename, duplicate, delete, image. */
export function MapsPanel({ campaignId, selectedMapId, onSelectMap }: MapsPanelProps) {
  const maps = useQuery(api.combatMaps.list, { campaignId });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useIntent(api.combatMaps.create);

  const current = maps ? pickMap(maps, selectedMapId) : null;

  async function createBlank(size: (typeof SIZES)[number]["key"]) {
    const result = await create.fire({ campaignId, size });
    if (result) {
      setAdding(false);
      onSelectMap(result.mapId);
    }
  }

  return (
    <section className="cm-card" aria-labelledby="cm-maps-h">
      <div className="cm-row cm-between">
        <h2 id="cm-maps-h" className="cm-h">
          Maps
        </h2>
        <button type="button" className="cm-btn cm-sm" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          ＋ New map
        </button>
      </div>
      {adding ? (
        <div className="cm-newmap" role="group" aria-label="New map">
          <span className="cm-lbl">Blank map</span>
          <div className="cm-row">
            {SIZES.map((s) => (
              <button key={s.key} type="button" className="cm-btn cm-sm" disabled={create.pending} onClick={() => void createBlank(s.key)}>
                {s.label} {s.w}×{s.h}
              </button>
            ))}
          </div>
          <MapImageButton
            campaignId={campaignId}
            label="🖼 From my own map image"
            className="cm-btn cm-sm"
            onDone={(id) => {
              setAdding(false);
              onSelectMap(id);
            }}
          />
          {create.error ? (
            <p role="alert" className="cm-err cm-m0">
              {create.error}
            </p>
          ) : null}
        </div>
      ) : null}
      {maps === undefined ? (
        <p role="status" className="cm-muted cm-m0">
          Loading maps…
        </p>
      ) : maps.length === 0 ? (
        <p className="cm-muted cm-m0">No maps yet. Describe a scene below to draw your first one.</p>
      ) : (
        <ul className="cm-maplist" aria-label="Campaign maps">
          {maps.map((m) => (
            <MapRow
              key={m._id}
              campaignId={campaignId}
              map={m}
              current={current?._id === m._id}
              onOpen={() => onSelectMap(m._id)}
              onDeleted={() => {
                if (selectedMapId === m._id) onSelectMap(null);
              }}
              onError={setError}
            />
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="cm-err cm-m0">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The map on screen for the GM: the picked one, else the live one, else the newest (`CombatPageState.map`). */
export function pickMap(maps: readonly CombatMapListRow[], selectedMapId: Id<"combatMaps"> | null): CombatMapListRow | null {
  const picked = selectedMapId === null ? undefined : maps.find((m) => m._id === selectedMapId);
  if (picked) return picked;
  const live = maps.find((m) => m.live);
  if (live) return live;
  let newest: CombatMapListRow | null = null;
  for (const m of maps) if (newest === null || m._creationTime > newest._creationTime) newest = m;
  return newest;
}

function MapRow({
  campaignId,
  map,
  current,
  onOpen,
  onDeleted,
  onError,
}: {
  campaignId: Id<"campaigns">;
  map: CombatMapListRow;
  current: boolean;
  onOpen: () => void;
  onDeleted: () => void;
  onError: (message: string | null) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const listArgs = { campaignId };
  const setLive = useMutation(api.combatMaps.setLive).withOptimisticUpdate((store, { mapId }) => {
    const list = store.getQuery(api.combatMaps.list, listArgs);
    if (list) store.setQuery(api.combatMaps.list, listArgs, list.map((m) => ({ ...m, live: m._id === mapId })));
  });
  const rename = useMutation(api.combatMaps.rename).withOptimisticUpdate((store, { mapId, name }) => {
    const list = store.getQuery(api.combatMaps.list, listArgs);
    const trimmed = name.trim();
    if (list && trimmed) store.setQuery(api.combatMaps.list, listArgs, list.map((m) => (m._id === mapId ? { ...m, name: trimmed } : m)));
  });
  const remove = useMutation(api.combatMaps.remove).withOptimisticUpdate((store, { mapId }) => {
    const list = store.getQuery(api.combatMaps.list, listArgs);
    if (!list) return;
    const rest = list.filter((m) => m._id !== mapId);
    const gone = list.find((m) => m._id === mapId);
    // The server makes the oldest remaining map live when the live one goes.
    store.setQuery(api.combatMaps.list, listArgs, gone?.live && rest[0] ? rest.map((m, i) => (i === 0 ? { ...m, live: true } : m)) : rest);
  });
  const duplicate = useIntent(api.combatMaps.duplicate);
  // Focuses the name field the Rename button opened (a ref, not a timer: CL14).
  const focusOnMount = useCallback((el: HTMLInputElement | null) => el?.select(), []);

  function run(p: Promise<unknown>) {
    onError(null);
    p.catch((e: unknown) => onError(errorMessage(e)));
  }

  function commitRename() {
    if (renaming === null) return;
    const name = renaming.trim();
    setRenaming(null);
    if (name && name !== map.name) run(rename({ campaignId, mapId: map._id, name }));
  }

  function clickDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirmDelete(false), CONFIRM_MS);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setConfirmDelete(false);
    onDeleted();
    run(remove({ campaignId, mapId: map._id }));
  }

  return (
    <li className={`cm-maprow${current ? " cm-maprow-on" : ""}`} aria-current={current ? "true" : undefined}>
      <MapThumbnail map={map} />
      <div className="cm-maprow-body">
        {renaming === null ? (
          <button type="button" className="cm-maprow-name" onClick={onOpen} title={`Show ${map.name}`}>
            {map.name}
          </button>
        ) : (
          <input
            className="cm-in cm-maprow-in"
            type="text"
            aria-label="Map name"
            maxLength={80}
            value={renaming}
            ref={focusOnMount}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(null);
            }}
          />
        )}
        <span className="cm-maprow-meta">
          {map.live ? <span className="cm-live">LIVE</span> : null}
          {map.w} × {map.h} · {SOURCE_LABEL[map.source]}
        </span>
        <span className="cm-maprow-actions">
          <button type="button" className="cm-btn cm-sm" disabled={map.live} onClick={() => run(setLive({ campaignId, mapId: map._id }))}>
            Set live
          </button>
          <button type="button" className="cm-btn cm-sm" onClick={() => setRenaming(map.name)}>
            Rename
          </button>
          <button
            type="button"
            className="cm-btn cm-sm"
            disabled={duplicate.pending}
            onClick={() => void duplicate.fire({ campaignId, mapId: map._id })}
          >
            Duplicate
          </button>
          <MapImageButton campaignId={campaignId} mapId={map._id} label="Image" className="cm-btn cm-sm" onDone={onOpen} />
          <button type="button" className="cm-btn cm-sm cm-danger" onClick={clickDelete}>
            {confirmDelete ? "Confirm delete" : "Delete"}
          </button>
        </span>
        {duplicate.error ? (
          <span role="alert" className="cm-err">
            {duplicate.error}
          </span>
        ) : null}
      </div>
    </li>
  );
}
