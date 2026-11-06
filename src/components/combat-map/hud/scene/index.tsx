"use client";

import "./scene.css";

import { useQuery } from "convex/react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CombatMapSummary, CombatPageState } from "../../slots";
import { sameSheet, useHud, type HudPartProps, type HudSheetTarget } from "../state";
import { PartBoundary, hudButtonClass } from "../ui";
import { HudDice } from "./dice";
import { HudEnvironmentLine } from "./environment";
import { ScenePop } from "./pop";

/** Props of the scene region: the page state plus a player's title-row tools the shell builds (Your character, map controls). */
export type HudSceneProps = HudPartProps & { toolbar: ReactNode };

/**
 * The scene at x = 690 (plan combat-hud H1.2, H9.3; GMDesktop / GMTablet `.scn`, Main `.title` / `.tr`).
 * - GM: the map's name and a "Live" chip only (HANDOFF "GM view": top centre is the scene title + Live chip). Every GM
 *   tool lives in the bottom dock (H9.0); the light is set from the day disc's pop-over (user answer Q6a, ./disc).
 * - Player: the map's name, the "Live" line and the title row: Dice, Sheet, then the shell's tools ("Your character")
 *   and, on a row of their own, the map controls (Measure, Names, zoom; Q9b).
 * Both fade while a sheet is open (the boards' `.sh-open .scn` / `.title, .tr`).
 */

const DICE_POP = "hud-pop-dice";

/** The scene's live state: "Live" / "Not live", or "No live map yet" before the GM shows one. */
export function sceneLine(map: Pick<CombatMapSummary, "live"> | null): string {
  return map === null ? "No live map yet" : map.live ? "Live" : "Not live";
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

const glassButton = cn(hudButtonClass("tool"), "hud-glass-btn");

export function HudScene({ state, toolbar }: HudSceneProps): ReactNode {
  if (state.role === "gm") {
    return (
      <div className="hud-scene hud-scene-gm">
        <GmTitle state={state} />
      </div>
    );
  }
  return <PlayerScene state={state} toolbar={toolbar} />;
}

/** The GM's scene pill (`.scn .sc-t`): the map's name and the Live chip. */
function GmTitle({ state }: { state: CombatPageState }) {
  const line = sceneLine(state.map);
  return (
    <div className="hud-title hud-scn" data-testid="hud-title">
      <h2>{state.map?.name ?? "Combat Map"}</h2>
      <span className={cn("hud-live", state.map?.live && "hud-live-on")} data-testid="hud-live">
        {state.map?.live ? <span className="hud-live-dot" aria-hidden="true" /> : null}
        {line}
      </span>
      {state.map?.live ? <HudEnvironmentLine campaignId={state.campaignId} /> : null}
    </div>
  );
}

function PlayerScene({ state, toolbar }: HudSceneProps) {
  const [dice, setDice] = useState(false);
  const party = useQuery(api.combatHud.party, state.map ? { campaignId: state.campaignId, mapId: state.map._id } : "skip");
  // The character Dice rolls for and Sheet opens: the player's own PC on the map.
  const characterId = party?.find((p) => p.mine)?.characterId ?? null;
  return (
    <div className="hud-scene hud-scene-pl">
      <div className="hud-title" data-testid="hud-title">
        <h2>{state.map?.name ?? "Combat Map"}</h2>
        <span>{sceneLine(state.map)}</span>
        {state.map?.live ? <HudEnvironmentLine campaignId={state.campaignId} /> : null}
      </div>
      <div className="hud-tr" role="group" aria-label="Your tools">
        {party === undefined && state.map ? null : characterId ? (
          <>
            <button type="button" className={glassButton} aria-expanded={dice} aria-controls={DICE_POP} onClick={() => setDice(!dice)}>
              <DiceIcon />
              Dice
            </button>
            <SheetButton characterId={characterId} />
          </>
        ) : null}
        {/* The map controls (`.hud-pmc`) take the second row: CSS orders them after this break. */}
        <span className="hud-tr-br" aria-hidden="true" />
        {toolbar}
      </div>
      {dice ? (
        <ScenePop id={DICE_POP} title="Dice" onClose={() => setDice(false)} className="hud-pop-dice">
          <PartBoundary label="Dice">
            <HudDice campaignId={state.campaignId} characterId={characterId} gm={false} />
          </PartBoundary>
        </ScenePop>
      ) : null}
    </div>
  );
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
