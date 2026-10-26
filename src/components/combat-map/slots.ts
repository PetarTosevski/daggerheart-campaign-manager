import type { ReactNode } from "react";

import type { Doc, Id } from "../../../convex/_generated/dataModel";

/**
 * Props of the feature slots the Combat Map page mounts (D9, plan `.omc/plans/d9-combat-map.yaml`). The page
 * (C0, `src/app/(gm)/campaigns/[campaignId]/combat-map/page.tsx`) owns the layout, the header (title, GM Fear),
 * the Play / Edit switch and the page state below; each feature tracer owns only its folder and fills the
 * components its `index.tsx` exports, keeping their names and props:
 *
 * | Folder      | Tracer | Exports (mounted by the page)                                              |
 * |-------------|--------|-----------------------------------------------------------------------------|
 * | `maps/`     | C3     | `useCurrentMap`, `MapsPanel`, `MapHeaderLine`, `MapBoard` (+ `map-view/**`) |
 * | `generate/` | C4     | `ScenePanel`                                                                |
 * | `editor/`   | C5     | `EditorProvider`, `EditToolsPanel`, `EditorLayer`                           |
 * | `tokens/`   | C6     | `TokensProvider`, `CombatantsPanel`, `TokenPanel`, `TokensLayer`            |
 * | `vision/`   | C7/C8  | `VisionProvider`, `LightPill`, `PreviewPicker`, `VisionPanel`, `RevealPanel`, `VisionLayer` |
 *
 * Rules for every slot:
 * - The page wraps each slot in its own error boundary (CL1); a slot shows its own loading line
 *   (`<p role="status" className="cm-muted">Loading …</p>`) while its `useQuery` is `undefined`.
 * - A `*Provider` holds state its feature shares between its panel (left column) and its layer (map area), such
 *   as the editor's tool or the GM's preview; the page mounts every provider around the whole layout, outermost
 *   first in the order of the table above. A provider renders its children and nothing else.
 * - Cross-feature state lives in the page and arrives as props (`CombatPageState`); a slot changes it only
 *   through the callbacks here.
 * - Styles: shared tokens and classes (`cm-card`, `cm-btn`, `cm-lbl`, …) come from the page's `combat-map.css`
 *   (the board's classes, `--cm-*` variables); a feature adds CSS only in a colocated `.css` in its folder.
 */

/** Who is looking: the campaign's GM or a player (from `useCampaign().role`; the server still decides what each reads). */
export type CombatRole = "gm" | "player";

/** GM: Play (tokens, vision, fog) or Edit (scene, hand editing); always Edit while there is no map (as on the board). Players are always in play. */
export type CombatMode = "play" | "edit";

/**
 * A map as the page and every slot see it: what `useCurrentMap` returns. Players get the live map only (Q1:
 * the whole layout is theirs; the header line hides its size).
 */
export type CombatMapSummary = Pick<Doc<"combatMaps">, "_id" | "name" | "live" | "source" | "w" | "h">;

/** State the page owns and hands to the slots. */
export type CombatPageState = {
  campaignId: Id<"campaigns">;
  role: CombatRole;
  mode: CombatMode;
  /**
   * The map on screen: for the GM the map picked in the list (null = `useCurrentMap`'s default: the live map,
   * else the newest), for a player always the live map. null = no map yet. Every map-bound slot gets this id.
   */
  map: CombatMapSummary | null;
  /** The token selected on the map (C6), shared with the vision slots (C8's "Reveal to…" for that token). */
  selectedTokenId: Id<"combatTokens"> | null;
  onSelectToken: (tokenId: Id<"combatTokens"> | null) => void;
  /** GM only: the PC whose view the GM previews (R12, C8); null = the GM's own view of everything. */
  previewCharacterId: Id<"characters"> | null;
  onPreview: (characterId: Id<"characters"> | null) => void;
};

// ---------------------------------------------------------------- maps (C3)

/** Arguments of `useCurrentMap(args)`: resolves the map on screen (see `CombatPageState.map`). `undefined` while loading. */
export type CurrentMapArgs = {
  campaignId: Id<"campaigns">;
  role: CombatRole;
  /** The GM's pick in the maps list; ignored for players. */
  selectedMapId: Id<"combatMaps"> | null;
};

