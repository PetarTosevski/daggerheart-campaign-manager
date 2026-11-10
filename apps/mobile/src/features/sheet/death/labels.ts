import { AWAY_REASON_LABELS } from "../../../../../../src/lib/domain/death/index";

import type { SheetSlotProps } from "../contract";

type SheetFlags = {
  conditions?: readonly string[];
  journeyEnds?: boolean;
};

export function sheetFlags(sheet: SheetSlotProps["character"]["sheet"]): SheetFlags {
  return sheet as SheetSlotProps["character"]["sheet"] & SheetFlags;
}

/** "Away · in the infirmary" / "Away · sent home" / "Away · benched". */
export function awayLabel(character: Pick<SheetSlotProps["character"], "away" | "benched">): string {
  return `Away${character.away ? ` · ${AWAY_REASON_LABELS[character.away.reason as keyof typeof AWAY_REASON_LABELS] ?? character.away.reason}` : character.benched ? " · benched" : ""}`;
}
