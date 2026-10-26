"use client";

import { useQuery } from "convex/react";
import type { CSSProperties } from "react";

import { getPhaseName, monthOf, weekInMonth } from "@/lib/domain/campaign-time";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

// Geometry and sky colours from the CampaignHub board's "time of the long cycle".
type SkyPath = { d: string; f: string; s: string; w: number; o: number };

const sf = (n: number) => Number(n.toFixed(2));
const circle = (cx: number, cy: number, r: number) =>
  `M ${sf(cx - r)} ${sf(cy)} a ${r} ${r} 0 1 0 ${sf(2 * r)} 0 a ${r} ${r} 0 1 0 ${sf(-2 * r)} 0 Z`;
const crescent = (cx: number, cy: number, r: number, k: number) =>
  `M ${sf(cx)} ${sf(cy - r)} A ${r} ${r} 0 1 0 ${sf(cx)} ${sf(cy + r)} A ${sf(r * k)} ${r} 0 1 1 ${sf(cx)} ${sf(cy - r)} Z`;
const dots = (pts: [number, number][]) => pts.map(([x, y]) => `M ${x} ${y} l 0.01 0`).join(" ");
const path = (d: string, f = "none", s = "none", w = 0, o = 1): SkyPath => ({ d, f, s, w, o });

const SUN_POS: [number, number][] = [[9, 40], [13, 33], [17, 22], [24, 13], [31, 22], [35, 33], [39, 41]];
const SKY_DAY = [["#2c2a55", "#e98a6b"], ["#7fb5e6", "#f6b26b"], ["#8ec5f0", "#e3f2ff"], ["#2f7fd6", "#a9d4ff"], ["#6ba8e0", "#f3d7a0"], ["#7a2e5c", "#f07a3c"], ["#141a44", "#4a3a7a"]];
const SKY_NIGHT = [["#0f1230", "#3a2d63"], ["#141a40", "#3a3060"], ["#080b22", "#141a3d"], ["#03051a", "#0d1230"], ["#140826", "#3a1458"], ["#0e1430", "#22305a"], ["#1c2a5a", "#8a6a9a"]];
const SUN_FILL = ["#ffd1a8", "#ffc36b", "#fff2b8", "#ffffff", "#ffe08a", "#ff8a4a", "#ff9a6a"];
const GLOW_FILL = ["#ffb38a", "#ffc36b", "#fff2b8", "#ffffff", "#ffe08a", "#ff7a3a", "#ff9a6a"];
const MOON_PHASE = [0.75, 0.55, 0.3, 0, 0.35, 0.55, 0.8];
const HORIZON = 34;

function sky(night: boolean, k: number) {
  const [top, bottom] = (night ? SKY_NIGHT : SKY_DAY)[k];
  const [x, y] = SUN_POS[k];
  const body = night
    ? path(k === 3 ? circle(24, 16, 7) : crescent(x, y, 6, MOON_PHASE[k]), k === 4 ? "#d9b8ff" : "#eef1ff")
    : path(circle(x, y, k === 3 ? 7 : 6), SUN_FILL[k]);
  const glow = night ? null : path(circle(x, y, k === 3 ? 12 : 10), GLOW_FILL[k], "none", 0, 0.25);
  const stars =
    night || k === 6 || k === 0
      ? path(dots([[8, 10], [38, 8], [30, 20], [14, 24], [42, 22]]), "none", "#ffffff", 1.6, k === 6 ? 0.5 : 0.9)
      : null;
  const ground = path(
    `M 0 ${HORIZON} Q 12 ${HORIZON - 3} 24 ${HORIZON} T 48 ${HORIZON - 1} V 48 H 0 Z`,
    night ? "#05060f" : "#1c2a1a",
  );
  const cloud =
    night && k === 4
      ? path("M 10 26 a 4 4 0 0 1 6 -4 a 5 5 0 0 1 9 2 a 3.5 3.5 0 0 1 0 7 H 12 a 3 3 0 0 1 -2 -5 Z", "#2a1a40", "none", 0, 0.9)
      : null;
  return {
    background: `linear-gradient(180deg, ${top}, ${bottom})`,
    paths: [glow, body, cloud, stars, ground].filter((p): p is SkyPath => p !== null),
  };
}

const arcPoint = (k: number): [number, number] => {
  const angle = Math.PI - (k * Math.PI) / 6;
  return [280 + 230 * Math.cos(angle), 165 - 230 * Math.sin(angle) * 0.62];
};

function progressPath(day: number) {
  const points = Array.from({ length: 25 }, (_, j) => {
    const a = Math.PI - (j / 24) * (((day - 1) * Math.PI) / 6);
    return `${(280 + 230 * Math.cos(a)).toFixed(1)} ${(165 - 230 * Math.sin(a) * 0.62).toFixed(1)}`;
  });
  return `M ${points.join(" L ")}`;
}

