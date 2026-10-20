"use client";

import type {
  LightPillProps,
  MapLayerProps,
  PreviewPickerProps,
  ProviderProps,
  RevealPanelProps,
  VisionPanelProps,
} from "../slots";

/**
 * Vision slot (C7's server functions, C8 fills these): light by campaign time, each player's own view, fog of war,
 * explored areas, reveals and the GM's preview and fog brush (R6–R12, Q1, Q3, Q4). Keep the export names and
 * props (src/components/combat-map/slots.ts).
 */

/** Holds the fog brush and the player's throttled explored-area sync. Stub: no state. */
export function VisionProvider({ children }: ProviderProps) {
  return <>{children}</>;
}

/** Header: the light pill for the campaign's time phase (R8). Stub: nothing. */
export function LightPill(props: LightPillProps) {
  void props;
  return null;
}

/** Header, GM: "Player view ▾" to preview a PC's view (R12). Stub: nothing. */
export function PreviewPicker(props: PreviewPickerProps) {
  void props;
  return null;
}

/** Left column: the player's "Your character" card, or the GM's "Vision & fog" card in Play. Stub: the player card's frame. */
export function VisionPanel({ role }: VisionPanelProps) {
  if (role === "gm") return null;
  return (
    <section className="cm-card cm-card-me" aria-labelledby="cm-me-h">
      <span id="cm-me-h" className="cm-lbl">
        Your view
      </span>
      <p className="cm-muted cm-m0">You see the battle through your character&apos;s eyes.</p>
    </section>
  );
}

/** Left column, GM: "Reveal to…" for a token hidden in dim light (R10). Stub: nothing. */
export function RevealPanel(props: RevealPanelProps) {
  void props;
  return null;
}

/** Map area: the fog canvas and the cone outline. Stub: draws nothing. */
export function VisionLayer(props: MapLayerProps) {
  void props;
  return null;
}
