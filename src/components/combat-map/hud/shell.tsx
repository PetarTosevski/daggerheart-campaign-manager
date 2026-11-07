"use client";

import "./hud.css";
import "./shell.css";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { MapBoard } from "../maps";
import type { CombatPageState, MapLayerProps } from "../slots";
import { HudActionRing } from "./action-ring";
import { HudAreas } from "./areas";
import { HudBanners } from "./banners";
import { HudDock, PlayerMapControls } from "./dock";
import { HudDeath } from "./death";
import { HudFear } from "./fear";
import { HudFeed } from "./feed";
import { HudHand } from "./hand";
import { HudHit } from "./hit";
import { usePanel } from "./panels";
import { HudPhone, PhoneQueueSheet, usePhoneHud } from "./phone";
import { HudPick, HudPickLayer, PickProvider } from "./pick";
import { HudAttack } from "./pick-attack";
import { HudAreaPick, HudAreaPickLayer } from "./pick-area";
import { HudQueue } from "./queue";
import { HudResolutions } from "./queue/resolutions";
import { HudResult } from "./result";
import { HudAllyPicks } from "./ally-picks";
import { HudScene } from "./scene";
import { HudSheet } from "./sheet";
import { HudSpotlight } from "./spotlight";
import { HudStatBlock } from "./statblock";
import { HudToasts } from "./toasts";
import { HudProvider, hudRootClasses, useHud } from "./state";
import { HudTools, MapToolsButton } from "./tools";
import { PartBoundary } from "./ui";

/**
 * The Combat HUD shell (plan combat-hud H0; HANDOFF "Layout"): a full-bleed map with the HUD over it. The map is the
 * classic `MapBoard` without its own toolbar (`chrome="none"`, plan combat-hud H9.0) with the same layers plus the
 * HUD's map layers (target rings, action ring); over it every HUD region mounts its part from `hud/<area>/index.tsx`,
 * each in its own boundary. The page shows the shell whenever the map is in Play (plan combat-hud H8.1: there is no
 * switch) and hands it the classic layers and the classic column for the "Map tools" drawer.
 *
 * Regions (desktop 1440 × 900; tablet and phone tracers move them):
 *   banners   top-left, x = 24          scene   title (+ a player's tools), x = 690      fear   top-right, right 24
 *   waiting   GM, bottom-left: the request queue ("Waiting on you", H9.2)
 *   left      player, bottom-left: the feed                               hand   bottom, with the toasts
 *   dock      GM, bottom centre: the only map toolbar (H9.0)              log    GM, bottom-right: Resolutions (Log)
 *   pop       anchored pop-ups (picking panel, result, hit window, death move, spotlight card, Areas)
 *   panel     the right sheet panel (PC sheet or adversary stat block)    tools  the left drawer
 * The GM's spotlight panel no longer mounts here: H9.1's spotlight disc hangs in the fear region.
 */

export type HudShellProps = {
  state: CombatPageState;
  /** `useCurrentMap` is still loading. */
  loading: boolean;
  /** The classic map layers (editor, tokens, vision, targets, hits). */
  renderLayers: (layer: MapLayerProps) => ReactNode;
  /** The drawer's content: the classic header tools and column, built by the page. */
  tools: ReactNode;
};

export function HudShell(props: HudShellProps) {
  return (
    <HudProvider>
      <PickProvider>
        <HudFrame {...props} />
      </PickProvider>
    </HudProvider>
  );
}

function Region({ name, children, className }: { name: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("hud-region", `hud-r-${name}`, className)} data-hud-region={name}>
      {children}
    </div>
  );
}

