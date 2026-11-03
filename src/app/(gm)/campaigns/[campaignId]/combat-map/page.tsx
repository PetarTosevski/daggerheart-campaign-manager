"use client";

import "./combat-map.css";

import { Component, useState, type ReactNode } from "react";

import { ActionsProvider, TargetsLayer } from "@/components/combat-map/actions";
import { HitFlashLayer } from "@/components/combat-map/actions/adversary";
import { HudShell, ToolsHead } from "@/components/combat-map/hud";
import { EditorLayer, EditorProvider, EditToolsPanel } from "@/components/combat-map/editor";
import { ScenePanel } from "@/components/combat-map/generate";
import { MapBoard, MapHeaderLine, MapsPanel, useCurrentMap } from "@/components/combat-map/maps";
import { PacksLink } from "@/components/combat-map/packs";
import { StyleSwitch } from "@/components/combat-map/style";
import { LiveSessionChip } from "@/components/sessions/session-chip";
import type { CombatMode, CombatPageState, CombatRole, MapLayerProps } from "@/components/combat-map/slots";
import { CombatantsPanel, TokenPanel, TokensLayer, TokensProvider } from "@/components/combat-map/tokens";
import { LightPill, PreviewPicker, RevealPanel, VisionLayer, VisionPanel, VisionProvider } from "@/components/combat-map/vision";
import { MAX_FEAR } from "@/lib/domain/fear";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { useCampaign, WithFear } from "../campaign-shell";

/**
 * Combat Map (D9): the page shell. C0 owns the layout, GM Fear, the Play / Edit switch and the shared page state; every
 * feature lives in a slot under src/components/combat-map/ (contract: slots.ts). Players are not refused (the tab is
 * not gmOnly): the server decides what they read.
 *
 * Plan combat-hud H8.1 (cut-over, user 2026-11-03 "Cut over now"): Play is always the Combat HUD (`HudShell`), for
 * the GM and every player; there is no switch. The GM's Edit mode (and the GM with no map yet) keeps the two-column
 * layout with its header (answer 12a): the HUD has no Edit mode.
 */

