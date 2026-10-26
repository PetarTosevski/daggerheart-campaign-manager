"use client";

import { useMutation, useQuery } from "convex/react";
import { memo, useState, type CSSProperties } from "react";

import { SlotBoundary } from "@/components/party/session/boundary";
import { errorMessage } from "@/lib/convex-errors";
import { MAX_FEAR } from "@/lib/domain/fear";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

// Token spiral, glow and smoke from the CampaignHub board's GM Fear panel.
const SPOTS = Array.from({ length: MAX_FEAR }, (_, i) => {
  const a = ((i * 42 - 90) * Math.PI) / 180;
  const r = 44 - i * 2.4;
  return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a), size: 15 - i * 0.5 };
});
const TILT = [-8, 6, -3, 10, -12, 4, 9, -6, 2, -10, 7, -4];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const points = SPOTS.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`);

function coreFilter(n: number): string {
  const t = n / MAX_FEAR;
  return (
    `grayscale(${(1 - t).toFixed(2)}) brightness(${(0.22 + 0.78 * t).toFixed(2)}) ` +
    `drop-shadow(0 0 ${(1 + 14 * t).toFixed(1)}px rgba(166, 120, 240, ${(0.9 * t).toFixed(2)}))` +
    (n >= MAX_FEAR ? " drop-shadow(0 0 16px rgba(255, 120, 30, 0.9)) sepia(0.25)" : "")
  );
}

/**
 * The dashboard's GM Fear panel. It reads its own small query (PF7), so a Fear click re-renders this panel and nothing
 * else on the page; a failing read leaves the rest of the dashboard standing (CL1).
 */
export const FearPanel = memo(function FearPanel(props: { campaignId: Id<"campaigns">; readOnly?: boolean }) {
  return (
    <SlotBoundary fallback={<p className="m-0 text-[14px] text-[#f0a8a0]">GM Fear could not be loaded.</p>}>
      <FearTokens {...props} />
    </SlotBoundary>
  );
});

function FearTokens({ campaignId, readOnly = false }: { campaignId: Id<"campaigns">; readOnly?: boolean }) {
  const loaded = useQuery(api.campaigns.fear, { campaignId });
  const fear = loaded ?? 0;
  // A token click shows the new Fear at once (CL3: the value is the intent; the server checks the range).
  const run = useMutation(api.fear.set).withOptimisticUpdate((store, args) => {
    store.setQuery(api.campaigns.fear, { campaignId: args.campaignId }, args.value);
  });
  const [error, setError] = useState<string | null>(null);
  async function setFear(value: number) {
    setError(null);
    try {
      await run({ campaignId, value, idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const t = fear / MAX_FEAR;

  return (
    <section
      aria-labelledby="fear-h"
      className="keeper-panel flex flex-col items-center gap-2.5 overflow-hidden rounded-[14px] border border-[#3b2f5c] p-5"
    >
      <div className="flex items-baseline justify-between gap-3 self-stretch">
        <h2 id="fear-h" className="m-0 font-display text-[22px] font-bold text-[#e3d8ff]">
          GM Fear
        </h2>
        {readOnly ? null : <span className="text-[13px] text-[#9a8cc4]">Click a token to set</span>}
      </div>
      <div className="relative aspect-square w-full max-w-[330px]">
        <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" className="absolute inset-0">
          <polyline points={points.join(" ")} fill="none" stroke="#3a2d5e" strokeWidth="0.8" strokeDasharray="1.5 1.5" />
          <polyline
            points={points.slice(0, fear).join(" ")}
            fill="none"
            stroke="#c9b3ff"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: "drop-shadow(0 0 1.5px #a68cf0) drop-shadow(0 0 3px #8f6fe0)" }}
          />
        </svg>
        <span className="fear-fog" aria-hidden="true" style={{ opacity: Math.max(0, ((fear - 2) / 10) * 0.6) }} />
        {SPOTS.map((spot, k) => {
          const value = k + 1;
          const style: CSSProperties = {
            width: `${spot.size}%`,
            height: `${spot.size}%`,
            left: `${(spot.x - spot.size / 2).toFixed(2)}%`,
            top: `${(spot.y - spot.size / 2).toFixed(2)}%`,
            rotate: `${TILT[k]}deg`,
          };
          return (
            <button
              key={k}
              type="button"
              aria-label={`Fear ${value} of ${MAX_FEAR}`}
              aria-pressed={k < fear}
              className={`fz ${k < fear ? "fz-on" : "fz-off"}`}
              style={readOnly ? { ...style, cursor: "default" } : style}
              disabled={readOnly || loaded === undefined}
              // Clicking the top lit token lowers Fear by one, as on the board.
              onClick={() => void setFear(value === fear ? k : value)}
            />
          );
        })}
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-[2] flex w-[22%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5">
          <span className="fear-core" aria-hidden="true">
            {fear > 0 ? (
              <>
                <span
                  className="fear-haze"
                  style={{ width: `${120 + fear * 17}%`, opacity: 0.32 + 0.68 * t }}
                />
                <span
                  className="fear-smoke"
                  style={{ opacity: 0.62 + 0.38 * t, transform: `scale(${0.72 + 0.52 * t})`, transformOrigin: "50% 100%" }}
                >
                  {Array.from({ length: Math.min(10, fear + 1) }, (_, i) => (
                    <span key={i} />
                  ))}
                </span>
              </>
            ) : null}
            {fear >= MAX_FEAR ? (
              <span className="fear-fire">
                <span />
                <span />
                <span />
                <span />
                <span />
              </span>
            ) : null}
            <span className="fz-big relative z-[1] h-full w-full" style={{ filter: coreFilter(fear) }} />
          </span>
          <span
            className="font-display text-[22px] leading-none font-black tracking-[0.04em] text-[#efe8ff]"
            aria-label={`${fear} of ${MAX_FEAR} Fear`}
            data-testid="fear-value"
          >
            {fear === 0 ? "—" : ROMAN[fear - 1]}
          </span>
        </div>
      </div>
      <p role="status" aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {error}
      </p>
    </section>
  );
}
