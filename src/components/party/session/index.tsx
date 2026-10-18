"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CampaignSlot } from "../slots";
import { SlotBoundary } from "./boundary";

// D5 temporary session buttons until D9 (T5). Contract: ../slots.ts.

type EndResult = { tokens: number; fearGained: number; fearLost: number; journeyEnds: { name: string }[] };

/** What the End told the GM: the Wither → Fear conversion (CB 261, capped at 12) and journeys that end (CB 106). */
function endReport(r: EndResult): string {
  const parts = [r.tokens > 0 ? `${r.tokens} Wither token${r.tokens === 1 ? "" : "s"} → +${r.fearGained} Fear${r.fearLost > 0 ? `, ${r.fearLost} Fear lost` : ""}.` : "Session ended."];
  if (r.journeyEnds.length > 0) parts.push(`Journey ends: ${r.journeyEnds.map((c) => c.name).join(", ")}.`);
  return parts.join(" ");
}

function Buttons({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const session = useQuery(api.sessions.current, { campaignId });
  const start = useIntent(api.sessions.start);
  const end = useIntent(api.sessions.end);
  const [extrasError, setExtrasError] = useState<string | null>(null);
  const allowExtras = useMutation(api.sessions.allowExtraCharacters).withOptimisticUpdate((store, { allow }) => {
    const current = store.getQuery(api.sessions.current, { campaignId });
    if (current) store.setQuery(api.sessions.current, { campaignId }, { ...current, extraCharacters: allow });
  });
  function toggleExtras(allow: boolean) {
    setExtrasError(null);
    allowExtras({ campaignId, allow, idempotencyKey: crypto.randomUUID() }).catch((e: unknown) => setExtrasError(errorMessage(e)));
  }
  const [confirm, setConfirm] = useState<"start" | "end" | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const started = session?.startedAt != null;

  async function run() {
    const which = confirm;
    setConfirm(null);
    setReport(null);
    if (which === "start") {
      if (await start.fire({ campaignId })) setReport("Session started.");
    } else if (which === "end") {
      const result = await end.fire({ campaignId });
      if (result) setReport(endReport(result));
    }
  }

  const error = start.error ?? end.error ?? extrasError;
  return (
    <section aria-labelledby="session-h" className="flex flex-col gap-3 rounded-[14px] border border-[#2a3a40] bg-[#141e22] p-5">
      <h2 id="session-h" className="m-0 font-display text-[20px] font-bold text-parchment">
        Session
      </h2>
      <p className="m-0 text-[14px] text-[#9fb2b6]">
        {session === undefined ? "Loading…" : started ? `In progress since ${new Date(session.startedAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "No session in progress."}
      </p>
      <div className="flex flex-wrap gap-2.5">
        <BrandButton variant="primary" size="sm" disabled={session === undefined || started || start.pending} onClick={() => setConfirm("start")}>
          Start session
        </BrandButton>
        <BrandButton variant="outline" size="sm" disabled={session === undefined || end.pending} onClick={() => setConfirm("end")}>
          End session
        </BrandButton>
      </div>
      {started ? (
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[14px] text-[#c9d2cf]">
          <input
            type="checkbox"
            role="switch"
            checked={session.extraCharacters}
            onChange={(e) => toggleExtras(e.target.checked)}
            className="size-4 flex-none accent-brand"
          />
          <span>
            Allow extra characters this session
            <span className="block text-[13px] text-[#9fb2b6]">Players may have more than one active character until the session ends. Characters made active stay active.</span>
          </span>
        </label>
      ) : null}
      <p className="m-0 text-[14px] text-[#c9d2cf]" aria-live="polite" role="status">
        {error ?? report ?? ""}
      </p>
      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === "end" ? "End the session?" : "Start the session?"} className="max-w-[480px]">
        <p className="m-0 text-[16px] text-[#c9d2cf]">
          {confirm === "end"
            ? `Session effects end, and every Wither token on the PCs' sheets becomes GM Fear (up to 12).${session?.extraCharacters ? " Extra characters are no longer allowed; the ones in play stay active." : ""}`
            : "Start-of-session features (such as Prayer Dice) are given out."}
        </p>
        <div className="flex justify-end gap-2.5">
          <BrandButton variant="outline" size="sm" onClick={() => setConfirm(null)}>
            Cancel
          </BrandButton>
          <BrandButton variant="primary" size="sm" onClick={() => void run()}>
            {confirm === "end" ? "End session" : "Start session"}
          </BrandButton>
        </div>
      </Modal>
    </section>
  );
}

/** The GM's Start / End session buttons on the dashboard (decision 12). */
export const SessionButtons: CampaignSlot = ({ campaignId, isGm }) =>
  isGm ? (
    <SlotBoundary fallback={<p className="m-0 text-[14px] text-[#c9d2cf]">Session buttons are unavailable. Reload the page.</p>}>
      <Buttons campaignId={campaignId} />
    </SlotBoundary>
  ) : null;
