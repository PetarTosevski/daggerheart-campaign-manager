"use client";

import "./areas.css";

import { X } from "lucide-react";
import { useMutation } from "convex/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { RADIUS_LABEL, useMapAreas, type AreaView } from "../../map-view/area-overlay";
import { startAreaPick, useAreaPick, type Square } from "../../map-view/area-pick";
import { useTokens } from "../../tokens/use-tokens";
import type { HudPartProps } from "../state";
import { hudButtonClass } from "../ui";
import { AREAS_PANEL_ID, setAreasOpen, useAreasOpen } from "./open";

export { AREAS_PANEL_ID, setAreasOpen, useAreasOpen } from "./open";

/**
 * "Areas on the map" (plan combat-hud H5.3; GMDesktop 'Areas' `.ar`): the GM's area panel at the bottom right, opened by
 * the toolbar's Areas button (hud/scene, through `./open`). Each live area of the map (`combatAreas.list`, as the
 * classic overlay reads it) with its shape, radius, whether it blocks sight and whose it is, a radius picker for circles,
 * Move and Remove; under them "Draw an area" (name, Circle / Wall, radius, whose, Blocks sight, Pick on the map). The
 * logic is the classic `AreaTools`' (map-view/area-overlay.tsx): the same mutations, optimistic resize / remove, and
 * the square pick (`startAreaPick`, whose banner the HUD shows). Not modal: the map stays usable for the pick; Escape
 * and ✕ close it. GM only (the shell mounts it for the GM).
 */

type Radius = AreaView["radius"];
const RADII = Object.keys(RADIUS_LABEL) as Radius[];

/** An area's line under its name: "Circle · radius Close · blocks sight · Vex" / "Wall · Vex". */
export function areaLine(area: Pick<AreaView, "shape" | "radius" | "blocksSight">, owner: string | null): string {
  const parts = area.shape === "wall" ? ["Wall"] : ["Circle", `radius ${RADIUS_LABEL[area.radius]}`];
  if (area.blocksSight) parts.push("blocks sight");
  if (owner) parts.push(owner);
  return parts.join(" · ");
}

/** Picks one square, or two for a wall, then runs `done` (the classic tools' `pickSquares`). */
function pickSquares(mapId: string, prompts: readonly string[], radius: Radius | undefined, done: (squares: Square[]) => Promise<string | null>) {
  const got: Square[] = [];
  const next = (i: number) =>
    startAreaPick({
      prompt: prompts[i] ?? "Pick a square",
      mapId,
      ...(radius !== undefined && radius !== "veryFar" ? { radius } : {}),
      onPick: async (square) => {
        got.push(square);
        if (i + 1 < prompts.length) {
          next(i + 1);
          return null;
        }
        return done(got);
      },
    });
  next(0);
}

/** The GM's Areas panel (GMDesktop 'Areas'). */
export function HudAreas({ state }: HudPartProps): ReactNode {
  const open = useAreasOpen();
  if (!open || state.map === null || state.role !== "gm") return null;
  return <AreasPanel campaignId={state.campaignId} mapId={state.map._id} />;
}

/**
 * Folding (user answer 2026-11-02, dcm-bxp.99.32.28): the panel opens unfolded; once the GM is done with it (a press
 * outside it, or focus leaving it, with no square pick running) it folds to its header bar, so it no longer covers the
 * tokens under it. The
 * header's button unfolds it again; a running square pick keeps it unfolded. Folded, the body stays mounted (hidden),
 * so a half-filled draw form keeps its values.
 */
