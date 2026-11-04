"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo, useEffect, useState } from "react";

import { CAMPAIGN_SECTIONS, visibleToPlayers, type CampaignSection } from "@/lib/campaign-sections";
import { cn } from "@/lib/utils";

/** The section the app bar draws as its gold pill on the right instead of a nav item (user answer Q1, 2026-11-04). */
export const LOREKEEPER_SLUG = "lorekeeper";
const COMBAT_MAP_SLUG = "combat-map";

/** False until the browser first goes idle after mount (at most about 2 s), so background work waits for the page. */
function useAfterIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => setIdle(true), { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => setIdle(true), 1000);
    return () => window.clearTimeout(id);
  }, []);
  return idle;
}

/** The campaign's sections a viewer sees in the nav, in the user's order (`CAMPAIGN_SECTIONS`, never a copy). */
export function navSections(isGm: boolean, { withLorekeeper }: { withLorekeeper: boolean }): CampaignSection[] {
  return CAMPAIGN_SECTIONS.filter(
    (section) => (isGm || visibleToPlayers(section)) && (withLorekeeper || section.slug !== LOREKEEPER_SLUG),
  );
}

type NavProps = {
  campaignId: string;
  isGm: boolean;
  /**
   * "header": the tall art header's nav (every campaign page; the Combat Map on a phone). "bar": the Combat Map app
   * bar's 36 px items (board Main `.ab-nav`), without the Lorekeeper, which the bar draws as its pill.
   */
  variant: "header" | "bar";
  /** The Combat Map item carries the live dot (a map is live). */
  liveMap?: boolean;
};

/**
 * The campaign navigation ('Campaign sections'). Full prefetch of every tab (PF1, user answer Q3) starts once the page
 * is idle, so the tabs' payloads and code do not compete with the open page's own; until then the default prefetch
 * fetches the shell down to the loading boundary.
 */
export const CampaignNav = memo(function CampaignNav({ campaignId, isGm, variant, liveMap = false }: NavProps) {
  const pathname = usePathname();
  const fullPrefetch = useAfterIdle();
  const base = `/campaigns/${campaignId}`;
  const bar = variant === "bar";
  return (
    <nav aria-label="Campaign sections" className={bar ? "ab-nav" : "flex flex-wrap gap-1 rounded-xl bg-black/35 p-1"}>
      {navSections(isGm, { withLorekeeper: !bar }).map((section) => {
        const href = section.slug ? `${base}/${section.slug}` : base;
        const current = pathname === href;
        const live = bar && liveMap && section.slug === COMBAT_MAP_SLUG;
        return (
          <Link
            key={section.label}
            href={href}
            // Fully prefetched, a first click renders at once (the tab's RSC payload and code are here) and the router
            // cache serves revisits.
            prefetch={fullPrefetch ? true : null}
            aria-current={current ? "page" : undefined}
            className={
              bar
                ? "ab-nv"
                : cn(
                    "inline-flex min-h-11 items-center rounded-lg px-3.5 text-[14px]",
                    current ? "bg-brand text-brand-ink" : "text-[#e6ecea] hover:bg-white/10",
                  )
            }
          >
            {section.label}
            {live ? (
              <>
                <span className="ab-live" aria-hidden="true" data-testid="app-bar-live" />
                <span className="sr-only"> (live)</span>
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
});