function HudFrame({ state, loading, renderLayers, tools }: HudShellProps) {
  const hud = useHud();
  const { role } = state;
  // H7.2: a player at phone width gets the phone shell (strip, bottom sheet) in place of the desktop regions.
  const phoneWidth = usePhoneHud();
  const phone = phoneWidth && role !== "gm";
  const gm = role === "gm";
  const panel = usePanel();
  // The title row's tools: a player's "Your character" drawer button and map controls (Measure, Names, zoom; Q9b). The
  // GM's are in the bottom dock (Map tools at its left end, Q4a).
  const toolbar = gm ? null : (
    <>
      <MapToolsButton role={role} />
      <PartBoundary label="Map controls">
        {/* Rule switches ODR3: with the campaign, Defined Ranges off hides the player's Measure button. */}
        <PlayerMapControls campaignId={state.campaignId} />
      </PartBoundary>
    </>
  );
  return (
    <div className={cn("hud-root", hudRootClasses(hud), phone && "hud-ph-on")} data-role={role} data-viewer={role === "gm" ? "gm" : "player"} data-testid="combat-hud">
      <h1 className="sr-only">Combat Map</h1>
      <div className="hud-map">
        {loading ? (
          <p role="status" className="hud-loading">
            Loading the map…
          </p>
        ) : (
          <PartBoundary label="The map">
            <MapBoard
              {...state}
              chrome="none"
              renderLayers={(layer) => (
                <>
                  {renderLayers(layer)}
                  {layer.mode === "play" ? (
                    <>
                      <PartBoundary label="Target rings">
                        <HudPickLayer {...layer} />
                      </PartBoundary>
                      <PartBoundary label="Square picking">
                        <HudAreaPickLayer {...layer} />
                      </PartBoundary>
                      <PartBoundary label="The action ring">
                        <HudActionRing {...layer} />
                      </PartBoundary>
                    </>
                  ) : null}
                </>
              )}
            />
          </PartBoundary>
        )}
      </div>

      <div className="hud-over">
        {phone ? (
          <Region name="phone">
            <PartBoundary label="The phone HUD">
              <HudPhone state={state} toolbar={toolbar} />
            </PartBoundary>
          </Region>
        ) : (
          <>
            <Region name="banners">
              <PartBoundary label="The party banners">
                <HudBanners state={state} />
              </PartBoundary>
            </Region>
            <Region name="scene">
              <PartBoundary label="The scene">
                <HudScene state={state} toolbar={toolbar} />
              </PartBoundary>
            </Region>
            <Region name="fear">
              <PartBoundary label="Fear">
                <HudFear state={state} />
              </PartBoundary>
            </Region>
          </>
        )}
        {gm ? (
          <>
            {/* The GM's queue, bottom-left ("Waiting on you", H9.2). `hud-r-left` keeps the left column's tablet and
                phone placement (responsive/*.css) until H9.2 / H9.6 place the new button. H7.2: at phone width the
                queue is a bottom sheet (answer 13a). */}
            <Region name="waiting" className="hud-r-left">
              <PhoneQueueSheet role={role}>
                <PartBoundary label="The request queue">
                  <HudQueue state={state} />
                </PartBoundary>
              </PhoneQueueSheet>
            </Region>
            {/* The GM's dock, bottom centre: the only map toolbar (GMDesktop `.dock`). */}
            <Region name="dock">
              <PartBoundary label="The dock">
                <HudDock state={state} />
              </PartBoundary>
            </Region>
            {/* Log: Resolutions with Undo above the dock on the right while the dock's Log is pressed (H9.2 styles it). */}
            <Region name="log">
              {panel === "log" ? (
                <PartBoundary label="Resolutions">
                  <div className="hud-log" id="hud-log" data-testid="hud-log">
                    <HudResolutions campaignId={state.campaignId} />
                  </div>
                </PartBoundary>
              ) : null}
            </Region>
          </>
        ) : (
          <Region name="left">
            {phone ? null : (
              <PartBoundary label="The feed">
                <HudFeed state={state} />
              </PartBoundary>
            )}
          </Region>
        )}
        {phone ? null : (
          <Region name="hand">
            <PartBoundary label="The hand">
              <HudHand state={state} />
            </PartBoundary>
            <PartBoundary label="Notices">
              <HudToasts state={state} />
            </PartBoundary>
          </Region>
        )}
        <Region name="pop">
          {role === "gm" ? null : (
            <PartBoundary label="The spotlight">
              <HudSpotlight state={state} />
            </PartBoundary>
          )}
          <PartBoundary label="The picking panel">
            <HudPick state={state} />
          </PartBoundary>
          <PartBoundary label="The attack prompts">
            <HudAttack state={state} />
          </PartBoundary>
          <PartBoundary label="Square picking">
            <HudAreaPick state={state} />
          </PartBoundary>
          <PartBoundary label="The result">
            <HudResult state={state} />
          </PartBoundary>
          <PartBoundary label="The ally picks">
            <HudAllyPicks state={state} />
          </PartBoundary>
          <PartBoundary label="The hit window">
            <HudHit state={state} />
          </PartBoundary>
          <PartBoundary label="The death move">
            <HudDeath state={state} />
          </PartBoundary>
          {role === "gm" ? (
            <PartBoundary label="Areas">
              <HudAreas state={state} />
            </PartBoundary>
          ) : null}
        </Region>
        <Region name="panel">
          <PartBoundary label="The sheet">
            <HudSheet state={state} />
          </PartBoundary>
          {role === "gm" ? (
            <PartBoundary label="The stat block">
              <HudStatBlock state={state} />
            </PartBoundary>
          ) : null}
        </Region>
      </div>

      <HudTools role={role} campaignId={state.campaignId}>
        {tools}
      </HudTools>
    </div>
  );
}
