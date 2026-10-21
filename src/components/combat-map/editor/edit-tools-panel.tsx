"use client";

import { useQuery } from "convex/react";
import { useId, useState } from "react";

import { mapLightReach } from "@/lib/domain/combat-map/light";
import { SIGHT_DEFAULTS, SIGHT_LABEL, SIGHT_MODES, sightOf, type SightMode } from "@/lib/domain/combat-map/sight";
import type { ObjectKind } from "@/lib/domain/combat-map/spec";
import type { SpriteRef } from "../../../../convex/lib/validators/combatMaps";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CombatMapLayout } from "../../../../convex/combatMaps";
import type { EditToolsPanelProps } from "../slots";
import {
  BRUSHES,
  OBJECT_R_MAX,
  OBJECT_R_MIN,
  OBJECT_R_STEP,
  OBJECT_ROT_STEP,
  objectLabel,
  PAINT_TERRAINS,
  PLACEABLE_KINDS,
  PLACEABLE_OBJECTS,
  sameRef,
} from "./edit-model";
import { toolFor, useEditor, type EditTool } from "./editor-state";
import { GROUP_LABEL, searchPalette, type ObjectItem, type PaletteGroup, type TextureItem } from "./sprite-palette";
import { useEditMutations } from "./use-edit-mutations";
import { useSpriteEditing, type SpriteEditing } from "./use-sprite-editing";

/** The board's tool buttons; an uploaded image has no painted terrain or drawn objects, so it gets the sight tools only. */
const TOOLS: readonly { tool: EditTool; label: string; painted: boolean }[] = [
  { tool: "pan", label: "✋ Move view", painted: false },
  { tool: "terrain", label: "🖌 Terrain", painted: true },
  { tool: "object", label: "🌲 Objects", painted: true },
  { tool: "block", label: "▦ Block sight", painted: false },
  { tool: "eraseTerrain", label: "⌫ Erase terrain", painted: true },
  { tool: "eraseBlock", label: "⌫ Clear sight", painted: false },
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
  const sprites = useSpriteEditing(campaignId, layout);
  const isImage = layout.source === "image";
  const tools = TOOLS.filter((t) => !isImage || !t.painted);
  const tool = toolFor(editor.tool, isImage);
  const hasPaint = layout.cells.some((t) => t.layer === "terrain") || (layout.textureCells ?? []).length > 0;
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

  const plainTerrains = (labelId: string, pressed: (terrain: string) => boolean) => (
    <div className="cm-ed-terrains" role="group" aria-labelledby={labelId}>
      {PAINT_TERRAINS.map(({ terrain, swatch }) => (
        <button key={terrain} type="button" className="cm-btn cm-sm cm-ed-terrain" aria-pressed={pressed(terrain)} onClick={() => editor.setTerrain(terrain)}>
          <span aria-hidden="true" className="cm-ed-swatch" style={{ background: swatch }} />
          {terrain}
        </button>
      ))}
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

      {tool === "terrain" && sprites.active ? (
        <div className="cm-ed-sub">
          <TexturePicker textures={sprites.palette.textures} picked={editor.texture} onPick={editor.setTexture} />
          <span className="cm-lbl" id="cm-ed-plain">
            Without a texture
          </span>
          {plainTerrains("cm-ed-plain", (terrain) => editor.texture === null && editor.terrain === terrain)}
          {brushes}
        </div>
      ) : tool === "terrain" ? (
        <div className="cm-ed-sub">
          <span className="cm-lbl" id="cm-ed-ter">
            Terrain
          </span>
          {plainTerrains("cm-ed-ter", (terrain) => editor.terrain === terrain)}
          {brushes}
        </div>
      ) : null}

      {tool === "object" && sprites.active ? (
        <SpritePicker objects={sprites.palette.objects} picked={editor.sprite} onPick={editor.setSprite} />
      ) : tool === "object" ? (
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

      {tool === "eraseTerrain" ? (
        <div className="cm-ed-sub">
          <span className="cm-muted">Erase painted terrain under the brush; the map’s own layout shows again.</span>
          {brushes}
        </div>
      ) : null}

      {tool === "eraseBlock" ? (
        <div className="cm-ed-sub">
          <span className="cm-muted">Clear painted sight blockers under the brush.</span>
          {brushes}
        </div>
      ) : null}

      {selected ? <ObjectPanel object={selected} sprites={sprites} edits={edits} onDone={() => editor.selectObject(null)} /> : null}

      {editor.error ? (
        <p role="alert" className="cm-alert cm-m0">
          {editor.error}
        </p>
      ) : null}
    </div>
  );
}

/** A sprite's thumbnail on the checkerboard (sprites have transparent backgrounds). */
function Thumb({ src }: { src: string | null }) {
  if (src === null) return <span aria-hidden="true" className="cm-ed-thumb cm-ed-thumb-missing" />;
  // eslint-disable-next-line @next/next/no-img-element -- a cut sprite (static /sprite-packs file or the GM's upload), drawn at thumbnail size
  return <img className="cm-ed-thumb" src={src} alt="" width={40} height={40} loading="lazy" decoding="async" />;
}

/** Items grouped in palette order (setting, common, uploaded), empty groups left out. */
function grouped<T extends { group: PaletteGroup }>(items: readonly T[]): [PaletteGroup, T[]][] {
  const out: [PaletteGroup, T[]][] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last && last[0] === item.group) last[1].push(item);
    else out.push([item.group, [item]]);
  }
  return out;
}

