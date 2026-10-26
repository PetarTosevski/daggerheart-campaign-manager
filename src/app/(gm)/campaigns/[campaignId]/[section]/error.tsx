"use client";

import { CampaignRouteError, type RouteErrorProps } from "@/components/route-error";

/** A placeholder section failed to render (rule 11): the campaign chrome stays, with the reason and a retry. */
export default function SectionError(props: RouteErrorProps) {
  return <CampaignRouteError {...props} title="Something went wrong" what="This section failed to load." />;
}
