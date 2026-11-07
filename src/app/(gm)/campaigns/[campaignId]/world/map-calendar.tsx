"use client";

import { SlotBoundary } from "@/components/party/session/boundary";
import { frameHasMechanic } from "@/lib/frames";

import type { CampaignSummary } from "../../../../../../convex/campaigns";
import { TimeArc } from "../time-arc";
import { DayCard } from "../time-of-day";
// The arc's sky buttons (.tm-ic) and their glow (tmglow) live in the dashboard's stylesheet, as for the HUD disc.
import "../dashboard.css";

type CalendarCampaign = Pick<CampaignSummary, "_id" | "frameId" | "role" | "ownerView">;

/**
 * Which calendar the World map shows, by the dashboard's rules (DashboardHero): the Witherwild arc for frames with the
 * `campaignTime` mechanic, the day card for every other campaign; read-only unless the caller is the GM and not the
 * app owner's read-only view (config AU7).
 */
export function mapCalendarFor(campaign: CalendarCampaign): { kind: "arc" | "day"; readOnly: boolean } {
  return {
    kind: frameHasMechanic(campaign.frameId, "campaignTime") ? "arc" : "day",
    readOnly: !(campaign.role === "gm" && !campaign.ownerView),
  };
}

/** The campaign calendar above the World map (plan world-journey MC1): the same arc or day card as the dashboard. */
export function MapCalendar({ campaign }: { campaign: CalendarCampaign }) {
  const { kind, readOnly } = mapCalendarFor(campaign);
  return (
    <div className="mx-auto flex w-full max-w-[1440px] min-w-0 justify-center px-4 pt-4 sm:px-5" data-testid="map-calendar">
      <SlotBoundary fallback={null}>
        {kind === "arc" ? <TimeArc campaignId={campaign._id} readOnly={readOnly} /> : <DayCard campaignId={campaign._id} readOnly={readOnly} />}
      </SlotBoundary>
    </div>
  );
}
