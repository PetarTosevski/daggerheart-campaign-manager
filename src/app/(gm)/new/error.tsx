"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

/** The frame picker failed to render (rule 11): the reason, a retry and a way back. */
export default function NewCampaignError(props: RouteErrorProps) {
  return <RouteError {...props} title="New campaign" what="The campaign frames failed to load." />;
}
