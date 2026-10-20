// Luckbringer (Halfling, CB 64): "At the start of each session, everyone in your party gains a Hope."
// User decision U1: it stacks, one Hope per ACTIVE Halfling for every active PC, never above the Hope maximum (K6).
// Pure: bundled into Convex.
import { applyResourceDelta } from "../characters/index";
import type { CharacterSheet } from "../../validation/characters";
import { holdsLuckbringer } from "./holders";

/** The Hope every active PC gains at session start: the number of active Luckbringer holders among `activeSheets`. */
export function partyHope(activeSheets: readonly Pick<CharacterSheet, "ancestry">[]): number {
  return activeSheets.filter(holdsLuckbringer).length;
}

/**
 * Gives every sheet `partyHope(sheets)` Hope through `applyResourceDelta` (capped at `hopeMax`). Pass the ACTIVE
 * PCs only: they are both the givers and the receivers. Returns the sheets in the same order (unchanged ones as
 * they came) and the report note, e.g. "Luckbringer (Pip, Rosa): everyone gains 2 Hope"; no note without a holder.
 */
export function applyLuckbringer<T extends CharacterSheet>(sheets: readonly T[]): { sheets: T[]; hope: number; notes: string[] } {
  const holders = sheets.filter(holdsLuckbringer);
  const hope = holders.length;
  if (hope === 0) return { sheets: [...sheets], hope, notes: [] };
  return {
    sheets: sheets.map((s) => applyResourceDelta(s, "hope", hope)),
    hope,
    notes: [`Luckbringer (${holders.map((h) => h.name).join(", ")}): everyone gains ${hope} Hope`],
  };
}
