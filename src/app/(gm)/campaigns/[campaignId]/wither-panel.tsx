"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { Modal } from "@/components/brand/modal";
import { SlotBoundary } from "@/components/party/session/boundary";
import { endDialogText, endReportLines, useWitherChoice, WitherChoiceField } from "@/components/sessions/live";
import { WITHER_POOL } from "@/lib/domain/wither";
import { frameHasMechanic } from "@/lib/frames";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../../../convex/campaigns";

/**
 * Witherwild's Wither Tokens panel on the dashboard (D10 S7, B12, K4; board CampaignHub.dc.html l.263-272): the tokens
 * on the PCs' sheets and the rest of the book's pool of about 20 (reference only, never a cap), the CB 261 rule, and for
 * the GM 'End Session · convert N to Fear', which opens the same End confirm as the Sessions live card and shows the
 * same End report (S3 `endReportLines`). The End runs `sessions.end` with every E2 effect, live session or not.
 */

function Panel({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const characters = useQuery(api.characters.listByCampaign, { campaignId });
  const current = useQuery(api.sessions.current, isGm ? { campaignId } : "skip");
  const end = useIntent(api.sessions.end);
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState<string[] | null>(null);
  const wither = useWitherChoice(campaignId);

  // Every PC's tokens clear at the End (E2), so every sheet counts.
  const total = characters?.reduce((sum, c) => sum + (c.corrupt ? 0 : (c.sheet.wither ?? 0)), 0);

  async function run() {
    setConfirm(false);
    setReport(null);
    const result = await end.fire({ campaignId, ...wither.args });
    if (result) setReport(endReportLines(result));
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="wither-h" className="m-0 font-display text-[22px] font-bold text-parchment">
          Wither Tokens
        </h2>
        {total === undefined ? (
          <span role="status" className="text-[15px] text-[#c9d8d2]">
            Loading…
          </span>
        ) : (
          <span className="wither-panel-count text-right text-[15px] text-[#c9d8d2]" data-testid="wither-panel-count">
            <strong className="text-[22px] text-[#e3d8ff]">{total}</strong> on sheets · {Math.max(0, WITHER_POOL - total)} in pool
          </span>
        )}
      </div>
      <p className="wither-panel-shadow m-0 text-[14px] leading-normal text-[#d2e0da]">
        At the end of each session, clear all Wither tokens from the PCs’ sheets and gain an equal amount of Fear.
      </p>
      {wither.applies && !wither.convert ? (
        <p className="wither-panel-shadow m-0 text-[14px] text-[#e3d8ff]">House rule: Wither stays on the sheets across sessions.</p>
      ) : null}
      {isGm ? (
        <button
          type="button"
          className="min-h-12 cursor-pointer rounded-[10px] border border-[#6b4f96] bg-[#2a2145] px-3 text-[15px] font-semibold text-[#efe8ff] hover:bg-[#352a57] disabled:cursor-default disabled:opacity-60"
          disabled={total === undefined || end.pending}
          onClick={() => {
            wither.reset();
            setConfirm(true);
          }}
        >
          {wither.convert ? `End Session · convert ${total ?? 0} to Fear` : "End Session · keep Wither"}
        </button>
      ) : null}
      {end.error ? (
        <p role="alert" className="m-0 text-[14px] text-[#f0a8a0]">
          {end.error}
        </p>
      ) : null}
      {isGm ? (
        <div role="status" aria-live="polite" className="wither-panel-shadow flex flex-col gap-1 text-[14px] text-[#e6ecea] empty:hidden">
          {report?.map((line, i) => (
            // A fixed list rebuilt whole on each End (never edited in place); lines may repeat, so the position is the key.
            <p key={i} className="m-0">
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {isGm ? (
        <Modal open={confirm} onClose={() => setConfirm(false)} title="End the session?" className="max-w-[480px]">
          <p className="m-0 text-[16px] text-[#c9d2cf]">
            {endDialogText(wither)}
            {current?.extraCharacters ? " Extra characters are no longer allowed; the ones in play stay active." : ""}
          </p>
          <div className="text-[15px] text-[#e6ecea]">
            <WitherChoiceField choice={wither} />
          </div>
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              className="min-h-11 cursor-pointer rounded-[10px] border border-[#33444a] bg-transparent px-4 text-[14px] text-[#e6ecea] hover:bg-white/5"
              onClick={() => setConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="min-h-11 cursor-pointer rounded-full border border-[#8e2b2b] bg-[#5a1f1f] px-5 text-[14px] font-semibold text-[#ffe9e6] hover:bg-[#6e2626]"
              onClick={() => void run()}
            >
              End session
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** The Wither Tokens panel; nothing for frames without Wither tokens. */
export function WitherPanel({ campaign }: { campaign: CampaignSummary }) {
  if (!frameHasMechanic(campaign.frameId, "witherTokens")) return null;
  return (
    <section aria-labelledby="wither-h" className="wither-panel flex flex-col gap-3 rounded-[14px] border border-[#2f4a3a] p-5">
      <span className="wither-spores" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
      <SlotBoundary fallback={<p className="m-0 text-[14px] text-[#d2e0da]">Wither tokens are unavailable. Reload the page.</p>}>
        <Panel campaignId={campaign._id} isGm={campaign.role === "gm"} />
      </SlotBoundary>
    </section>
  );
}
