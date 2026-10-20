"use client";

import type { ScenePanelProps } from "../slots";

/**
 * Generate slot (C4 fills it): the board's Scene card. Claude (or the keyword fallback) lays out a map from the
 * GM's description; "Use my own map image" starts an image map (C3's upload). Keep the export name and props
 * (src/components/combat-map/slots.ts). Stub: the card's heading only.
 */
export function ScenePanel(props: ScenePanelProps) {
  void props;
  return (
    <section className="cm-card" aria-labelledby="cm-scene-h">
      <h2 id="cm-scene-h" className="cm-h">
        Scene
      </h2>
      <p className="cm-muted cm-m0">Describing a battlefield comes soon.</p>
    </section>
  );
}
