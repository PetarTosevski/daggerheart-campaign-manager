"use client";

import "./combat-map.css";

import { useQuery } from "convex/react";
import { Component, useState, type ReactNode } from "react";

import { ActionsPanel, ActionsProvider, Resolutions, TargetsLayer } from "@/components/combat-map/actions";
import { AdversaryPanel, HitFlashLayer } from "@/components/combat-map/actions/adversary";
import { IncomingHit } from "@/components/combat-map/actions/reactions";
import { SheetDrawer } from "@/components/combat-map/drawer";
import { EditorLayer, EditorProvider, EditToolsPanel } from "@/components/combat-map/editor";
import { ScenePanel } from "@/components/combat-map/generate";
import { MapBoard, MapHeaderLine, MapsPanel, useCurrentMap } from "@/components/combat-map/maps";
import { PacksLink } from "@/components/combat-map/packs";
import { StyleSwitch } from "@/components/combat-map/style";
import { LiveSessionChip } from "@/components/sessions/session-chip";
import { sheetCharacterId, type CombatMode, type CombatPageState, type CombatRole, type MapLayerProps } from "@/components/combat-map/slots";
import { CombatantsPanel, TokenPanel, TokensLayer, TokensProvider } from "@/components/combat-map/tokens";
import { LightPill, PreviewPicker, RevealPanel, VisionLayer, VisionPanel, VisionProvider } from "@/components/combat-map/vision";
import { MAX_FEAR } from "@/lib/domain/fear";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { useCampaign, WithFear } from "../campaign-shell";

/**
 * Combat Map (D9): the page shell. C0 owns the layout, header, GM Fear, the Play / Edit switch and the shared page
 * state; every feature lives in a slot under src/components/combat-map/ (contract: slots.ts). Players are not
 * refused (the tab is not gmOnly): they get the player layout and the server decides what they read.
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
 * GM left column: maps, the mode switch, then Scene + Edit tools (Edit) or Combatants, the token card, the adversary
 * controls, Reveal, Vision and the Resolutions list (Play).
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
          <SlotBoundary label="Adversary actions">
            <AdversaryPanel {...state} map={map} />
          </SlotBoundary>
          <SlotBoundary label="Reveal">
            <RevealPanel {...state} map={map} />
          </SlotBoundary>
          <SlotBoundary label="Vision and fog">
            <VisionPanel {...state} map={map} />
          </SlotBoundary>
          <SlotBoundary label="Resolutions">
            <Resolutions {...state} map={map} />
          </SlotBoundary>
        </>
      ) : null}
    </>
  );
}

/**
 * Player left column: an incoming hit to answer, the combat actions (Hand, Attack, dice; plan combat-actions), their
 * own view card, then the selected token (their own PC, R4).
 */
function PlayerColumn({ state }: { state: CombatPageState }) {
  const { map } = state;
  if (!map) return null;
  return (
    <>
      <SlotBoundary label="Incoming hit">
        <IncomingHit {...state} map={map} />
      </SlotBoundary>
      <SlotBoundary label="Combat actions">
        <ActionsPanel {...state} map={map} />
      </SlotBoundary>
      <SlotBoundary label="Your view">
        <VisionPanel {...state} map={map} />
      </SlotBoundary>
      <SlotBoundary label="The selected token">
        <TokenPanel {...state} map={map} />
      </SlotBoundary>
    </>
  );
}

/** Opens the sheet drawer for `characterId` (plan sheet-drawer, SD0). */
type OpenSheet = (characterId: Id<"characters">) => void;

/**
 * The Sheet button (plan sheet-drawer, SD0): in Play, for a player whose PC has a token on the map and for the GM while
 * a PC token is selected (`sheetCharacterId`). `placement` picks the top bar (hidden at 760 px and below) or the bar
 * under the map (shown only there).
 */
function SheetButton({ state, placement, onOpen }: { state: CombatPageState; placement: "top" | "bottom"; onOpen: OpenSheet }) {
  const tokens = useQuery(api.combatTokens.party, state.map && state.mode === "play" ? { campaignId: state.campaignId, mapId: state.map._id } : "skip");
  const characterId = tokens ? sheetCharacterId(state.role, tokens, state.selectedTokenId) : null;
  if (characterId === null) return null;
  const button = (
    <button
      type="button"
      className="cm-btn cm-sm"
      aria-haspopup="dialog"
      data-testid={`sheet-button-${placement}`}
      onClick={() => onOpen(characterId)}
    >
      Sheet
    </button>
  );
  return placement === "top" ? (
    <div className="max-[760px]:hidden">{button}</div>
  ) : (
    <div className="hidden justify-center py-2 max-[760px]:flex">{button}</div>
  );
}

/** Everything below the header that depends on the map on screen. */
function CombatBody({ campaign, role }: { campaign: CampaignSummary; role: CombatRole }) {
  const campaignId = campaign._id;
  const [selectedMapId, setSelectedMapId] = useState<Id<"combatMaps"> | null>(null);
  const [mode, setMode] = useState<CombatMode>("play");
  const [selectedTokenId, setSelectedTokenId] = useState<Id<"combatTokens"> | null>(null);
  const [previewCharacterId, setPreviewCharacterId] = useState<Id<"characters"> | null>(null);
  // The sheet drawer (SD0): mounted from its first open on and kept mounted, so closing returns focus to the button.
  const [sheet, setSheet] = useState<{ characterId: Id<"characters">; open: boolean } | null>(null);
  const openSheet: OpenSheet = (characterId) => setSheet({ characterId, open: true });
  const current = useCurrentMap({ campaignId, role, selectedMapId });

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

  return (
    <>
      <CombatHeader campaign={campaign} state={state} loading={current === undefined} onOpenSheet={openSheet} />
      <main className={role === "player" && !state.map ? "cm-main cm-solo" : "cm-main"}>
        {role === "gm" ? (
          <aside className="cm-aside" aria-label="Map tools">
            <GmColumn state={state} selectedMapId={selectedMapId} onSelectMap={selectMap} onMode={setMode} />
          </aside>
        ) : state.map ? (
          <aside className="cm-aside" aria-label="Your character">
            <PlayerColumn state={state} />
          </aside>
        ) : null}
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
          <SlotBoundary label="The Sheet button">
            <SheetButton state={state} placement="bottom" onOpen={openSheet} />
          </SlotBoundary>
        </div>
      </main>
      {sheet ? (
        <SlotBoundary label="The sheet drawer">
          <SheetDrawer
            campaignId={campaignId}
            role={role}
            map={state.map}
            characterId={sheet.characterId}
            open={sheet.open}
            onClose={() => setSheet({ ...sheet, open: false })}
          />
        </SlotBoundary>
      ) : null}
    </>
  );
}

/** The board's page header: campaign name, title, header line, light pill, GM Fear and the preview picker. */
function CombatHeader({ campaign, state, loading, onOpenSheet }: { campaign: CampaignSummary; state: CombatPageState; loading: boolean; onOpenSheet: OpenSheet }) {
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
        <SlotBoundary label="The Sheet button">
          <SheetButton state={state} placement="top" onOpen={onOpenSheet} />
        </SlotBoundary>
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
