"use client";

// The time arc's day icons (.tm-ic) and glow live in the dashboard's stylesheet (every class there is namespaced).
import "@/app/(gm)/campaigns/[campaignId]/dashboard.css";

import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { TimeArc } from "@/app/(gm)/campaigns/[campaignId]/time-arc";
import { LIGHT_LEVEL_LABEL } from "@/lib/domain/combat-map/light";
import { cn } from "@/lib/utils";

import type { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PartBoundary } from "../ui";
import { ScenePop } from "./pop";

/** What `combatHud.scene` returns: Fear, light, phase, day and what the caller may change. */
export type HudSceneData = FunctionReturnType<typeof api.combatHud.scene>;

/**
 * The day / time disc (plan combat-hud H1.2; Main / GMDesktop `.sun`, CmpTokens 'Light'): it hangs on a cord left of
 * the Fear banner and shows the campaign's light (Day / Dim / Night colours). In a frame with campaign time it also
 * reads "Day n" and the phase ("Afternoon"); for the GM there it is a button that opens the existing time arc with
 * End day (answer 9b, `scene.canOpenTimeArc`). Players, and every frame without campaign time, read it only.
 */

/** The disc's lines: "Day 3" + "Afternoon" with campaign time, else the light alone ("Dim"). */
export function discLines(scene: Pick<HudSceneData, "light" | "phase" | "day">): string[] {
  if (scene.day === null) return [LIGHT_LEVEL_LABEL[scene.light]];
  return [`Day ${scene.day.day}`, scene.phase ?? LIGHT_LEVEL_LABEL[scene.light]];
}

/** The disc's spoken name: the lines, the week and the light ("Week 1, Day 3, Afternoon, Day light"). */
export function discLabel(scene: Pick<HudSceneData, "light" | "phase" | "day">): string {
  const light = `${LIGHT_LEVEL_LABEL[scene.light]} light`;
  if (scene.day === null) return light;
  return [`Week ${scene.day.week}`, ...discLines(scene), light].join(", ");
}

const Sun = () => (
  <svg className="hud-sun-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <circle cx="8" cy="8" r="3.2" />
    <path
      d="M8 .8v2.2M8 13v2.2M.8 8H3M13 8h2.2M2.9 2.9l1.6 1.6M11.5 11.5l1.6 1.6M2.9 13.1l1.6-1.6M11.5 4.5l1.6-1.6"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

const TIME_ARC_POP = "hud-time-arc";

export function SceneDisc({ campaignId, scene }: { campaignId: Id<"campaigns">; scene: HudSceneData }) {
  const [open, setOpen] = useState(false);
  const lines = discLines(scene);
  const face = (
    <>
      <span className="hud-sun-cord" aria-hidden="true" />
      <span className={cn("hud-sun-disc", `hud-sun-${scene.light}`)} aria-hidden="true">
        <Sun />
      </span>
      <span className="hud-sun-text" aria-hidden="true">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
    </>
  );

  if (!scene.canOpenTimeArc) {
    return (
      <div className="hud-sun" role="img" aria-label={discLabel(scene)} data-testid="hud-disc">
        {face}
      </div>
    );
  }
  return (
    <div className="hud-sun" data-testid="hud-disc">
      <button
        type="button"
        className="hud-sun-btn"
        aria-label={`${discLabel(scene)}: open the time arc`}
        aria-expanded={open}
        aria-controls={TIME_ARC_POP}
        onClick={() => setOpen(!open)}
      >
        {face}
      </button>
      {open ? (
        <ScenePop id={TIME_ARC_POP} title="Time of the long cycle" onClose={() => setOpen(false)} className="hud-pop-time">
          <PartBoundary label="The time arc">
            <TimeArc campaignId={campaignId} />
          </PartBoundary>
        </ScenePop>
      ) : null}
    </div>
  );
}