/** GM, left column: the campaign's maps (list, new, rename, duplicate, delete, set live; R2). */
export type MapsPanelProps = {
  campaignId: Id<"campaigns">;
  selectedMapId: Id<"combatMaps"> | null;
  onSelectMap: (mapId: Id<"combatMaps"> | null) => void;
};

/** Header, under the title: "Name · W × H squares · N tokens" for the GM; the name only for players (Q1). */
export type MapHeaderLineProps = {
  campaignId: Id<"campaigns">;
  role: CombatRole;
  map: CombatMapSummary | null;
};

/**
 * The minimal viewport contract the map area hands every layer. C3 may expose more through its own
 * `map-view/**` context (layers of later tracers read it); this type does not change.
 */
export type CombatMapViewport = {
  /** Screen pixels per square at zoom 1 (the painter's cell size). */
  cell: number;
  /** Current zoom factor. */
  zoom: number;
  /** Map size in squares. */
  w: number;
  h: number;
  /**
   * Squares of padding drawn around the map on every side: 0 for the GM, FOG_PAD_SQUARES for players (Q1, C8).
   * A layer draws square (x, y) at ((x + pad) * cell * zoom, (y + pad) * cell * zoom) inside the stage.
   */
  pad: number;
  /** A pointer position (client pixels) in map squares (fractional; outside the map when off it). */
  toSquares: (clientX: number, clientY: number) => { x: number; y: number };
  /** Token names always shown (the board's "Names" switch, N; per viewer in localStorage). */
  showNames: boolean;
};

/** What a layer gets: the page state plus the viewport. Layers render absolutely positioned inside the stage. */
export type MapLayerProps = CombatPageState & { map: CombatMapSummary; viewport: CombatMapViewport };

/**
 * Main area: toolbar (title, LIVE, Make live, Names, Hide all circles, zoom − / + / Fit), the pan/zoom viewport
 * with the painted map or uploaded image, and the empty states (`map` null). `renderLayers` is called with the
 * layer props once a map is drawn; the page mounts the editor, tokens and vision layers through it.
 */
export type MapBoardProps = CombatPageState & {
  renderLayers: (layer: MapLayerProps) => ReactNode;
};

// ---------------------------------------------------------------- generate (C4)

/** GM, left column in Edit: describe the battlefield, size, Generate / Another version / Stop, own image. */
export type ScenePanelProps = {
  campaignId: Id<"campaigns">;
  map: CombatMapSummary | null;
  /** A new map was made (first generation or an uploaded image): the page shows it. */
  onMapCreated: (mapId: Id<"combatMaps">) => void;
};

// ---------------------------------------------------------------- editor (C5)

/** GM, left column in Edit: the hand-editing tools (Pan, Terrain, Object, Sight blocker, Erase, Grid) and the object panel. */
export type EditToolsPanelProps = {
  campaignId: Id<"campaigns">;
  map: CombatMapSummary;
};

// ---------------------------------------------------------------- tokens (C6)

/** GM, left column in Play: add the party, the "From the Adversaries tab" queue, custom tokens, clear. */
export type CombatantsPanelProps = {
  campaignId: Id<"campaigns">;
  map: CombatMapSummary;
};

/** Left column, both roles: the selected token (GM: any; a player: their own PC; R4). Renders nothing when none is selected. */
export type TokenPanelProps = CombatPageState & { map: CombatMapSummary };

// ---------------------------------------------------------------- vision (C7, C8)

/** Header: the light for the campaign's time phase and the dim-phase badge (R8). Renders nothing without campaign time. */
export type LightPillProps = { campaignId: Id<"campaigns"> };

/** Header, GM only: "Player view ▾", the PC whose view to preview (R12). */
export type PreviewPickerProps = CombatPageState;

/**
 * Left column. Player: the "Your character" card (cone, facing, carried light, light rule; R6, R9). GM in Play:
 * "Vision & fog" (preview, fog brush; R12).
 */
export type VisionPanelProps = CombatPageState & { map: CombatMapSummary };

