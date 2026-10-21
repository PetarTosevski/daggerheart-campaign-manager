"use client";

import { CampaignRouteError, type RouteErrorProps } from "@/components/route-error";

/** A character sheet failed to render (rule 11): the campaign chrome stays, with the reason and a retry. */
export default function CharacterSheetError(props: RouteErrorProps) {
  return <CampaignRouteError {...props} title="Character sheet" what="This character sheet failed to load." />;
}
