"use client";

import { useQuery } from "convex/react";

import { MAP_LIGHT_REACH } from "@/lib/domain/combat-map/light";
import { SIGHT_DEFAULTS, SIGHT_LABEL, SIGHT_MODES, sightOf, type SightMode } from "@/lib/domain/combat-map/sight";
import type { ObjectKind } from "@/lib/domain/combat-map/spec";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CombatMapLayout } from "../../../../convex/combatMaps";
import type { EditToolsPanelProps } from "../slots";
import {
  BRUSHES,
  isSwitchableLight,
  OBJECT_R_MAX,
  OBJECT_R_MIN,
  OBJECT_R_STEP,
  OBJECT_ROT_STEP,
  objectLabel,
  PAINT_TERRAINS,
  PLACEABLE_KINDS,
  PLACEABLE_OBJECTS,
} from "./edit-model";
import { toolFor, useEditor, type EditTool } from "./editor-state";
import { useEditMutations } from "./use-edit-mutations";

/** The board's tool buttons; an uploaded image has no painted terrain or drawn objects, so it gets the sight tools only. */
const TOOLS: readonly { tool: EditTool; label: string; painted: boolean }[] = [
  { tool: "pan", label: "✋ Move view", painted: false },
  { tool: "terrain", label: "🖌 Terrain", painted: true },
  { tool: "object", label: "🌲 Objects", painted: true },
  { tool: "block", label: "▦ Block sight", painted: false },
  { tool: "erase", label: "⌫ Erase", painted: false },
];

/** GM, left column in Edit (slot `EditToolsPanel`): the board's "Edit by hand" card and the selected object's panel. */
export function EditToolsPanel({ campaignId, map }: EditToolsPanelProps) {
  const layout = useQuery(api.combatMaps.get, { campaignId, mapId: map._id });
  return (
    <section className="cm-card" aria-labelledby="cm-edit-h">
      <h2 id="cm-edit-h" className="cm-h">
        Edit by hand
      </h2>
      {layout === undefined ? (
        <p role="status" className="cm-muted">
          Loading the map…
        </p>
      ) : layout === null ? (
        <p className="cm-muted">This map is gone.</p>
      ) : (
        <EditTools campaignId={campaignId} layout={layout} />
      )}
    </section>
  );
}

