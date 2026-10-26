"use client";

import { CampaignRouteError, type RouteErrorProps } from "@/components/route-error";

/** The world map failed to render (rule 11): the campaign chrome stays, with the reason and a retry. */
export default function WorldError(props: RouteErrorProps) {
  return <CampaignRouteError {...props} title="World" what="The world map failed to load." />;
}
