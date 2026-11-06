"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

/**
 * The admin page failed to render (rule 11): the reason, a retry and a way back. Neutral words on purpose: this can
 * show before the owner check has answered, so it names nothing admin.
 */
export default function AdminError(props: RouteErrorProps) {
  return <RouteError {...props} title="Something went wrong" what="This page failed to load." />;
}
