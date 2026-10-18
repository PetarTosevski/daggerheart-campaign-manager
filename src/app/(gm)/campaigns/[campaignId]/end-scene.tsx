"use client";

import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * The GM's End scene button (RF1). CB 107: "At the GM's discretion, a scene
 * continues until the current narrative situation has played out." Ending it
 * clears every PC's scene-length effects (convex/scenes.ts). No query here, so
 * no error boundary is needed.
 */
export function EndScene({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const end = useIntent(api.scenes.end);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  if (!isGm) return null;

  async function run() {
    setConfirm(false);
    setReport(null);
    const result = await end.fire({ campaignId });
    if (result) setReport(result.ended > 0 ? `Scene ended: ${result.ended} scene effect${result.ended === 1 ? "" : "s"} ended.` : "Scene ended. No scene effects were active.");
  }

  return (
    <section aria-labelledby="scene-h" className="flex flex-col gap-3 rounded-[14px] border border-[#2a3a40] bg-[#141e22] p-5">
      <h2 id="scene-h" className="m-0 font-display text-[20px] font-bold text-parchment">
        Scene
      </h2>
      <p className="m-0 text-[14px] text-[#9fb2b6]">A scene lasts until its narrative situation has played out (CB 107).</p>
      <div className="flex flex-wrap gap-2.5">
        <BrandButton variant="outline" size="sm" disabled={end.pending} onClick={() => setConfirm(true)}>
          End scene
        </BrandButton>
      </div>
      <p className="m-0 text-[14px] text-[#c9d2cf]" aria-live="polite" role="status">
        {end.error ?? report ?? ""}
      </p>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="End the scene?" className="max-w-[480px]">
        <p className="m-0 text-[16px] text-[#c9d2cf]">Effects that last until the end of the scene end on every PC.</p>
        <div className="flex justify-end gap-2.5">
          <BrandButton variant="outline" size="sm" onClick={() => setConfirm(false)}>
            Cancel
          </BrandButton>
          <BrandButton variant="primary" size="sm" onClick={() => void run()}>
            End scene
          </BrandButton>
        </div>
      </Modal>
    </section>
  );
}
