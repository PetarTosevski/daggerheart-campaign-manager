"use client";

import "./dock.css";

import { useQuery } from "convex/react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useMapControls, zoomLabel } from "../../map-view/controls";
import { useDefinedRanges } from "../../map-view/measure";
import type { CombatPageState } from "../../slots";
import { PreviewPicker, VisionPanel } from "../../vision";
import { closePanel, openPanel, usePanel, usePanelEscape, type HudPanel } from "../panels";
import { HudDice } from "../scene/dice";
import { HudEndScene } from "../scene/end";
import { ScenePop } from "../scene/pop";
import type { HudPartProps } from "../state";
import { MapToolsButton } from "../tools";
import { PartBoundary } from "../ui";
import { ContestPanel, useContestAllowed } from "./contest";

/**
 * The GM's bottom dock (plan combat-hud H9.0; GMDesktop / GMTablet `.dock`, HANDOFF "GM view": "the only toolbar"):
 *
 *   Map tools (user answer Q4a) | Select, Measure, Areas, Fog, Names | Zoom out, 91 % (fits the map), Zoom in |
 *   Dice, Contest (rule switches OP2: only while "Conflict between PCs" is on), Player view, Log | End scene
 *
 * Centred at the bottom; icon over a short label, icons only on a tablet and while a sheet is open (dock.css). Every
 * button is a real `<button>`: Select, Measure, Names, Areas and Log say `aria-pressed`; Map tools, Dice and Fog open a
 * panel and say `aria-expanded`. Its parts are the app's own: the zoom and Names drive the map board through
 * `map-view/controls.ts`; Dice and Fog open the existing dice box (`HudDice`) and fog card (`VisionPanel`) in a
 * non-modal pop-over above the dock; Player view is the existing `PreviewPicker`; End scene is `HudEndScene` (its
 * "End the scene?" confirm). Areas and Log open the `hud/panels.ts` entries ("areas", "log"), one GM panel at a time.
 *
 * The toolbar is named "Map controls" so the drawer's button keeps the name "Map tools" (Q4a).
 *
 * The player's map controls (`PlayerMapControls`, below) give a player Measure (Q9b), Names and the zoom in their own
 * title row: players have no dock.
 */

const ICON = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const SMALL = { ...ICON, width: 16, height: 16 } as const;

export const SelectIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <path d="M5 3l14 8-6 2-2 6Z" />
  </svg>
);
export const MeasureIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <rect x="2" y="8" width="20" height="8" rx="1.5" transform="rotate(-30 12 12)" />
    <path d="M8 9.5l1 1.7M11 7.8l1.5 2.6M14 6l1 1.7" />
  </svg>
);
const AreasIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </svg>
);
const FogIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <path d="M4 9h12M7 13h13M4 17h10" />
    <path d="M17 9a3 3 0 1 0-3-3" />
  </svg>
);
export const NamesIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <path d="M4 18 8.5 6h1L14 18M5.7 14h6.6M15 18v-6.5a2.5 2.5 0 0 1 5 0V18M15 15h5" />
  </svg>
);
export const ZoomOutIcon = () => (
  <svg {...SMALL} aria-hidden="true">
    <path d="M5 12h14" />
  </svg>
);
export const ZoomInIcon = () => (
  <svg {...SMALL} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const DiceIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="9" cy="9" r="1" fill="currentColor" />
    <circle cx="15" cy="15" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </svg>
);
const LogIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

/** Two figures facing each other: the Contest (rule switches OP2). */
const ContestIcon = () => (
  <svg {...ICON} aria-hidden="true">
    <circle cx="7" cy="6" r="2.2" />
    <circle cx="17" cy="6" r="2.2" />
    <path d="M7 9v6l-2 5M7 15l2 5M17 9v6l2 5M17 15l-2 5M7 11l4 1M17 11l-4 1" />
  </svg>
);
const CONTEST_POP_ID = "hud-dock-contest";

