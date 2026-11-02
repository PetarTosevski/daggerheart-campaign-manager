"use client";

import { useState } from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { SheetDrawer } from "../../drawer";
import type { CombatPageState } from "../../slots";
import { useHud } from "../state";
import { PartBoundary } from "../ui";

/**
 * Interim (plan combat-hud H1.1, until H2.1's sheet panel lands): the PC sheet HudProvider has open, shown in the
 * classic sheet drawer (`SheetDrawer`, a modal <dialog>). A banner opens it through `useHud().toggleSheet`; closing the
 * drawer (✕, Esc, the backdrop) closes it in HudProvider too, and the native dialog hands focus back to the banner.
 * Like the page's own drawer, it stays mounted after the first open so its dialog keeps its place. H2.1 deletes this
 * file and its mount in `index.tsx` when `HudSheet` reads `useHud().sheet` itself.
 */
export function ClassicSheetBridge({ state }: { state: CombatPageState }) {
  const hud = useHud();
  const characterId = hud.sheet?.kind === "pc" ? hud.sheet.characterId : null;
  // The last PC shown, so the closed drawer keeps its subject (derived during render, not copied in an effect).
  const [shown, setShown] = useState<Id<"characters"> | null>(null);
  if (characterId !== null && characterId !== shown) setShown(characterId);
  const subject = characterId ?? shown;
  if (subject === null) return null;
  return (
    <div className="hbn-sheet">
      <PartBoundary label="The sheet drawer">
        <SheetDrawer
          campaignId={state.campaignId}
          role={state.role}
          map={state.map}
          characterId={subject}
          open={characterId !== null}
          onClose={hud.closeSheet}
        />
      </PartBoundary>
    </div>
  );
}