/** The Witherwild 7-phase arc in the dashboard header. Only rendered for frames with campaign time. */
export function TimeArc({ campaignId, readOnly = false }: { campaignId: Id<"campaigns">; readOnly?: boolean }) {
  const time = useQuery(api.campaignTime.get, { campaignId });
  const advance = useIntent(api.campaignTime.advance);
  const setDay = useIntent(api.campaignTime.setDay);

  if (time === undefined) return <div className="h-[230px]" aria-busy="true" />;

  const night = time.cycle === "NIGHT";
  const c1 = night ? "#2b2f6b" : "#9a5a1a";
  const c2 = night ? "#a9b8ff" : "#ffcf6a";
  const error = advance.error ?? setDay.error;

  return (
    <section aria-label="Time of the long cycle" className="flex w-full max-w-[600px] flex-col items-center gap-1.5 self-center">
      <div className="relative aspect-[560/170] w-full max-w-[560px]">
        <svg viewBox="0 0 560 170" width="100%" height="100%" aria-hidden="true" className="absolute inset-0 overflow-visible">
          <defs>
            <linearGradient id="tmArc" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={c1} />
              <stop offset="0.5" stopColor={c2} />
              <stop offset="1" stopColor={c1} />
            </linearGradient>
          </defs>
          <path d="M 50 165 A 230 142.6 0 0 1 510 165" fill="none" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="14" strokeLinecap="round" />
          <path d="M 50 165 A 230 142.6 0 0 1 510 165" fill="none" stroke="url(#tmArc)" strokeWidth="4" strokeLinecap="round" opacity="0.9" />
          <path d={progressPath(time.cycleDay)} fill="none" stroke={c2} strokeWidth="8" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${c2})` }} />
          <line x1="20" y1="166" x2="540" y2="166" stroke="rgba(255, 255, 255, 0.25)" strokeWidth="1" />
        </svg>
        {Array.from({ length: 7 }, (_, k) => {
          const day = k + 1;
          const [x, y] = arcPoint(k);
          const current = day === time.cycleDay;
          const past = day < time.cycleDay;
          const window = sky(night, k);
          const style: CSSProperties & { "--g"?: string } = {
            left: `${(x / 5.6).toFixed(2)}%`,
            top: `${(y / 1.7).toFixed(2)}%`,
            background: window.background,
            border: `${current ? 3 : 2}px solid ${night ? "#8a93c9" : "#c9a24a"}`,
            ...(current
              ? {
                  "--g": night ? "rgba(150, 170, 255, 0.85)" : "rgba(255, 190, 80, 0.9)",
                  animation: "tmglow 2.4s ease-in-out infinite",
                  width: 68,
                  height: 68,
                  margin: "-34px 0 0 -34px",
                  zIndex: 2,
                }
              : { boxShadow: "0 3px 8px rgba(0, 0, 0, 0.55)" }),
            ...(past || current ? {} : { filter: "saturate(0.55) brightness(0.7)" }),
          };
          const label = `Day ${day}: ${getPhaseName(time.cycle, day)}`;
          return (
            <button
              key={k}
              type="button"
              className="tm-ic"
              aria-label={label}
              title={label}
              aria-current={current ? "step" : undefined}
              disabled={readOnly || setDay.pending || advance.pending}
              onClick={() => {
                if (!current) void setDay.fire({ campaignId, cycleDay: day });
              }}
              style={style}
            >
              <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true" className="absolute inset-0">
                {window.paths.map((p, i) => (
                  <path key={i} d={p.d} fill={p.f} stroke={p.s} strokeWidth={p.w} opacity={p.o} strokeLinecap="round" strokeLinejoin="round" />
                ))}
              </svg>
            </button>
          );
        })}
        <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-col items-center gap-0.5 text-center">
          <span className="text-[11px] tracking-[0.24em] text-[#e6ecea] uppercase opacity-80 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]">
            {night ? "The Long Night" : "The Long Day"}
          </span>
          <span
            className="font-display text-[22px] font-black tracking-[0.06em] [text-shadow:0_2px_8px_rgba(0,0,0,0.8)]"
            style={{ color: c2 }}
            data-testid="time-stage"
          >
            {getPhaseName(time.cycle, time.cycleDay)}
          </span>
        </div>
      </div>
      <div
        className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1.5 rounded-full border border-white/15 bg-black/45 px-3.5 py-1.5 text-[13px] text-[#e6ecea]"
        data-testid="time-label"
      >
        <span>
          <strong className="font-display" style={{ color: c2 }}>
            Month {monthOf(time.week)}
          </strong>{" "}
          · Week {weekInMonth(time.week)} · Day {time.cycleDay}
        </span>
        <span aria-hidden="true" className="hidden opacity-40 sm:inline">
          |
        </span>
        <span>
          Current week cycle: <strong style={{ color: c2 }}>{night ? "Night" : "Day"}</strong>
        </span>
      </div>
      {time.cycleDay === 7 && !readOnly ? (
        <button
          type="button"
          onClick={() => void advance.fire({ campaignId })}
          disabled={advance.pending}
          className="min-h-[42px] cursor-pointer rounded-full border px-5 font-display text-[14px] font-bold tracking-[0.06em]"
          style={{
            borderColor: night ? "#ffcf6a" : "#a9b8ff",
            background: night ? "rgba(255, 207, 106, 0.18)" : "rgba(80, 90, 180, 0.35)",
            color: night ? "#ffe2a3" : "#dbe2ff",
            boxShadow: `0 0 18px ${night ? "rgba(255, 207, 106, 0.35)" : "rgba(140, 160, 255, 0.4)"}`,
          }}
        >
          {night ? "☀ Bring the Dawn · begin a new week" : "☾ Bring the Night · begin a new week"}
        </button>
      ) : null}
      <p role="status" aria-live="polite" className="m-0 min-h-0 text-[13px] text-danger empty:hidden">
        {error}
      </p>
    </section>
  );
}
