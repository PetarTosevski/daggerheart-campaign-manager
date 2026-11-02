"use client";

import "./tools.css";

import { PanelLeft } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { CombatRole } from "../../slots";
import { setHudEnabled, useHudEnabled } from "../flag";
import { useHud } from "../state";
import { SidePanel, hudButtonClass } from "../ui";

/**
 * The HUD's left drawer (plan combat-hud H0, user answer 12a): today's left column behind a "Map tools" button. For
 * the GM it holds Maps, Play / Edit, Combatants, the token card, adversary controls, Reveal, Vision, Resolutions, the
 * map style, sprite packs and the session chip; for a player it holds their classic column (incoming hit, combat
 * actions, their view, the token card) until wave 9 moves those parts into the HUD. The page builds the content (it
 * owns the classic column); this file only frames it.
 */

/** The drawer's name: "Map tools" for the GM, "Your character" for a player (the classic column's names). */
export function toolsLabel(role: CombatRole): string {
  return role === "gm" ? "Map tools" : "Your character";
}

/** Opens and closes the drawer (the GM toolbar of H1.2 places it; until then the shell's toolbar does). */
export function MapToolsButton({ role }: { role: CombatRole }) {
  const { toolsOpen, setToolsOpen } = useHud();
  return (
    <button
      type="button"
      className={cn(hudButtonClass(), "hud-glass-btn")}
      aria-expanded={toolsOpen}
      aria-controls="hud-tools"
      onClick={() => setToolsOpen(!toolsOpen)}
    >
      <PanelLeft aria-hidden="true" className="size-4" />
      {toolsLabel(role)}
    </button>
  );
}

/** The left drawer itself: non-modal, Esc or ✕ closes it and focus goes back to the button. */
export function HudTools({ role, children }: { role: CombatRole; children: ReactNode }) {
  const { toolsOpen, setToolsOpen } = useHud();
  const label = toolsLabel(role);
  return (
    <div id="hud-tools" className="hud-tools">
      <SidePanel open={toolsOpen} onClose={() => setToolsOpen(false)} title={label} label={label} side="left" testId="hud-tools">
        {children}
      </SidePanel>
    </div>
  );
}

/** The drawer's first row: the classic header's tools (Fear, light, session chip, map style, player view, Sheet). */
export function ToolsHead({ children }: { children: ReactNode }) {
  return (
    <div className="hud-tools-head" role="group" aria-label="Scene tools">
      {children}
    </div>
  );
}

/**
 * The opt-in switch's toggle (answer 11b), on both views: "Try the new combat HUD" on the classic page, "Back to the
 * classic view" with the HUD on. Wave 9 (H8.1) deletes it with the switch.
 */
export function HudSwitchButton({ className }: { className?: string }) {
  const enabled = useHudEnabled();
  return (
    <button
      type="button"
      className={className ?? cn(hudButtonClass(), "hud-glass-btn")}
      data-testid="hud-switch"
      onClick={() => setHudEnabled(!enabled)}
    >
      {enabled ? "Back to the classic view" : "Try the new combat HUD"}
    </button>
  );
}