/** Keeps a failing slot (a `useQuery` that throws) from blanking the page (CL1); "Try again" remounts it. */
class SlotBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean; message: string }> {
  state: { failed: boolean; message: string } = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.label} failed to load`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="cm-alert">
        <span>
          {this.props.label} failed to load{this.state.message ? `: ${this.state.message}` : "."}
        </span>
        <button type="button" className="cm-btn cm-sm" onClick={() => this.setState({ failed: false, message: "" })}>
          Try again
        </button>
      </div>
    );
  }
}

/** The board's GM Fear pill: − / value / +, the same campaign Fear as the dashboard (one Fear per click). */
function FearPill({ campaignId, fear }: { campaignId: Id<"campaigns">; fear: number }) {
  const adjust = useIntent(api.fear.adjust);
  return (
    <div className="cm-fear" role="group" aria-label="GM Fear">
      <span className="cm-fear-lbl" aria-hidden="true">
        GM FEAR
      </span>
      <button
        type="button"
        className="cm-btn cm-sm cm-fear-step"
        aria-label="Spend a Fear"
        disabled={fear <= 0 || adjust.pending}
        onClick={() => void adjust.fire({ campaignId, direction: "decrease" })}
      >
        −
      </button>
      <strong className="cm-fear-n" aria-label={`${fear} of ${MAX_FEAR} Fear`} data-testid="combat-fear">
        {fear}
      </strong>
      <button
        type="button"
        className="cm-btn cm-sm cm-fear-step"
        aria-label="Gain a Fear"
        disabled={fear >= MAX_FEAR || adjust.pending}
        onClick={() => void adjust.fire({ campaignId, direction: "increase" })}
      >
        +
      </button>
      {adjust.error ? (
        <span role="status" className="cm-fear-err">
          {adjust.error}
        </span>
      ) : null}
    </div>
  );
}

/** The board's Play / Edit switch (GM only). */
function ModeSwitch({ mode, onMode }: { mode: CombatMode; onMode: (mode: CombatMode) => void }) {
  return (
    <div className="cm-seg" role="group" aria-label="Map mode">
      <button type="button" aria-pressed={mode === "play"} onClick={() => onMode("play")}>
        ▶ Play
      </button>
      <button type="button" aria-pressed={mode === "edit"} onClick={() => onMode("edit")}>
        ✎ Edit map
      </button>
    </div>
  );
}

/**
 * The map layers in drawing order: editor (Edit only), tokens, vision (fog over everything), then the combat-action
 * overlays in Play (target rings, hit flashes; plan combat-actions), which stay visible above the fog.
 */
function Layers(layer: MapLayerProps) {
  return (
    <>
      {layer.role === "gm" && layer.mode === "edit" ? (
        <SlotBoundary label="The map editor">
          <EditorLayer {...layer} />
        </SlotBoundary>
      ) : null}
      <SlotBoundary label="Tokens">
        <TokensLayer {...layer} />
      </SlotBoundary>
      <SlotBoundary label="Vision">
        <VisionLayer {...layer} />
      </SlotBoundary>
      {layer.mode === "play" ? (
        <>
          <SlotBoundary label="Targets">
            <TargetsLayer {...layer} />
          </SlotBoundary>
          <SlotBoundary label="Hits">
            <HitFlashLayer {...layer} />
          </SlotBoundary>
        </>
      ) : null}
    </>
  );
}

/**
 * GM left column: maps, the mode switch, then Scene + Edit tools (Edit) or Combatants, the token card, Reveal and Vision
 * (Play). Plan combat-hud H8.2: the adversary card and the Resolutions / End scene cards are gone (the HUD's stat block,
 * "Waiting on you" queue and scene tools do that).
 */
function GmColumn({ state, selectedMapId, onSelectMap, onMode }: {
  state: CombatPageState;
  selectedMapId: Id<"combatMaps"> | null;
  onSelectMap: (mapId: Id<"combatMaps"> | null) => void;
  onMode: (mode: CombatMode) => void;
}) {
  const { campaignId, map } = state;
  return (
    <>
      <SlotBoundary label="Maps">
        <MapsPanel campaignId={campaignId} selectedMapId={selectedMapId} onSelectMap={onSelectMap} />
      </SlotBoundary>
      <SlotBoundary label="Sprite packs">
        <PacksLink campaignId={campaignId} />
      </SlotBoundary>
      <ModeSwitch mode={state.mode} onMode={onMode} />
      {state.mode === "edit" ? (
        <>
          <SlotBoundary label="Scene">
            <ScenePanel
              campaignId={campaignId}
              map={map}
              onMapCreated={(id) => {
                // A new map opens in Edit, as on the board, so the Scene card (and its result line) stays up.
                onSelectMap(id);
                onMode("edit");
              }}
            />
          </SlotBoundary>
          {map ? (
            <SlotBoundary label="Edit tools">
              <EditToolsPanel campaignId={campaignId} map={map} />
            </SlotBoundary>
          ) : null}
        </>
      ) : map ? (
        <>
          <SlotBoundary label="Combatants">
            <CombatantsPanel campaignId={campaignId} map={map} />
          </SlotBoundary>
          <SlotBoundary label="The selected token">
            <TokenPanel {...state} map={map} />
          </SlotBoundary>
          <SlotBoundary label="Reveal">
            <RevealPanel {...state} map={map} />
          </SlotBoundary>
          <SlotBoundary label="Vision and fog">
            <VisionPanel {...state} map={map} />
          </SlotBoundary>
        </>
      ) : null}
    </>
  );
}

/**
 * A player's "Your character" drawer in the HUD (plan combat-hud H0): their view card, the selected token (their own
 * PC, R4). The HUD itself holds the Hand, the pickers, the hit window, the dice, the feed (H8.1 deleted the classic
 * column's incoming hit and combat actions) and, on the sheet, the class controls (H9.5: Flying, Beastform, stances,
 * counters).
 */
function PlayerColumn({ state }: { state: CombatPageState }) {
  const { map } = state;
  if (!map) return null;
  return (
    <>
      <SlotBoundary label="Your view">
        <VisionPanel {...state} map={map} />
      </SlotBoundary>
      <SlotBoundary label="The selected token">
        <TokenPanel {...state} map={map} />
      </SlotBoundary>
    </>
  );
}

/** Everything that depends on the map on screen: the HUD in Play, the GM's two-column layout in Edit. */
function CombatBody({ campaign, role }: { campaign: CampaignSummary; role: CombatRole }) {
  const campaignId = campaign._id;
  const [selectedMapId, setSelectedMapId] = useState<Id<"combatMaps"> | null>(null);
  const [mode, setMode] = useState<CombatMode>("play");
  const [selectedTokenId, setSelectedTokenId] = useState<Id<"combatTokens"> | null>(null);
  const [previewCharacterId, setPreviewCharacterId] = useState<Id<"characters"> | null>(null);
  const current = useCurrentMap({ campaignId, role, selectedMapId });
  // The GM with no map yet is in Edit, and stays there once the first map exists (made from the column or generated):
  // only the Play / Edit switch moves the GM into the HUD. Adjusted during render (no effect, CL7).
  if (role === "gm" && current === null && mode !== "edit") setMode("edit");

  function selectMap(mapId: Id<"combatMaps"> | null) {
    setSelectedMapId(mapId);
    // A token belongs to one map: picking another map drops the selection.
    setSelectedTokenId(null);
  }

  const state: CombatPageState = {
    campaignId,
    role,
    // As on the board: with no map yet the GM is in Edit (the Scene card draws the first one); players always play.
    mode: role === "gm" ? (current === null ? "edit" : mode) : "play",
    map: current ?? null,
    selectedTokenId,
    onSelectToken: setSelectedTokenId,
    previewCharacterId: role === "gm" ? previewCharacterId : null,
    onPreview: setPreviewCharacterId,
  };

  // Play is the full-bleed HUD with the classic column in its tools drawer (plan combat-hud H0, H8.1). Same component
  // in both modes, so the page state and its queries stay mounted when the GM switches between Play and Edit. While the
  // map loads the GM gets the column (as before the cut-over), so its links (sprite packs) mount at once.
  if (state.mode === "play" && !(role === "gm" && current === undefined)) {
    return (
      <HudShell
        state={state}
        loading={current === undefined}
        renderLayers={(layer) => <Layers {...layer} />}
        tools={
          <>
            <ToolsHead>
              <HeaderTools campaign={campaign} state={state} />
            </ToolsHead>
            {role === "gm" ? (
              <GmColumn state={state} selectedMapId={selectedMapId} onSelectMap={selectMap} onMode={setMode} />
            ) : (
              <PlayerColumn state={state} />
            )}
          </>
        }
      />
    );
  }

  // The GM in Edit, with no map yet, or while the map loads: the header and the two-column layout (answer 12a; the HUD
  // has no Edit mode).
  return (
    <>
      <EditHeader campaign={campaign} state={state} loading={current === undefined} />
      <main className="cm-main">
        <aside className="cm-aside" aria-label="Map tools">
          <GmColumn state={state} selectedMapId={selectedMapId} onSelectMap={selectMap} onMode={setMode} />
        </aside>
        <div className="cm-area">
          {current === undefined ? (
            <p role="status" className="cm-muted">
              Loading the map…
            </p>
          ) : (
            <SlotBoundary label="The map">
              <MapBoard {...state} renderLayers={(layer) => <Layers {...layer} />} />
            </SlotBoundary>
          )}
        </div>
      </main>
    </>
  );
}

/**
 * The scene tools: light, and for the GM the session chip, Fear, map style and player view. The GM's Edit header shows
 * them; in Play the HUD shows them in its tools drawer (plan combat-hud H0) beside its own Fear banner, disc and toolbar.
 */
function HeaderTools({ campaign, state }: { campaign: CampaignSummary; state: CombatPageState }) {
  return (
    <>
      <SlotBoundary label="Light">
        <LightPill campaignId={campaign._id} />
      </SlotBoundary>
      {state.role === "gm" ? (
        <>
          {/* Sessions hub: while a session is live, a chip back to its Play stage. */}
          <LiveSessionChip campaignId={campaign._id} />
          <SlotBoundary label="Fear">
            <WithFear>{(fear) => <FearPill campaignId={campaign._id} fear={fear} />}</WithFear>
          </SlotBoundary>
          {state.map ? (
            <SlotBoundary label="Map style">
              <StyleSwitch campaignId={campaign._id} map={state.map} />
            </SlotBoundary>
          ) : null}
          <SlotBoundary label="Player view">
            <PreviewPicker {...state} />
          </SlotBoundary>
        </>
      ) : null}
    </>
  );
}

/**
 * The GM's header in Edit: campaign name, title, the map's header line and the scene tools. Plan combat-hud H8.1: the
 * classic header now shows only here (players and the GM in Play get the HUD's title); its HUD switch and Sheet button
 * are gone.
 */
function EditHeader({ campaign, state, loading }: { campaign: CampaignSummary; state: CombatPageState; loading: boolean }) {
  return (
    <header className="cm-head">
      <div className="cm-head-text">
        <div className="cm-campaign">{campaign.name}</div>
        <h1 className="cm-title">Combat Map</h1>
        <div className="cm-headline">
          {loading ? (
            <span role="status">Loading…</span>
          ) : (
            <SlotBoundary label="The header line">
              <MapHeaderLine campaignId={campaign._id} role={state.role} map={state.map} />
            </SlotBoundary>
          )}
        </div>
      </div>
      <div className="cm-head-tools">
        <HeaderTools campaign={campaign} state={state} />
      </div>
    </header>
  );
}

export default function CombatMapPage() {
  const campaign = useCampaign();
  const role: CombatRole = campaign.role === "gm" ? "gm" : "player";
  return (
    <div className="cm-root" data-role={role}>
      <title>{`Combat Map · ${campaign.name}`}</title>
      <EditorProvider>
        <TokensProvider>
          <VisionProvider>
            <ActionsProvider>
              <SlotBoundary label="The combat map">
                <CombatBody campaign={campaign} role={role} />
              </SlotBoundary>
            </ActionsProvider>
          </VisionProvider>
        </TokensProvider>
      </EditorProvider>
    </div>
  );
}