function AreasPanel({ campaignId, mapId }: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps"> }) {
  const ref = useRef<HTMLElement>(null);
  const bodyId = useId();
  const [unfolded, setUnfolded] = useState(true);
  const picking = useAreaPick().request !== null;
  const shown = unfolded || picking;

  // Focus moves in on open and back to the Areas button on close, unless it already moved elsewhere (DOM focus only).
  useEffect(() => {
    const panel = ref.current;
    panel?.focus();
    return () => {
      const now = document.activeElement;
      const lost = now === null || now === document.body || (panel?.contains(now) ?? true);
      const opener = document.querySelector<HTMLElement>(`[aria-controls="${AREAS_PANEL_ID}"]`);
      if (opener && lost) opener.focus();
    };
  }, []);

  // A press anywhere outside the panel (the map, a token: the map's layers may keep focus where it was) folds it; a
  // running square pick keeps it shown until the pick ends (`shown`). UI state only, no mutation.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (target !== null && ref.current?.contains(target)) return;
      setUnfolded(false);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []);

  return (
    <section
      ref={ref}
      id={AREAS_PANEL_ID}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label="Areas"
      className={cn("hud-areas", !shown && "hud-areas-folded")}
      data-folded={!shown}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setAreasOpen(false);
        }
      }}
      onBlur={(event) => {
        // Done with it: focus went outside the panel (the map, a token, another panel). A running square pick keeps it
        // shown (`shown`) until the pick ends.
        const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (next !== null && event.currentTarget.contains(next)) return;
        setUnfolded(false);
      }}
    >
      <div className="hud-areas-h">
        <h2>
          <button type="button" className="hud-areas-fold" aria-expanded={shown} aria-controls={bodyId} onClick={() => setUnfolded(!shown)}>
            Areas on the map
          </button>
        </h2>
        <button type="button" className="hud-areas-x" aria-label="Close Areas" onClick={() => setAreasOpen(false)}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div id={bodyId} hidden={!shown} className="hud-areas-bw">
        <AreasBody campaignId={campaignId} mapId={mapId} />
      </div>
    </section>
  );
}

