import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { Terrain } from "../../../../../../src/lib/domain/combat-map/spec";
import type { SpriteRef } from "../../../../../../convex/lib/validators/combatMaps";

import type { Brush, PlaceableKind } from "../../../../../../src/components/combat-map/editor/edit-model";

export type EditTool = "pan" | "terrain" | "object" | "block" | "eraseTerrain" | "eraseBlock";

const PAINTER_TOOLS: ReadonlySet<EditTool> = new Set<EditTool>(["terrain", "object"]);

export function toolFor(tool: EditTool, isImage: boolean): EditTool {
  return isImage && PAINTER_TOOLS.has(tool) ? "pan" : tool;
}

export type EditorState = {
  tool: EditTool;
  terrain: Terrain;
  brush: Brush;
  kind: PlaceableKind;
  sprite: SpriteRef | null;
  texture: SpriteRef | null;
  selectedObjectId: string | null;
  error: string | null;
};

type EditorContextValue = EditorState & {
  setTool: (tool: EditTool) => void;
  setTerrain: (terrain: Terrain) => void;
  setBrush: (brush: Brush) => void;
  setKind: (kind: PlaceableKind) => void;
  setSprite: (sprite: SpriteRef) => void;
  setTexture: (texture: SpriteRef | null) => void;
  selectObject: (objectId: string | null) => void;
  setError: (message: string | null) => void;
};

const EditorContext = createContext<EditorContextValue | null>(null);

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
      setTool: (tool) => setState((s) => ({ ...s, tool, selectedObjectId: null, error: null })),
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
  if (value === null) throw new Error("useEditor() is only available inside EditorStateProvider.");
  return value;
}
