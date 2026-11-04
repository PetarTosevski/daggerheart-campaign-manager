"use client";

import { useState } from "react";

import { Modal } from "@/components/brand/modal";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/** What the status line says after the End scene button ran (`combatScenes.end`'s result). */
export function sceneReport(result: { ended: number; areas: number }): string {
  const parts = [
    result.ended > 0 ? `${result.ended} scene effect${result.ended === 1 ? "" : "s"} and limit${result.ended === 1 ? "" : "s"} ended` : "",
    result.areas > 0 ? `${result.areas} map area${result.areas === 1 ? "" : "s"} closed` : "",
  ].filter((p) => p !== "");
  return parts.length > 0 ? `Scene ended: ${parts.join(", ")}.` : "Scene ended. Nothing was lasting until the scene.";
}

/**
 * The GM's End scene button (plan sheet-drawer SD8, Q7; CB p.107: "At the GM's discretion, a scene continues until the
 * current narrative situation has played out"). Pressing it, after a confirmation, ends the scene for every PC:
 * scene-length effects, once-per-scene feature limits, the Unstoppable Die, the active stance and the scene's map areas
 * (`combatScenes.end`). Ending the running encounter does the same on its own. Mounted in the Encounter tab's top bar
 * (`className` "trk-btn") and meant for the Combat Map's GM column (`className` "cm-btn"; the mount is a one-line change
 * in actions/index.tsx `Resolutions`, outside SD8's files: docs/tasks/TASK-SD-SD8.md). It reads nothing, so it needs no
 * error boundary; the status span is the live region.
 */
export function EndSceneButton({ campaignId, className = "cm-btn" }: { campaignId: Id<"campaigns">; className?: string }) {
  const end = useIntent(api.combatScenes.end);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  async function run() {
    setConfirm(false);
    setReport(null);
    const result = await end.fire({ campaignId });
    if (result) setReport(sceneReport(result));
  }

  return (
    <>
      <button type="button" className={className} style={{ minHeight: 44 }} disabled={end.pending} onClick={() => setConfirm(true)}>
        End scene
      </button>
      <span className="text-[13px]" role="status" aria-live="polite" data-testid="end-scene-status">
        {end.error ?? report ?? ""}
      </span>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="End the scene?" className="max-w-[480px]">
        <p className="m-0 text-[16px]">Effects and limits that last until the end of the scene end for every character.</p>
        <div className="flex justify-end gap-2.5">
          <button type="button" className={className} style={{ minHeight: 44 }} onClick={() => setConfirm(false)}>
            Cancel
          </button>
          <button type="button" className={className} style={{ minHeight: 44 }} onClick={() => void run()}>
            End scene
          </button>
        </div>
      </Modal>
    </>
  );
}
