"use client";

import "./editor.css";

import type { ProviderProps } from "../slots";
import { EditorStateProvider } from "./editor-state";

/**
 * Editor slot (D9 C5): editing a map by hand in Edit mode: terrain, objects and their sight setting, sight blockers
 * over an uploaded image (R2, R7). Export names and props follow src/components/combat-map/slots.ts. The image grid
 * (R1) stays in C3's grid bar above the map.
 */

/** Holds the editor's tool, brush, terrain, object kind and selected object, shared by `EditToolsPanel` and `EditorLayer`. */
export function EditorProvider({ children }: ProviderProps) {
  return <EditorStateProvider>{children}</EditorStateProvider>;
}

export { EditToolsPanel } from "./edit-tools-panel";
export { EditorLayer } from "./editor-layer";