/** Left column, GM, under the token panel: "Reveal to…" for the selected token when it is in dim light (R10). */
export type RevealPanelProps = CombatPageState & { map: CombatMapSummary };

/** Shared by every provider: state shared between a feature's panel and layer. */
export type ProviderProps = { children: ReactNode };

// ---------------------------------------------------------------- sprite packs (plan .omc/plans/sprite-packs.yaml)
//
// | Folder    | Tracer | Exports (mounted by the page)                                                       |
// |-----------|--------|--------------------------------------------------------------------------------------|
// | `style/`  | P6     | `StyleSwitch` (Combat Map header, GM only, once a map is on screen)                   |
// | `packs/`  | P8     | `PacksLink` (GM left column, under Maps), `PacksScreen` (the /combat-map/packs route) |
//
// P0 ships both folders as stubs: `StyleSwitch` renders nothing, `PacksLink` is a plain link to the packs route
// and `PacksScreen` an empty-state card. The page mounts each in its own error boundary and only for the GM;
// the server functions refuse players anyway (D10).

/**
 * Combat Map header, GM only, rendered only while a map is on screen: the per-map Classic | Sprites switch (P3).
 * P6 reads the map's `style` from `combatMaps.get` (absent = "classic", Q4) and calls `combatMapStyle.setStyle`
 * (map id + style, D1) with an optimistic update on `combatMaps.get` / `combatMaps.list`.
 */
export type StyleSwitchProps = {
  campaignId: Id<"campaigns">;
  map: CombatMapSummary;
};

/** GM left column, under the Maps card: opens the sprite packs screen (`packsHref(campaignId)`). */
export type PacksLinkProps = { campaignId: Id<"campaigns"> };

/** The /campaigns/<id>/combat-map/packs route body (GM only; the route sends players back to the Combat Map). */
export type PacksScreenProps = { campaignId: Id<"campaigns"> };

/** The sprite packs route of a campaign. */
export function packsHref(campaignId: Id<"campaigns">): string {
  return `/campaigns/${campaignId}/combat-map/packs`;
}

// ---------------------------------------------------------------- combat actions (plan .omc/plans/combat-actions.yaml)
//
// | Folder                | Tracer   | Exports (mounted by the page)                                                   |
// |-----------------------|----------|----------------------------------------------------------------------------------|
// | `actions/`            | CA5      | `ActionsProvider`, `ActionsPanel` (player column), `Resolutions` (GM column),    |
// |                       |          | `TargetsLayer` (map layer, Play); re-exports `targets/` and `gm/`                |
// | `actions/attack/`     | CA5      | `AttackBar` (inside `ActionsPanel`)                                              |
// | `actions/targets/`    | CA5      | `TargetsLayer`, `TargetList` (inside `ActionsPanel`)                             |
// | `actions/dice/`       | CA5      | `MapDice` (inside `ActionsPanel`)                                                |
// | `actions/gm/`         | CA5      | `Resolutions`                                                                    |
// | `actions/hand/`       | CA6      | `Hand` (inside `ActionsPanel`; the first tab of the phone bottom sheet)          |
// | `actions/adversary/`  | AA5      | `AdversaryPanel` (GM column, Play), `HitFlashLayer` (map layer, Play)            |
// | `actions/reactions/`  | AA4      | `IncomingHit` (player column, first)                                             |
//
// CA0 ships every export as a stub that renders nothing (providers render their children). The page mounts each in
// its own error boundary: in Play only, with a map on screen. Order: player column IncomingHit, ActionsPanel, then
// the view and token cards; GM column Combatants, the token card, AdversaryPanel, Reveal, Vision, Resolutions. Map
// layers draw after the vision layer (fog), TargetsLayer then HitFlashLayer, so rings and flashes stay visible.
// Picked targets are shared state of `ActionsProvider` (vision-layer's selection adds to it, the Attack bar and the
// Hand read it); the page does not hold them. Players never get enemy numbers from any of these (U1).

/** The props every combat-actions panel gets: the page state with the map on screen. */
export type ActionsSlotProps = CombatPageState & { map: CombatMapSummary };

/** Player column: the Hand, the Attack bar, target list, map dice box and mini feed; a bottom sheet at <=760px (Q11). */
export type ActionsPanelProps = ActionsSlotProps;

