"use client";

import { CampaignRouteError, type RouteErrorProps } from "@/components/route-error";

/** The party roster failed to render (rule 11): the campaign chrome stays, with the reason and a retry. */
export default function PartyError(props: RouteErrorProps) {
  return <CampaignRouteError {...props} title="The Party" what="The party failed to load." />;
}
