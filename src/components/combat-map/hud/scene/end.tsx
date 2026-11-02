"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useId, useRef, useState } from "react";

import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { sceneReport } from "../../actions/scene";
import { PartBoundary, hudButtonClass } from "../ui";

/**
 * The HUD's End scene (plan combat-hud H5.3; GMDesktop 'End scene' `.dm.em`, CmpPromptsGM 'End the scene?'): the
 * toolbar button opens a modal "End the scene?" (native `<dialog>`, CL12) with the scene's name, what ends by name
 * (`combatHud.sceneEndPreview`, read only while it is open), and Keep playing / End the scene. End runs
 * `combatScenes.end` (one keyed intent, as the classic EndSceneButton) and its report shows in the toolbar's status
 * line (`sceneReport`, the classic wording).
 */

export type SceneEndPreview = FunctionReturnType<typeof api.combatHud.sceneEndPreview>;

/** The confirm's sentence: what ends by name, the limits that refresh, and what stays. */
export function sceneEndText(preview: SceneEndPreview): string {
  const names = [...new Set([...preview.effects, ...preview.areas])];
  const parts: string[] = [];
  parts.push(
    names.length > 0
      ? `Effects that last “until the end of the scene” end: ${names.join(", ")}.`
      : "Nothing lasts “until the end of the scene” right now.",
  );
  if (preview.limits > 0) parts.push(`${preview.limits} feature limit${preview.limits === 1 ? " refreshes" : "s refresh"}.`);
  parts.push("Fear, Hope, HP and Stress stay as they are. The players see a short summary.");
  return parts.join(" ");
}

export function HudEndScene({ campaignId, sceneName, className }: { campaignId: Id<"campaigns">; sceneName: string; className?: string }) {
  const end = useIntent(api.combatScenes.end);
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  async function run() {
    setOpen(false);
    setReport(null);
    const result = await end.fire({ campaignId });
    if (result) setReport(sceneReport(result));
  }

  return (
    <>
      <button type="button" className={cn(hudButtonClass(), "hud-glass-btn hud-end", className)} disabled={end.pending} onClick={() => setOpen(true)}>
        End scene
      </button>
      <span className="hud-end-status" role="status" aria-live="polite" data-testid="end-scene-status">
        {end.error ?? report ?? ""}
      </span>
      <EndSceneDialog open={open} campaignId={campaignId} sceneName={sceneName} onClose={() => setOpen(false)} onEnd={() => void run()} />
    </>
  );
}

function EndSceneDialog({
  open,
  campaignId,
  sceneName,
  onClose,
  onEnd,
}: {
  open: boolean;
  campaignId: Id<"campaigns">;
  sceneName: string;
  onClose: () => void;
  onEnd: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // The native dialog follows `open` (DOM only, as brand/modal.tsx): focus trap, Escape and the backdrop from the browser.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="hud-em"
      data-testid="hud-end-scene"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open ? (
        <>
          <span className="hud-em-k">{sceneName}</span>
          <h2 id={titleId}>End the scene?</h2>
          <PartBoundary label="What ends">
            <EndPreview campaignId={campaignId} />
          </PartBoundary>
          <div className="hud-em-f">
            <button type="button" className={hudButtonClass()} onClick={onClose}>
              Keep playing
            </button>
            <button type="button" className={cn(hudButtonClass("primary"), "hud-em-yes")} onClick={onEnd}>
              End the scene
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

function EndPreview({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const preview = useQuery(api.combatHud.sceneEndPreview, { campaignId });
  if (preview === undefined) {
    return (
      <p role="status" className="hud-em-p">
        Checking what ends…
      </p>
    );
  }
  return (
    <p className="hud-em-p" data-testid="hud-end-scene-text">
      {sceneEndText(preview)}
    </p>
  );
}
