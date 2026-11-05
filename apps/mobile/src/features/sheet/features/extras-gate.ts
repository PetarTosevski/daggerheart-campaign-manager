import {
  BEASTBOUND_SUBCLASS_ID,
  DRUID_CLASS_ID,
  extrasFor,
  FRAME_OF,
} from "../../../../../../src/lib/frames/extras/common";

import type { SheetData } from "../types";

export function needsClassExtras(sheet: Pick<SheetData, "classId" | "subclassId">): boolean {
  return sheet.classId === DRUID_CLASS_ID || sheet.subclassId === BEASTBOUND_SUBCLASS_ID;
}

export function frameMayHaveExtras(frameId: string | undefined): boolean {
  if (!frameId) return false;
  return frameId === FRAME_OF.motherboard || frameId === FRAME_OF.beastFeast || frameId === FRAME_OF.castleHigh;
}

export function needsCharacterExtrasQuery(sheet: Pick<SheetData, "classId" | "subclassId">, frameId: string | undefined): boolean {
  if (needsClassExtras(sheet)) return true;
  if (!frameId) return false;
  return Object.values(extrasFor(frameId, sheet)).some(Boolean);
}
