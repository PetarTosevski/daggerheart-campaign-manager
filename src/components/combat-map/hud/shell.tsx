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
import { HudDeath } from "./death";
import { HudFear } from "./fear";
import { HudFeed } from "./feed";
import { HudHand } from "./hand";
import { HudHit } from "./hit";
import { HudPhone, PhoneQueueSheet, useNarrowHud, usePhoneHud } from "./phone";
import { HudPick, HudPickLayer, PickProvider } from "./pick";
import { HudAttack } from "./pick-attack";
import { HudAreaPick, HudAreaPickLayer } from "./pick-area";
import { HudQueue } from "./queue";
import { HudResult } from "./result";
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
 * classic `MapBoard` with the same layers plus the HUD's map layers (target rings, action ring); over it every HUD
 * region mounts its part from `hud/<area>/index.tsx`, each in its own boundary. The page shows the shell whenever the
 * map is in Play (plan combat-hud H8.1: there is no switch) and hands it the classic layers and the classic column for
 * the "Map tools" drawer.
 *
 * Regions (desktop 1440 × 900; tablet and phone tracers move them):
 *   banners   top-left, x = 24          scene   title + toolbar, x = 690       fear   top-right, right 24
 *   left      GM queue + Resolutions / player feed, left column          hand   bottom, with the toasts
 *   pop       anchored pop-ups (picking panel, result, hit window, death move, spotlight card, Areas)
 *   panel     the right sheet panel (PC sheet or adversary stat block)    tools  the left drawer
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
  // The GM's spotlight panel: top middle on desktop; in the left column (queue sheet on a phone) at tablet width and below.
  const spotInColumn = useNarrowHud();
  const phone = phoneWidth && role !== "gm";
  const toolbar = <MapToolsButton role={role} />;
  return (
    <div className={cn("hud-root", hudRootClasses(hud), phone && "hud-ph-on")} data-role={role} data-testid="combat-hud">
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
              {/* User 2026-11-03: the GM's spotlight panel sits top middle, under the title and GM tools (desktop only). */}
              {role === "gm" && !spotInColumn ? (
                <PartBoundary label="The spotlight">
                  <HudSpotlight state={state} />
                </PartBoundary>
              ) : null}
            </Region>
            <Region name="fear">
              <PartBoundary label="Fear">
                <HudFear state={state} />
              </PartBoundary>
            </Region>
          </>
        )}
        <Region name="left">
          {/* H7.2: the GM at phone width gets this column as a bottom sheet (answer 13a); otherwise it renders as is. */}
          <PhoneQueueSheet role={role}>
            {role === "gm" ? (
              <PartBoundary label="The request queue">
                <HudQueue state={state} />
              </PartBoundary>
            ) : null}
            {phone ? null : (
              <PartBoundary label="The feed">
                <HudFeed state={state} />
              </PartBoundary>
            )}
            {role === "gm" && spotInColumn ? (
              <PartBoundary label="The spotlight">
                <HudSpotlight state={state} />
              </PartBoundary>
            ) : null}
          </PhoneQueueSheet>
        </Region>
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
