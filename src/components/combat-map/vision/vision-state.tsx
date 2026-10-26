"use client";

import { createContext, useContext, useState } from "react";

import type { ProviderProps } from "../slots";
import type { FogMark } from "./use-vision";

/** The GM's fog brush (R12): off, or the mark it paints, and its size in squares (the board's 1 / 2 / 3). */
export type FogTool = "off" | FogMark;
export type FogBrush = 1 | 2 | 3;

type VisionStateValue = {
  fogTool: FogTool;
  setFogTool: (tool: FogTool) => void;
  brush: FogBrush;
  setBrush: (brush: FogBrush) => void;
};

const VisionState = createContext<VisionStateValue | null>(null);

/**
 * Slot `VisionProvider`: the state the "Vision & fog" card shares with the map layer (the fog brush and its size).
 * The previewed PC is page state (`CombatPageState.previewCharacterId`); explored areas are synced by the layer.
 */
export function VisionProvider({ children }: ProviderProps) {
  const [fogTool, setFogTool] = useState<FogTool>("off");
  const [brush, setBrush] = useState<FogBrush>(1);
  return <VisionState.Provider value={{ fogTool, setFogTool, brush, setBrush }}>{children}</VisionState.Provider>;
}

export function useVisionState(): VisionStateValue {
  const value = useContext(VisionState);
  if (value === null) throw new Error("useVisionState() needs the VisionProvider (the combat map page mounts it).");
  return value;
}
