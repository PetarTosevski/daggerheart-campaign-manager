"use client";

import type { EditToolsPanelProps, MapLayerProps, ProviderProps } from "../slots";

/**
 * Editor slot (C5 fills it): editing a map by hand in Edit mode (terrain, objects, sight, sight blockers over an
 * image, the image grid; R1, R2, R7). Keep the export names and props (src/components/combat-map/slots.ts).
 */

/** Holds the editor's tool, brush and selected object, shared by `EditToolsPanel` and `EditorLayer`. Stub: no state. */
export function EditorProvider({ children }: ProviderProps) {
  return <>{children}</>;
}

/** GM, left column in Edit, once a map exists: the "Edit by hand" card. Stub: the card's heading only. */
export function EditToolsPanel(props: EditToolsPanelProps) {
  void props;
  return (
    <section className="cm-card" aria-labelledby="cm-edit-h">
      <h2 id="cm-edit-h" className="cm-h">
        Edit by hand
      </h2>
    </section>
  );
}

/** Map area in Edit: pointer handling for the tools and the "blocks sight" outlines. Stub: draws nothing. */
export function EditorLayer(props: MapLayerProps) {
  void props;
  return null;
}