/**
 * Sprites style (P9): the object sprites of the map's setting, then common, then the campaign's uploaded ones,
 * with thumbnails and a search box. The picked sprite is placed with a click on the map (the first one until the
 * GM picks).
 */
function SpritePicker({ objects, picked, onPick }: { objects: readonly ObjectItem[]; picked: SpriteRef | null; onPick: (ref: SpriteRef) => void }) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const current = picked ?? objects[0]?.ref ?? null;
  const shown = searchPalette(objects, query);
  return (
    <div className="cm-ed-sub">
      <span className="cm-lbl">Click the map to place · click an object to select it · drag to move</span>
      <label className="cm-lbl" htmlFor={searchId}>
        Search sprites
      </label>
      <input id={searchId} className="cm-in" type="search" value={query} placeholder="oak, barrel, torch…" onChange={(e) => setQuery(e.target.value)} />
      {shown.length === 0 ? <p className="cm-muted cm-m0">No sprite matches “{query}”.</p> : null}
      <div className="cm-ed-sprites-scroll">
        {grouped(shown).map(([group, items]) => (
          <div key={group} className="cm-ed-sub" role="group" aria-label={`Sprites · ${GROUP_LABEL[group]}`}>
            <span className="cm-lbl">{GROUP_LABEL[group]}</span>
            <div className="cm-ed-sprites">
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="cm-btn cm-sm cm-ed-sprite"
                  aria-pressed={current !== null && sameRef(current, item.ref)}
                  title={`${item.name} · ${item.w} × ${item.h} squares`}
                  onClick={() => onPick(item.ref)}
                >
                  <Thumb src={item.thumb} />
                  <span className="cm-ed-sprite-name">{item.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sprites style (P9): the terrain textures (setting, common, uploaded); each paints its terrain class too. */
function TexturePicker({ textures, picked, onPick }: { textures: readonly TextureItem[]; picked: SpriteRef | null; onPick: (ref: SpriteRef) => void }) {
  return (
    <>
      {grouped(textures).map(([group, items]) => (
        <div key={group} className="cm-ed-sub" role="group" aria-label={`Textures · ${GROUP_LABEL[group]}`}>
          <span className="cm-lbl">Textures · {GROUP_LABEL[group]}</span>
          <div className="cm-ed-sprites">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className="cm-btn cm-sm cm-ed-sprite"
                aria-pressed={picked !== null && sameRef(picked, item.ref)}
                title={`${item.name} · paints ${item.terrain}`}
                onClick={() => onPick(item.ref)}
              >
                <Thumb src={item.thumb} />
                <span className="cm-ed-sprite-name">{item.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

type LayoutObject = CombatMapLayout["objects"][number];

/**
 * The board's selected-object card: sight setting (R7), light switch (R9), size, turn, Done and Delete. A sprite
 * object shows its sprite's name, and its manifest sight is the "Default" of the sight setting (D3).
 */
function ObjectPanel({
  object,
  sprites,
  edits,
  onDone,
}: {
  object: LayoutObject;
  sprites: SpriteEditing;
  edits: ReturnType<typeof useEditMutations>;
  onDone: () => void;
}) {
  const traits = sprites.traitsOf(object);
  const label = sprites.nameOf(object) ?? objectLabel(object.kind);
  const effective = sightOf({ kind: object.kind, sight: object.sight ?? null, traits, open: object.open ?? null });
  const fallback: SightMode = traits?.sight ?? (SIGHT_DEFAULTS as Readonly<Record<string, SightMode>>)[object.kind as ObjectKind] ?? "none";
  const reach = mapLightReach({ kind: object.kind, traits });
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
      {reach ? (
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
