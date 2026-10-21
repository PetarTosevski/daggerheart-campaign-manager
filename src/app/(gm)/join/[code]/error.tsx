"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

/** The join-by-link page failed to render (rule 11): the reason, a retry and a way back. */
export default function JoinError(props: RouteErrorProps) {
  return <RouteError {...props} title="Join a campaign" what="The invitation failed to load." />;
}
