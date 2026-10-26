"use client";

import { CampaignRouteError, type RouteErrorProps } from "@/components/route-error";

/** The character creator failed to render (rule 11): the campaign chrome stays, with the reason and a retry. */
export default function NewCharacterError(props: RouteErrorProps) {
  return <CampaignRouteError {...props} title="New character" what="The character creator failed to load." />;
}