function EditTools({ campaignId, layout }: { campaignId: Id<"campaigns">; layout: CombatMapLayout }) {
  const editor = useEditor();
  const edits = useEditMutations(campaignId, layout._id);
  const isImage = layout.source === "image";
  const tools = TOOLS.filter((t) => !isImage || !t.painted);
  const tool = toolFor(editor.tool, isImage);
  const hasPaint = layout.cells.some((t) => t.layer === "terrain");
  const selected = layout.objects.find((o) => o._id === editor.selectedObjectId) ?? null;

  const brushes = (
    <div className="cm-row cm-ed-brushes" role="group" aria-label="Brush size">
      <span className="cm-lbl">Brush</span>
      {BRUSHES.map((n) => (
        <button
          key={n}
          type="button"
          className="cm-btn cm-sm"
          aria-pressed={editor.brush === n}
          aria-label={`Brush ${n} × ${n} squares`}
          onClick={() => editor.setBrush(n)}
        >
          {n}
        </button>
      ))}
      {tool === "terrain" && hasPaint ? (
        <button type="button" className="cm-btn cm-sm cm-ed-push" onClick={() => edits.clearPaint("terrain")}>
          Undo all painting
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="cm-ed">
      <div className="cm-ed-tools" role="group" aria-label="Edit tool">
        {tools.map((t) => (
          <button key={t.tool} type="button" className="cm-btn cm-sm" aria-pressed={tool === t.tool} onClick={() => editor.setTool(t.tool)}>
            {t.label}
          </button>
        ))}
      </div>

      {tool === "terrain" ? (
        <div className="cm-ed-sub">
          <span className="cm-lbl" id="cm-ed-ter">
            Terrain
          </span>
          <div className="cm-ed-terrains" role="group" aria-labelledby="cm-ed-ter">
            {PAINT_TERRAINS.map(({ terrain, swatch }) => (
              <button
                key={terrain}
                type="button"
                className="cm-btn cm-sm cm-ed-terrain"
                aria-pressed={editor.terrain === terrain}
                onClick={() => editor.setTerrain(terrain)}
              >
                <span aria-hidden="true" className="cm-ed-swatch" style={{ background: swatch }} />
                {terrain}
              </button>
            ))}
          </div>
          {brushes}
        </div>
      ) : null}

      {tool === "object" ? (
        <div className="cm-ed-sub">
          <span className="cm-lbl" id="cm-ed-kinds">
            Click the map to place · click an object to select it · drag to move
          </span>
          <div className="cm-ed-kinds" role="group" aria-labelledby="cm-ed-kinds">
            {PLACEABLE_KINDS.map((kind) => (
              <button key={kind} type="button" className="cm-btn cm-sm" aria-pressed={editor.kind === kind} onClick={() => editor.setKind(kind)}>
                {PLACEABLE_OBJECTS[kind].label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {tool === "block" ? (
        <div className="cm-ed-sub">
          <span className="cm-muted">
            Paint squares that block sight (red). Use this for walls drawn on your own image, or anything the painter can’t know about.
          </span>
          {brushes}
        </div>
      ) : null}

      {tool === "erase" ? (
        <div className="cm-ed-sub">
          <span className="cm-muted">Erase painted terrain and sight blockers under the brush.</span>
          {brushes}
        </div>
      ) : null}

      {selected ? <ObjectPanel object={selected} edits={edits} onDone={() => editor.selectObject(null)} /> : null}

      {editor.error ? (
        <p role="alert" className="cm-alert cm-m0">
          {editor.error}
        </p>
      ) : null}
    </div>
  );
}

type LayoutObject = CombatMapLayout["objects"][number];

/** The board's selected-object card: sight setting (R7), light switch (R9), size, turn, Done and Delete. */
function ObjectPanel({ object, edits, onDone }: { object: LayoutObject; edits: ReturnType<typeof useEditMutations>; onDone: () => void }) {
  const label = objectLabel(object.kind);
  const effective = sightOf(object);
  const fallback: SightMode = (SIGHT_DEFAULTS as Readonly<Record<string, SightMode>>)[object.kind as ObjectKind] ?? "none";
  const reach = MAP_LIGHT_REACH[object.kind];
  const lit = object.lit !== false;
  return (
    <div className="cm-ed-obj" role="group" aria-label={`Selected object: ${label}`} data-testid="combat-object-panel">
      <strong className="cm-ed-obj-name">{label}</strong>
      <div className="cm-ed-row" role="group" aria-label="Sight">
        {SIGHT_MODES.map((mode) => (
          <button key={mode} type="button" className="cm-btn cm-sm" aria-pressed={effective === mode} onClick={() => edits.setSight(object._id, mode)}>
            {SIGHT_LABEL[mode]}
          </button>
        ))}
      </div>
      <span className="cm-muted cm-ed-note">
        {object.sight === undefined ? (
          `Default for a ${label.toLowerCase()}: ${SIGHT_LABEL[fallback].toLowerCase()}.`
        ) : (
          <>
            Set by hand (default: {SIGHT_LABEL[fallback].toLowerCase()}).{" "}
            <button type="button" className="cm-linkbtn" onClick={() => edits.setSight(object._id, "default")}>
              Use the default
            </button>
          </>
        )}
      </span>
      {isSwitchableLight(object.kind) && reach ? (
        <>
          <button type="button" className="cm-btn cm-sm cm-ed-start" aria-pressed={lit} onClick={() => edits.update(object._id, { lit: !lit })}>
            🔥 {lit ? "Lit · click to put out" : "Unlit · click to light"}
          </button>
          <span className="cm-muted cm-ed-note">
            At night: clear to {reach[0]} squares, dim to {reach[1]}.
          </span>
        </>
      ) : null}
      <div className="cm-ed-row">
        <button type="button" className="cm-btn cm-sm" disabled={object.r <= OBJECT_R_MIN} onClick={() => edits.update(object._id, { r: object.r - OBJECT_R_STEP })}>
          Smaller
        </button>
        <button type="button" className="cm-btn cm-sm" disabled={object.r >= OBJECT_R_MAX} onClick={() => edits.update(object._id, { r: object.r + OBJECT_R_STEP })}>
          Bigger
        </button>
        <button type="button" className="cm-btn cm-sm" aria-label="Rotate left" onClick={() => edits.update(object._id, { rot: object.rot - OBJECT_ROT_STEP })}>
          ⟲
        </button>
        <button type="button" className="cm-btn cm-sm" aria-label="Rotate right" onClick={() => edits.update(object._id, { rot: object.rot + OBJECT_ROT_STEP })}>
          ⟳
        </button>
      </div>
      <div className="cm-ed-row">
        <button type="button" className="cm-btn cm-sm" onClick={onDone}>
          Done
        </button>
        <button
          type="button"
          className="cm-btn cm-sm cm-danger"
          onClick={() => {
            edits.remove(object._id);
            onDone();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
