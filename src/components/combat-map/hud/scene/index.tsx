"use client";

import "./scene.css";

import { useQuery } from "convex/react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { EndSceneButton } from "../../actions/scene";
import { AreaTools } from "../../map-view/area-overlay";
import type { CombatMapSummary, CombatPageState } from "../../slots";
import { PreviewPicker, VisionPanel } from "../../vision";
import { sameSheet, useHud, type HudPartProps, type HudSheetTarget } from "../state";
import { PartBoundary, hudButtonClass } from "../ui";
import { HudDice } from "./dice";
import { LightSeg } from "./light";
import { ScenePop } from "./pop";

/** Props of the scene region: the page state plus the HUD toolbar the shell builds (Map tools, the classic switch). */
export type HudSceneProps = HudPartProps & { toolbar: ReactNode };

/**
 * The title and toolbar at x = 690 (plan combat-hud H1.2; Main `.title` / `.tr`, GMDesktop `.gtitle` / `.gtools`):
 * the map's name, the "Live" line (GM: "Live · GM view · Session n"), then for a player Dice and Sheet, for the GM
 * Day / Dim / Night (only where it can be set), Areas, Fog, Dice, Player view and End scene; both end with the shell's
 * toolbar (Map tools, answer 12a, and the classic switch). Dice, Areas and Fog open the app's existing dice box, area
 * tools and fog brush in a non-modal pop-over under the toolbar; Sheet opens the HUD sheet panel (H2.1).
 */

type PopName = "dice" | "areas" | "fog";
const POP_TITLE: Readonly<Record<PopName, string>> = { dice: "Dice", areas: "Areas", fog: "Vision and fog" };
const popId = (name: PopName) => `hud-pop-${name}`;

/** The title's second line: "Live" / "Not live", and for the GM "· GM view" and the live session's number. */
export function sceneLine(map: Pick<CombatMapSummary, "live"> | null, gm: boolean, session: number | null): string {
  const parts = [map === null ? "No live map yet" : map.live ? "Live" : "Not live"];
  if (gm) parts.push("GM view");
  if (gm && session !== null) parts.push(`Session ${session}`);
  return parts.join(" · ");
}

const DiceIcon = () => (
  <svg className="hud-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="5.5" cy="5.5" r="1.1" />
    <circle cx="10.5" cy="10.5" r="1.1" />
    <circle cx="8" cy="8" r="1.1" />
  </svg>
);

const SheetIcon = () => (
  <svg className="hud-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <rect x="3" y="1.5" width="10" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.5 5h5M5.5 8h5M5.5 11h3" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

const glassButton = cn(hudButtonClass(), "hud-glass-btn");

export function HudScene({ state, toolbar }: HudSceneProps): ReactNode {
  const gm = state.role === "gm";
  const [pop, setPop] = useState<PopName | null>(null);
  const party = useQuery(api.combatHud.party, state.map ? { campaignId: state.campaignId, mapId: state.map._id } : "skip");
  // The character Dice rolls for and Sheet opens: a player's own PC on the map; for the GM the selected PC token.
  const characterId = gm
    ? (party?.find((p) => p.tokenId === state.selectedTokenId)?.characterId ?? null)
    : (party?.find((p) => p.mine)?.characterId ?? null);

  const popButton = (name: PopName, label: ReactNode) => (
    <button
      type="button"
      className={glassButton}
      aria-expanded={pop === name}
      aria-controls={popId(name)}
      onClick={() => setPop(pop === name ? null : name)}
    >
      {label}
    </button>
  );
  const dice = popButton(
    "dice",
    <>
      <DiceIcon />
      Dice
    </>,
  );

  return (
    <div className={cn("hud-scene", gm && "hud-scene-gm")}>
      <SceneTitle state={state} />
      <div className="hud-tr" role="group" aria-label={gm ? "GM tools" : "Your tools"}>
        {gm ? (
          <>
            <PartBoundary label="Time of day">
              <GmLight campaignId={state.campaignId} />
            </PartBoundary>
            {state.map ? popButton("areas", "Areas") : null}
            {state.map ? popButton("fog", "Fog") : null}
            {dice}
            <PartBoundary label="Player view">
              <PreviewPicker {...state} />
            </PartBoundary>
            <EndSceneButton campaignId={state.campaignId} className={cn(glassButton, "hud-end")} />
          </>
        ) : party === undefined && state.map ? null : characterId ? (
          <>
            {dice}
            <SheetButton characterId={characterId} />
          </>
        ) : null}
        {toolbar}
      </div>
      {pop ? (
        <ScenePop id={popId(pop)} title={POP_TITLE[pop]} onClose={() => setPop(null)} className={`hud-pop-${pop}`}>
          <PartBoundary label={POP_TITLE[pop]}>
            <PopBody name={pop} state={state} characterId={characterId} />
          </PartBoundary>
        </ScenePop>
      ) : null}
    </div>
  );
}

function PopBody({ name, state, characterId }: { name: PopName; state: CombatPageState; characterId: Id<"characters"> | null }) {
  const { map } = state;
  if (name === "dice") return <HudDice campaignId={state.campaignId} characterId={characterId} gm={state.role === "gm"} />;
  if (map === null) return null;
  if (name === "areas") return <AreaTools campaignId={state.campaignId} mapId={map._id} />;
  return <VisionPanel {...state} map={map} />;
}

/** The map's name and the "Live" line (the board's `.title` / `.gtitle`). */
function SceneTitle({ state }: { state: CombatPageState }) {
  const gm = state.role === "gm";
  // The live session's number (Sessions hub), for the GM's line only.
  const sessions = useQuery(api.sessionWrap.dashboard, gm ? { campaignId: state.campaignId } : "skip");
  return (
    <div className="hud-title" data-testid="hud-title">
      <h2>{state.map?.name ?? "Combat Map"}</h2>
      <span>{sceneLine(state.map, gm, sessions?.live?.n ?? null)}</span>
    </div>
  );
}

/** Day / Dim / Night for the GM, hidden where the light can't be set (campaign time decides it, answer 9b). */
function GmLight({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const scene = useQuery(api.combatHud.scene, { campaignId });
  if (scene === undefined || !scene.canSetLight) return null;
  return <LightSeg campaignId={campaignId} light={scene.light} />;
}

/** "Sheet": your sheet in the HUD panel (H2.1 draws it from the HUD state); again closes it. */
function SheetButton({ characterId }: { characterId: Id<"characters"> }) {
  const { sheet, toggleSheet } = useHud();
  const target: HudSheetTarget = { kind: "pc", characterId };
  return (
    <button type="button" className={glassButton} aria-pressed={sameSheet(sheet, target)} data-testid="hud-sheet-button" onClick={() => toggleSheet(target)}>
      <SheetIcon />
      Sheet
    </button>
  );
}
