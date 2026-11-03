"use client";

import "./tools.css";

import { PanelLeft } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { HandSharingSwitch } from "../../settings/hand-sharing";
import type { CombatRole } from "../../slots";
import { useHud } from "../state";
import { SidePanel, hudButtonClass } from "../ui";

/**
 * The HUD's left drawer (plan combat-hud H0, user answer 12a): today's left column behind a "Map tools" button (the GM's
 * at the left end of the bottom dock since H9.0, Q4a). For
 * the GM it holds Maps, Play / Edit, Combatants, the token card, adversary controls, Reveal, Vision, Resolutions, the
 * map style, sprite packs and the session chip; for a player it holds their view card and the token card (plan
 * combat-hud H8.1 moved the rest of the classic player column into the HUD). The page builds the content (it
 * owns the classic column); this file only frames it.
 */

/** The drawer's name: "Map tools" for the GM, "Your character" for a player (the classic column's names). */
export function toolsLabel(role: CombatRole): string {
  return role === "gm" ? "Map tools" : "Your character";
}

/**
 * Opens and closes the drawer. A player's sits in their title row (a glass button); the GM's is the first button of the
 * bottom dock (plan combat-hud H9.0, user answer Q4a: `variant="dock"`, icon over the label, icon only on a tablet).
 */
export function MapToolsButton({ role, variant = "glass" }: { role: CombatRole; variant?: "glass" | "dock" }) {
  const { toolsOpen, setToolsOpen } = useHud();
  if (variant === "dock") {
    return (
      <button
        type="button"
        className="hud-dk-b hud-dk-tools"
        title={toolsLabel(role)}
        aria-expanded={toolsOpen}
        aria-controls="hud-tools"
        onClick={() => setToolsOpen(!toolsOpen)}
      >
        <PanelLeft aria-hidden="true" className="size-[18px]" />
        <span className="hud-dk-l">{toolsLabel(role)}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={cn(hudButtonClass("tool"), "hud-glass-btn")}
      aria-expanded={toolsOpen}
      aria-controls="hud-tools"
      onClick={() => setToolsOpen(!toolsOpen)}
    >
      <PanelLeft aria-hidden="true" className="size-4" />
      {toolsLabel(role)}
    </button>
  );
}

/**
 * The left drawer itself: non-modal, Esc or ✕ closes it and focus goes back to the button. For the GM it ends with the
 * campaign switch "Players can see each other's cards" (F7-H4; the classic GM hand card held it until plan combat-hud
 * H8.1), given the campaign.
 */
export function HudTools({ role, campaignId, children }: { role: CombatRole; campaignId?: Id<"campaigns">; children: ReactNode }) {
  const { toolsOpen, setToolsOpen } = useHud();
  const label = toolsLabel(role);
  return (
    <div id="hud-tools" className="hud-tools">
      <SidePanel open={toolsOpen} onClose={() => setToolsOpen(false)} title={label} label={label} side="left" testId="hud-tools">
        {children}
        {role === "gm" && campaignId ? <HandSharingSwitch campaignId={campaignId} /> : null}
      </SidePanel>
    </div>
  );
}

/** The drawer's first row: the scene tools (light; for the GM Fear, session chip, map style, player view). */
export function ToolsHead({ children }: { children: ReactNode }) {
  return (
    <div className="hud-tools-head" role="group" aria-label="Scene tools">
      {children}
    </div>
  );
}
