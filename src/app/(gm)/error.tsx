"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

/** A page of the app failed to render (rule 11): the reason, a retry and a way back. */
export default function TitleMenuError(props: RouteErrorProps) {
  return <RouteError {...props} title="Something went wrong" what="This page failed to load." />;
}