/** GM column, last: the latest resolutions of the map's encounter with Undo (U4, Q10). */
export type ResolutionsProps = ActionsSlotProps;

/** GM column, under the token card: Attack and feature buttons for the selected adversary token (Q12, Q16, Q19). */
export type AdversaryPanelProps = ActionsSlotProps;

/** Player column, first: the open incoming hit on the player's character (armor choice) or an ally's (reaction cards; Q13, Q14). */
export type IncomingHitProps = ActionsSlotProps;

/** Map layers of the combat actions (target rings, hit flashes): the usual layer props. */
export type ActionsLayerProps = MapLayerProps;

// ---------------------------------------------------------------- sheet drawer (plan .omc/plans/sheet-drawer.yaml)
//
// | Folder         | Tracer    | Exports (mounted by the page)                                                    |
// |----------------|-----------|----------------------------------------------------------------------------------|
// | `drawer/`      | SD0 → SD6 | `SheetDrawer` (one per page, opened by the page's Sheet button)                  |
// | `drawer/use/`  | SD0 → SD7 | `FeatureUse` (inside `SheetDrawer`: one feature's Use dialog, choices and result) |
//
// The page (SD0) owns the Sheet button: in Play, in the header's tools (the top bar) and, at 760 px and below, in a
// bar under the map (the bottom bar). It shows for a player whose PC has a token on the live map, and for the GM while
// a PC token is selected (`sheetCharacterId`). The page mounts `SheetDrawer` once, in its own error boundary, keeps it
// mounted after the first open (so closing returns focus to the button and the map stays as it was: no remount, no
// `key=` on live content, CL7) and passes `open` / `onClose`. SD0 ships `SheetDrawer` as a modal with the "Full sheet"
// link and `FeatureUse` as a stub that renders nothing. Players never get enemy numbers from either (U1).

/**
 * The drawer over the live map (SD6): the character's HP / Stress / Hope / Armor trackers and every owned feature with
 * its Use button (`FeatureUse`); a right-side modal dialog, full screen at 760 px and below. `characterId` is the PC
 * whose sheet it shows: the player's own, or the PC token the GM selected.
 */
export type SheetDrawerProps = {
  campaignId: Id<"campaigns">;
  role: CombatRole;
  /** The map on screen, or null (features without enemy targets still work without one). */
  map: CombatMapSummary | null;
  characterId: Id<"characters">;
  open: boolean;
  onClose: () => void;
};

/**
 * One feature's Use flow inside the drawer (SD7): the choices and targets dialog of the Hand (CA6), then the result.
 * `featureId` is a feature id (src/lib/domain/feature-effects/ids.ts); `useId` one of its uses (default its first).
 * `onClose` ends the flow (used, passed or cancelled).
 */
export type FeatureUseProps = {
  campaignId: Id<"campaigns">;
  role: CombatRole;
  map: CombatMapSummary | null;
  characterId: Id<"characters">;
  featureId: string;
  useId?: string;
  onClose: () => void;
};

/** A token as the Sheet button reads it (`combatTokens.party`: the map's PC tokens). */
export type SheetTokenRef = { _id: Id<"combatTokens">; kind: string; characterId?: Id<"characters">; mine: boolean };

/**
 * Whose sheet the Sheet button opens, or null for no button: a player's own PC token on the map (`mine`), or, for the
 * GM, the selected token when it is a PC's.
 */
export function sheetCharacterId(role: CombatRole, tokens: readonly SheetTokenRef[], selectedTokenId: Id<"combatTokens"> | null): Id<"characters"> | null {
  const pc = (t: SheetTokenRef) => t.kind === "pc" && t.characterId !== undefined;
  const token = role === "gm" ? tokens.find((t) => t._id === selectedTokenId && pc(t)) : tokens.find((t) => t.mine && pc(t));
  return token?.characterId ?? null;
}

/** A character's full sheet on the Party page (the drawer's "Full sheet" link). */
export function sheetHref(campaignId: Id<"campaigns">, characterId: Id<"characters">): string {
  return `/campaigns/${campaignId}/party/${characterId}`;
}
