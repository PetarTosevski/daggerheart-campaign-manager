"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { Terrain } from "@/lib/domain/combat-map/spec";
import type { SpriteRef } from "../../../../convex/lib/validators/combatMaps";

import type { Brush, PlaceableKind } from "./edit-model";

/** The board's edit tools: move the view, paint terrain, place objects, paint sight blockers, erase painted
 * terrain, clear sight blockers (two tools, user 2026-10-20). */
export type EditTool = "pan" | "terrain" | "object" | "block" | "eraseTerrain" | "eraseBlock";

/** Tools that need the painter (terrain, drawn objects): an uploaded image offers the sight tools only. */
const PAINTER_TOOLS: ReadonlySet<EditTool> = new Set<EditTool>(["terrain", "object"]);

/** The tool in effect on a map: a painter tool on an image map falls back to moving the view. */
export function toolFor(tool: EditTool, isImage: boolean): EditTool {
  return isImage && PAINTER_TOOLS.has(tool) ? "pan" : tool;
}

export type EditorState = {
  tool: EditTool;
  terrain: Terrain;
  brush: Brush;
  kind: PlaceableKind;
  /** Sprites style (P9): the object sprite to place; null = the picker's first sprite. */
  sprite: SpriteRef | null;
  /** Sprites style (P9): the texture to paint; null = paint `terrain` (a terrain without a texture). */
  texture: SpriteRef | null;
  /** The object selected on the map (its panel shows), or null. */
  selectedObjectId: string | null;
  /** The last failed edit's message, shown in the Edit tools card. */
  error: string | null;
};

type EditorContextValue = EditorState & {
  setTool: (tool: EditTool) => void;
  setTerrain: (terrain: Terrain) => void;
  setBrush: (brush: Brush) => void;
  setKind: (kind: PlaceableKind) => void;
  setSprite: (sprite: SpriteRef) => void;
  /** Picks a texture to paint, or null to paint the plain `terrain`. */
  setTexture: (texture: SpriteRef | null) => void;
  selectObject: (objectId: string | null) => void;
  setError: (message: string | null) => void;
};

const EditorContext = createContext<EditorContextValue | null>(null);

/** Holds the editor's tool, brush, terrain, object kind and selected object for the panel and the map layer. */
export function EditorStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EditorState>({
    tool: "pan",
    terrain: "stone",
    brush: 1,
    kind: "tree",
    sprite: null,
    texture: null,
    selectedObjectId: null,
    error: null,
  });
  const value = useMemo<EditorContextValue>(
    () => ({
      ...state,
      // Picking a tool drops the object selection (the board).
      setTool: (tool) => setState((s) => ({ ...s, tool, selectedObjectId: null, error: null })),
      // A plain terrain replaces the picked texture (Sprites style).
      setTerrain: (terrain) => setState((s) => ({ ...s, terrain, texture: null })),
      setBrush: (brush) => setState((s) => ({ ...s, brush })),
      setKind: (kind) => setState((s) => ({ ...s, kind })),
      setSprite: (sprite) => setState((s) => ({ ...s, sprite })),
      setTexture: (texture) => setState((s) => ({ ...s, texture })),
      selectObject: (selectedObjectId) => setState((s) => ({ ...s, selectedObjectId })),
      setError: (error) => setState((s) => ({ ...s, error })),
    }),
    [state],
  );
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (value === null) throw new Error("useEditor() is only available inside EditorProvider.");
  return value;
}
