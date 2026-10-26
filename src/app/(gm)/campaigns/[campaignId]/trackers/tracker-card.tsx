import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared frame for tracker panels, in the dashboard's panel style
 * (#141e22 card, Cinzel heading). `gmOnly` adds a small "GM only" tag.
 */
export function TrackerCard({
  title,
  subtitle,
  gmOnly = false,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  gmOnly?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = `tr-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-3.5 rounded-[14px] border border-[#253338] bg-[#141e22] p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 id={id} className="m-0 flex items-center gap-2 font-display text-[20px] font-bold text-parchment">
            {title}
            {gmOnly ? (
              <span className="rounded-full border border-[#5b4a8f] px-2 py-0.5 font-sans text-[11px] font-medium tracking-[0.14em] text-fear uppercase">
                GM only
              </span>
            ) : null}
          </h3>
          {subtitle ? <p className="m-0 text-[13px] text-[#9fb2b6]">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Small outlined button used inside tracker panels. */
export const TRACKER_BTN =
  "min-h-10 cursor-pointer rounded-[9px] border border-[#33444a] bg-transparent px-3 text-[14px] text-[#e6ecea] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";
