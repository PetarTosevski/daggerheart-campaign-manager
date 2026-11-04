"use client";

import type { ReactNode } from "react";

import type { HudPartProps } from "../state";
import { useHud } from "../state";
import { SheetPanel } from "./panel";

/**
 * The 400 px sheet panel on the right for the open PC (plan combat-hud H2.1; HANDOFF "Sheet panel"; boards Main
 * 'D · Sheet at hand', GMDesktop). A banner (H1.1) or a PC token (H1.3) opens it through `useHud().toggleSheet`; another
 * one swaps it, the same one, ✕ or Esc closes it. Not modal: the map beside it stays usable (H2.2 makes room). An
 * adversary's stat block is H5.2's (`hud/statblock`). The shell mounts this in its own PartBoundary (CL1).
 */
export const HudSheet: (props: HudPartProps) => ReactNode = ({ state }) => {
  const hud = useHud();
  const sheet = hud.sheet;
  if (sheet === null || sheet.kind !== "pc") return null;
  return <SheetPanel campaignId={state.campaignId} role={state.role} map={state.map} characterId={sheet.characterId} onClose={hud.closeSheet} />;
};