/** The dock's pop-overs (Dice, Fog): their element ids and titles. */
type DockPop = Extract<HudPanel, "dice" | "fog">;
const POP_TITLE: Readonly<Record<DockPop, string>> = { dice: "Dice", fog: "Vision and fog" };
export const dockPopId = (name: DockPop) => `hud-dock-${name}`;

/** One dock button: icon over a short label (the label hides visually, not from screen readers, in icon-only mode). */
function DockButton({
  icon,
  label,
  className,
  ...rest
}: { icon: ReactNode; label: string; className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type">) {
  return (
    <button type="button" className={cn("hud-dk-b", className)} title={label} {...rest}>
      {icon}
      <span className="hud-dk-l">{label}</span>
    </button>
  );
}

/** Opens `panel` from `button`, or closes it when it is the one shown. */
function toggle(panel: HudPanel, shown: boolean, button: HTMLElement) {
  if (shown) closePanel(panel);
  else openPanel(panel, button);
}

export function HudDock({ state }: HudPartProps): ReactNode {
  const panel = usePanel();
  usePanelEscape();
  const map = state.map;
  const pop: DockPop | null = panel === "dice" || panel === "fog" ? panel : null;
  // Rule switches OP2: the Contest pop-over (Conflict between PCs). Client state of the dock's own: it gives way to any
  // HUD panel (opening one hides it; opening it closes the open panel).
  const contestAllowed = useContestAllowed(state.campaignId);
  const [contestOpen, setContestOpen] = useState(false);
  const contestShown = contestAllowed && contestOpen && panel === null && map !== null;

  const popButton = (name: DockPop, icon: ReactNode, label: string) => (
    <DockButton
      icon={icon}
      label={label}
      aria-expanded={pop === name}
      aria-controls={dockPopId(name)}
      onClick={(e) => {
        setContestOpen(false);
        toggle(name, pop === name, e.currentTarget);
      }}
    />
  );

  return (
    <>
      <div className="hud-dock" role="toolbar" aria-label="Map controls" data-testid="hud-dock">
        <div className="hud-dk-g">
          <MapToolsButton role="gm" variant="dock" />
        </div>
        <div className="hud-dk-g">
          <PointerButtons campaignId={state.campaignId} />
          {map ? (
            <DockButton icon={<AreasIcon />} label="Areas" aria-pressed={panel === "areas"} onClick={(e) => toggle("areas", panel === "areas", e.currentTarget)} />
          ) : null}
          {map ? popButton("fog", <FogIcon />, "Fog") : null}
          <NamesButton />
        </div>
        <ZoomGroup className="hud-dk-g hud-dk-z" />
        <div className="hud-dk-g">
          {popButton("dice", <DiceIcon />, "Dice")}
          {map && contestAllowed ? (
            <DockButton
              icon={<ContestIcon />}
              label="Contest"
              aria-expanded={contestShown}
              aria-controls={CONTEST_POP_ID}
              data-testid="hud-dock-contest-btn"
              onClick={() => {
                if (contestShown) {
                  setContestOpen(false);
                  return;
                }
                closePanel();
                setContestOpen(true);
              }}
            />
          ) : null}
          {map ? (
            // The existing "Player view" menu; using it closes any other dock panel (its own menu closes on a press elsewhere).
            <div className="hud-dk-pv" onClickCapture={() => closePanel()}>
              <PartBoundary label="Player view">
                <PreviewPicker {...state} />
              </PartBoundary>
            </div>
          ) : null}
          <DockButton icon={<LogIcon />} label="Log" aria-pressed={panel === "log"} onClick={(e) => toggle("log", panel === "log", e.currentTarget)} />
        </div>
        <div className="hud-dk-endw" onClickCapture={() => closePanel()}>
          <HudEndScene campaignId={state.campaignId} sceneName={map?.name ?? "Combat Map"} className="hud-dk-end" />
        </div>
      </div>
      {pop ? (
        <ScenePop id={dockPopId(pop)} title={POP_TITLE[pop]} onClose={() => closePanel(pop)} className={`hud-dock-pop hud-pop-${pop}`}>
          <PartBoundary label={POP_TITLE[pop]}>
            <DockPopBody name={pop} state={state} />
          </PartBoundary>
        </ScenePop>
      ) : null}
      {contestShown && map ? (
        <ScenePop id={CONTEST_POP_ID} title="Contest" onClose={() => setContestOpen(false)} className="hud-dock-pop hud-pop-contest">
          <PartBoundary label="Contest">
            <ContestPanel campaignId={state.campaignId} mapId={map._id} />
          </PartBoundary>
        </ScenePop>
      ) : null}
    </>
  );
}

function DockPopBody({ name, state }: { name: DockPop; state: CombatPageState }) {
  if (name === "dice") return <GmDice state={state} />;
  if (state.map === null) return null;
  return <VisionPanel {...state} map={state.map} />;
}

/** The GM's Dice: the GM roller, and "For <PC>" while a PC token is selected (as the old toolbar's Dice). */
function GmDice({ state }: { state: CombatPageState }) {
  const party = useQuery(api.combatHud.party, state.map ? { campaignId: state.campaignId, mapId: state.map._id } : "skip");
  const characterId: Id<"characters"> | null = party?.find((p) => p.tokenId === state.selectedTokenId)?.characterId ?? null;
  return <HudDice campaignId={state.campaignId} characterId={characterId} gm />;
}

/**
 * Select (today's pointer, pressed by default) and Measure (drag between squares for the range band; Q9). Rule switches
 * ODR2: no Measure with Defined Ranges off (the map counts no squares; MeasureLayer draws nothing then either).
 */
function PointerButtons({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const { tool, setTool } = useMapControls();
  const definedRanges = useDefinedRanges(campaignId);
  return (
    <>
      <DockButton icon={<SelectIcon />} label="Select" aria-pressed={tool === "select" || (!definedRanges && tool === "measure")} onClick={() => setTool("select")} />
      {definedRanges ? <DockButton icon={<MeasureIcon />} label="Measure" aria-pressed={tool === "measure"} onClick={() => setTool(tool === "measure" ? "select" : "measure")} /> : null}
    </>
  );
}

/** Names: token names always shown (per viewer; N on the keyboard does the same). */
function NamesButton() {
  const { showNames, setShowNames } = useMapControls();
  return <DockButton icon={<NamesIcon />} label="Names" aria-pressed={showNames} onClick={() => setShowNames(!showNames)} />;
}

/** Zoom out, the zoom as a percentage (a press fits the map to the screen), Zoom in. */
function ZoomGroup({ className }: { className: string }) {
  const { zoom, zoomIn, zoomOut, fit } = useMapControls();
  return (
    <div className={className}>
      <button type="button" className="hud-dk-s" aria-label="Zoom out" onClick={zoomOut}>
        <ZoomOutIcon />
      </button>
      <button type="button" className="hud-dk-pct" aria-label="Fit the map to the screen" title="Fit the map to the screen" data-testid="combat-zoom" onClick={fit}>
        {zoomLabel(zoom)}
      </button>
      <button type="button" className="hud-dk-s" aria-label="Zoom in" onClick={zoomIn}>
        <ZoomInIcon />
      </button>
    </div>
  );
}

/**
 * A player's map controls (user answer Q9b: Measure for players too, on their own screen): Measure, Names and the zoom,
 * in the player's title row beside Dice and Sheet. The same store as the GM's dock. Rule switches ODR2: no Measure with
 * Defined Ranges off (`campaignId` given; without it the rule reads as on).
 */
export function PlayerMapControls({ campaignId }: { campaignId?: Id<"campaigns"> } = {}): ReactNode {
  const { tool, setTool } = useMapControls();
  const definedRanges = useDefinedRanges(campaignId);
  return (
    <div className="hud-pmc" role="toolbar" aria-label="Map controls" data-testid="hud-map-controls">
      {definedRanges ? <DockButton icon={<MeasureIcon />} label="Measure" aria-pressed={tool === "measure"} onClick={() => setTool(tool === "measure" ? "select" : "measure")} /> : null}
      <NamesButton />
      <ZoomGroup className="hud-pmc-z" />
    </div>
  );
}
