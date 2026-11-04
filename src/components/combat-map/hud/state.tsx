"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { Id } from "../../../../convex/_generated/dataModel";
import type { CombatPageState, MapLayerProps } from "../slots";

/** What every HUD region part gets from the shell: the page state (map may be null before the first live map). */
export type HudPartProps = { state: CombatPageState };

/** What every HUD map layer part gets (drawn inside the map stage, like the classic layers). */
export type HudLayerProps = MapLayerProps;

/**
 * Client state the HUD parts share (plan combat-hud H0): which sheet is open, the active pick session slot, the
 * drawer, and the root classes the HUD keys its layout on (the boards' `sh-open sh-<id>`, HANDOFF "Interactive boards:
 * state model", under a `hud-` prefix: see `hudRootClasses`). Nothing here comes from the server; engine state reaches
 * the parts through their own queries.
 */

/** The sheet panel's subject: a PC's sheet (banners, PC tokens) or an adversary's stat block (GM, enemy tokens). */
export type HudSheetTarget =
  | { kind: "pc"; characterId: Id<"characters"> }
  | { kind: "adversary"; tokenId: Id<"combatTokens"> };

/**
 * The one active pick session (HANDOFF "The picking pattern"). H3.0 owns the session itself (source, rule, rows,
 * options, primary); this slot only says one is open, so other parts can step aside (the action ring closes, the
 * hand lowers) and a second picker cannot open over it.
 */
export type HudPickSlot = {
  /** Stable id of the session (the picker's own, e.g. "card:<cardId>"). */
  id: string;
  /** The token the panel anchors beside (42 px right of it), null for an area pick. */
  anchorTokenId: Id<"combatTokens"> | null;
};

export type HudState = {
  sheet: HudSheetTarget | null;
  /** Opens `target`'s sheet; the same target again closes it, another one swaps it (HANDOFF "Sheet panel"). */
  toggleSheet: (target: HudSheetTarget) => void;
  closeSheet: () => void;
  pick: HudPickSlot | null;
  /** Starts a pick session (replacing any other) or ends it with null. */
  setPick: (pick: HudPickSlot | null) => void;
  /** The left "Map tools" drawer (the classic column until its parts move into the HUD). */
  toolsOpen: boolean;
  setToolsOpen: (open: boolean) => void;
};

const HudContext = createContext<HudState | null>(null);

export function sameSheet(a: HudSheetTarget | null, b: HudSheetTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "pc" && b.kind === "pc") return a.characterId === b.characterId;
  if (a.kind === "adversary" && b.kind === "adversary") return a.tokenId === b.tokenId;
  return false;
}

/** The id a sheet target gets in the root class `hud-sh-<id>`: the character or token id. */
export function sheetKey(target: HudSheetTarget): string {
  return target.kind === "pc" ? target.characterId : target.tokenId;
}

/**
 * The HUD root's state classes: `hud-sh-open hud-sh-<id>` while a sheet is open (the map makes room, the
 * Fear banner, hand and pop-ups shift; HANDOFF "Layout"; shell.css), `hud-pk-open` during a pick session,
 * `hud-tl-open` while the tools drawer is open. The boards call the first two `sh-open sh-<Name>`, but the party
 * sheet's sheet-ui.css styles a global `.sh-open` as a pill button, so the HUD's classes all carry the `hud-` prefix
 * (plan combat-hud H2.2, dcm-bxp.99.32.11).
 */
export function hudRootClasses(state: Pick<HudState, "sheet" | "pick" | "toolsOpen">): string {
  const classes: string[] = [];
  if (state.sheet) classes.push("hud-sh-open", `hud-sh-${sheetKey(state.sheet)}`);
  if (state.pick) classes.push("hud-pk-open");
  if (state.toolsOpen) classes.push("hud-tl-open");
  return classes.join(" ");
}

/** Holds the HUD state for everything under it (the shell mounts it once). */
export function HudProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<HudSheetTarget | null>(null);
  const [pick, setPick] = useState<HudPickSlot | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const value = useMemo<HudState>(
    () => ({
      sheet,
      toggleSheet: (target) => setSheet((open) => (sameSheet(open, target) ? null : target)),
      closeSheet: () => setSheet(null),
      pick,
      setPick,
      toolsOpen,
      setToolsOpen,
    }),
    [sheet, pick, toolsOpen],
  );
  return <HudContext.Provider value={value}>{children}</HudContext.Provider>;
}

/** The HUD state; throws outside `HudProvider` (a HUD part mounted by the classic page is a bug). */
export function useHud(): HudState {
  const state = useContext(HudContext);
  if (state === null) throw new Error("useHud() needs a <HudProvider> (the HUD shell mounts it).");
  return state;
}