function AreasBody({ campaignId, mapId }: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps"> }) {
  const areas = useMapAreas(campaignId, mapId);
  const tokens = useTokens(campaignId, "gm", mapId);
  const ids = { label: useId(), radius: useId(), owner: useId(), sight: useId() };
  const [label, setLabel] = useState("Dark Cloud");
  const [shape, setShape] = useState<"circle" | "wall">("circle");
  const [radius, setRadius] = useState<Radius>("close");
  const [owner, setOwner] = useState("");
  const [sight, setSight] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const draw = useMutation(api.combatAreaEdits.draw);
  const move = useMutation(api.combatAreaEdits.move);
  const resize = useMutation(api.combatAreaEdits.resize).withOptimisticUpdate((store, args) => {
    const list = store.getQuery(api.combatAreas.list, { campaignId, mapId });
    if (list) store.setQuery(api.combatAreas.list, { campaignId, mapId }, list.map((a) => (a._id === args.areaId ? { ...a, radius: args.radius } : a)));
  });
  const remove = useMutation(api.combatAreas.remove).withOptimisticUpdate((store, args) => {
    const list = store.getQuery(api.combatAreas.list, { campaignId, mapId });
    if (list) store.setQuery(api.combatAreas.list, { campaignId, mapId }, list.filter((a) => a._id !== args.areaId));
  });
  const pcs = (tokens ?? []).filter((t) => t.kind === "pc" && t.characterId !== undefined);
  const ownerId = pcs.some((t) => t.characterId === owner) ? owner : (pcs[0]?.characterId ?? "");
  const names = new Map(pcs.map((t) => [t.characterId as string, t.name]));
  const fail = (e: unknown) => setError(errorMessage(e));

  function startDraw() {
    setError(null);
    const name = label.trim() || "Area";
    const prompts = shape === "wall" ? [`Pick the first end of ${name}`, `Pick the second end of ${name}`] : [`Pick the centre of ${name}`];
    pickSquares(mapId, prompts, shape === "circle" ? radius : undefined, async ([at, to]) => {
      if (!at) return null;
      await draw({ campaignId, mapId, characterId: ownerId, label: name, shape, at, ...(to ? { to } : {}), ...(shape === "circle" ? { radius } : {}), blocksSight: sight });
      return `${name} drawn.`;
    });
  }

  function startMove(a: AreaView) {
    setError(null);
    const prompts = a.shape === "wall" ? [`Pick the first end of ${a.label}`, `Pick the second end of ${a.label}`] : [`Pick the new centre of ${a.label}`];
    pickSquares(mapId, prompts, a.shape === "circle" ? a.radius : undefined, async ([at, to]) => {
      if (!at) return null;
      await move({ campaignId, areaId: a._id, at, ...(to ? { to } : {}) });
      return `${a.label} moved.`;
    });
  }

  return (
    <div className="hud-areas-b" data-testid="area-tools">
      {areas === undefined ? (
        <p role="status" className="hud-areas-none">
          Loading the areas…
        </p>
      ) : areas.length === 0 ? (
        <p className="hud-areas-none">No live area on this map.</p>
      ) : (
        <ul className="hud-areas-list">
          {areas.map((a) => (
            <li key={a._id} className="hud-areas-i" data-testid="area-row" data-label={a.label}>
              <span className={cn("hud-areas-sw", a.shape === "wall" && "hud-areas-sw-wall")} aria-hidden="true" />
              <div className="hud-areas-t">
                <b>{a.label}</b>
                <span>{areaLine(a, names.get(a.characterId) ?? null)}</span>
              </div>
              {a.shape === "circle" ? (
                <select
                  className="hud-areas-sel"
                  aria-label={`Radius of ${a.label}`}
                  value={a.radius}
                  onChange={(e) => {
                    setError(null);
                    resize({ campaignId, areaId: a._id, radius: e.target.value as Radius }).catch(fail);
                  }}
                >
                  {RADII.map((r) => (
                    <option key={r} value={r}>
                      {RADIUS_LABEL[r]}
                    </option>
                  ))}
                </select>
              ) : null}
              <button type="button" className={hudButtonClass()} aria-label={`Move ${a.label}`} onClick={() => startMove(a)}>
                Move
              </button>
              <button
                type="button"
                className={hudButtonClass()}
                aria-label={`Remove ${a.label}`}
                onClick={() => {
                  setError(null);
                  remove({ campaignId, areaId: a._id }).catch(fail);
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3>Draw an area</h3>
      <div className="hud-areas-f">
        <label htmlFor={ids.label}>
          Name
          <input id={ids.label} type="text" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <div className="hud-areas-seg" role="group" aria-label="Shape">
          <button type="button" aria-pressed={shape === "circle"} onClick={() => setShape("circle")}>
            Circle
          </button>
          <button type="button" aria-pressed={shape === "wall"} onClick={() => setShape("wall")}>
            Wall
          </button>
        </div>
        {shape === "circle" ? (
          <label htmlFor={ids.radius}>
            Radius
            <select id={ids.radius} value={radius} onChange={(e) => setRadius(e.target.value as Radius)}>
              {RADII.map((r) => (
                <option key={r} value={r}>
                  {RADIUS_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label htmlFor={ids.owner}>
          Belongs to
          <select id={ids.owner} value={ownerId} onChange={(e) => setOwner(e.target.value)} disabled={pcs.length === 0}>
            {pcs.map((t) => (
              <option key={t._id} value={t.characterId}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.sight} className="hud-areas-c">
          <input id={ids.sight} type="checkbox" checked={sight} onChange={(e) => setSight(e.target.checked)} />
          Blocks sight
        </label>
        <button type="button" className={cn(hudButtonClass("primary"), "hud-areas-go")} disabled={ownerId === ""} onClick={startDraw}>
          Pick on the map
        </button>
      </div>
      {pcs.length === 0 && tokens !== undefined ? <p className="hud-areas-none">Add a PC token first: an area belongs to a character.</p> : null}
      {error ? (
        <p role="alert" className="hud-areas-err">
          {error}
        </p>
      ) : null}
    </div>
  );
}
