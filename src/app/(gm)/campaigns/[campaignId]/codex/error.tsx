"use client";

import { CampaignRouteError, type RouteErrorProps } from "@/components/route-error";

/** The codex failed to render (rule 11): the campaign chrome stays, with the reason and a retry. */
export default function CodexError(props: RouteErrorProps) {
  return <CampaignRouteError {...props} title="Characters & Locations" what="The codex failed to load." />;
}
