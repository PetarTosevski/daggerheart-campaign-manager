"use client";

import { CampaignRouteError, type RouteErrorProps } from "@/components/route-error";

/** The campaign dashboard failed to render (rule 11): the campaign chrome stays, with the reason and a retry. */
export default function CampaignDashboardError(props: RouteErrorProps) {
  return <CampaignRouteError {...props} title="Dashboard" what="The campaign dashboard failed to load." />;
}
