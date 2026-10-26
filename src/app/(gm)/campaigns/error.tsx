"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

/** The campaign list or the campaign chrome failed to render (rule 11): the reason, a retry and a way back. */
export default function CampaignsError(props: RouteErrorProps) {
  return <RouteError {...props} title="Campaigns" what="The campaigns failed to load." />;
}
